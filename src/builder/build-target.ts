import Path from "node:path"
import MIME from 'mime'
import { makeComponentPublication, type ComponentID, type ComponentManifest, type ComponentPublication, type ResourceEntry } from "../model/component.ts"
import { type AssetsEntry, Bundle, Library, Workspace } from "../model/workspace.ts"
import type { Log } from "../model/helpers/logger.ts"
import { create_esbuild_context } from "../builder/esbuild-plugins.ts"
import { copyToStorageStream, type IStorageTransaction, type IStorageZone } from "../model/storage.ts"
import * as esbuild from 'esbuild'
import { computeNameHashID } from "../utils/normalized-name.ts"

export abstract class BuildTask {
   constructor(readonly target: BuildTarget) { }
   get log() { return this.target.log }
   async init(): Promise<void> { }
   abstract execute(): Promise<void>
}

export class BundleManifestTask extends BuildTask {
   constructor(readonly target: BuildTarget, readonly bundle: Bundle) {
      super(target)
   }
   async execute() {
      const { target, bundle } = this
      const { manifest } = bundle
      const tx = this.target.edit()

      // Emit static components manifest
      const components: ComponentPublication[] = []
      for (const manif of target.components.values()) {
         const pub = makeComponentPublication(manif)
         pub.ref = await tx.commitContent(JSON.stringify(manif, null, 2), MIME.getType(".json"))
         components.push(pub)
      }
      manifest.data.components = components

      // Emit bundle manifest
      await tx.commitFile(`bundle.manifest.json`, JSON.stringify(manifest, null, 2))
   }
}

export type AssetMapping = {
   from: string
   to: string
}

export class AssetsTask extends BuildTask {
   assets: AssetMapping[] = []
   statics: Record<string, string> = {}
   add_entry(entry: AssetsEntry, baseDir: string, library: Library) {
      let asset: AssetMapping = null

      if (typeof entry === "string") {
         const from = library.resolve_entry_path(entry, baseDir)
         if (!from) throw new Error(`In '${baseDir}', cannot found asset from: '${entry}'`)
         asset = { from, to: Path.basename(entry) }
      }
      else {
         const from = library.resolve_entry_path(entry.from, baseDir)
         if (!from) throw new Error(`In '${baseDir}', cannot found asset from: '${entry.from}'`)
         asset = { from, to: entry.to }
      }

      this.log.info(`+ 📎 assets '${library.name}': ${asset.from} -> ${asset.to}`)
      this.assets.push(asset)
   }
   add_static_text(name: string, data: string) {
      this.statics[name] = data
   }
   add_static_json(name: string, data: any) {
      this.statics[name] = JSON.stringify(data, null, 2)
   }
   async execute(): Promise<any> {
      const tx = this.target.edit()
      for (const key in this.statics) {
         tx.commitFile(key, this.statics[key], MIME.getType(key))
      }
      for (const asset of this.assets) {
         if (typeof asset === "string") {
            copyToStorageStream(tx, asset, asset)
         }
         else {
            copyToStorageStream(tx, asset.to, asset.from)
         }
      }
   }
}

export class ESModulesTask extends BuildTask {
   entries: { [url: string]: string } = {}
   imports: { [file: string]: string } = {}
   internals = new Map<string, string>()

   plugins: esbuild.Plugin[] = []
   context: esbuild.BuildContext = null
   transaction: IStorageTransaction = null
   polyfilled: boolean = true
   rootPath: string = null

   set_root(path: string) {
      this.rootPath = path
   }

   add_entry(name: string, path: string) {
      this.entries[name] = path
      this.imports[path] = name
   }
   add_entry_typescript(code: string, name?: string): string {
      const id = computeNameHashID(code)
      if (!name) name = id
      this.internals.set(id, code)
      this.add_entry(name, id)
      return name
   }
   add_resource_entry(resource: ResourceEntry, baseDir: string, library: Library): ResourceEntry {
      if (typeof resource === "string") {
         const parts = resource.split("#")
         const file = library.resolve_entry_path(parts[0], baseDir)
         if (file) {
            let named = this.imports[file]
            if (!named) {
               named = library.make_file_id("lambda", file)
               this.add_entry(named, file)
            }
            return `./${named}.js#${parts[1] || "default"}`
         }
         else {
            throw new Error(`${library.name}: Cannot resolve file: ${parts[0]}`)
         }
      }
      else {
         return resource
      }
   }
   async execute() {
      if (this.context) {
         const prev_ctx = this.context
         this.context = null
         await prev_ctx.dispose()
      }

      const { target } = this
      this.context = await create_esbuild_context(this, target.devmode)

      if (target.watch) {
         await this.context.watch()
      }
      else {
         await this.context.rebuild()
         await this.context.dispose()
      }
   }
}

export class BuildTarget {
   components = new Map<ComponentID, ComponentManifest>()
   esmodules = new ESModulesTask(this)
   assets = new AssetsTask(this)
   tasks: BuildTask[] = []
   transaction: IStorageTransaction = null
   readonly log: Log
   constructor(
      readonly name: string,
      readonly storage: IStorageZone,
      readonly workspace: Workspace,
      readonly devmode: boolean,
      readonly watch: boolean,
      readonly clean: boolean,
   ) {
      this.log = workspace.logger.get(`build:${name}`)
   }
   edit(): IStorageTransaction {
      if (!this.transaction) this.transaction = this.storage.edit()
      return this.transaction
   }
   store() {
      if (this.transaction) {
         this.transaction.accept()
         this.transaction = null
      }
   }
   add_component(descriptor: ComponentManifest, baseDir: string, library: Library) {
      const id = descriptor.$id
      if (this.components.has(id)) {
         throw new Error(createComponentDuplicateMessage(id, this.workspace))
      }

      const manifest = {
         ...descriptor,
         application: undefined,
         publish: undefined,
         entries: undefined,
      } as ComponentManifest

      if (descriptor.services) {
         manifest.services = {}
         for (const name in descriptor.services) {
            manifest.services[name] = this.esmodules.add_resource_entry(descriptor.services[name], baseDir, library)
         }
      }

      if (descriptor.resources) {
         manifest.resources = {}
         for (const name in descriptor.resources) {
            manifest.resources[name] = this.esmodules.add_resource_entry(descriptor.resources[name], baseDir, library)
         }
      }

      this.components.set(id, manifest)
   }
   private async chrona(task: BuildTask): Promise<void> {
      const name = task.constructor.name
      const start = Date.now()
      await task.execute()
      const elapsed = (Date.now() - start) / 1000
      this.log.info(`⏱ ${name} completed in ${elapsed.toFixed(2)}s`)
   }
   async build() {
      const buildStartTime: number = Date.now()

      if (this.clean) this.storage.clean()

      // Make assets
      await this.chrona(this.assets)

      // Make generic tasks
      for (const task of this.tasks) {
         await this.chrona(task)
      }

      // Make esmodules
      await this.chrona(this.esmodules)

      // Trace time
      const buildTime = (Date.now() - buildStartTime) / 1000
      this.log.info(`Build completed in ${buildTime.toFixed(2)}s`)

      if (this.watch) {
         await new Promise((resolve) => {
            process.on('SIGQUIT', () => resolve(null))
         })
      }
      else {
         this.store()
      }
   }
}

function createComponentDuplicateMessage(id: string, workspace: Workspace) {
   const duplicates = []
   const libs = []
   for (const bun of workspace.bundles) {
      for (const [cpath, cmanifest] of bun.components.entries()) {
         if (cmanifest.$id === id) {
            duplicates.push(`\n - ${cpath}`)
         }
      }
      libs.push(`\n - ${bun.id}: ${bun.path}`)
   }
   return `Component '${id}' declared multiple times: ${duplicates.join("")}\n> libraries:${libs.join("")}\n`
}
