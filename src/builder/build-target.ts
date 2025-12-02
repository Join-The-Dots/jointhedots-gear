import Fs from "node:fs"
import Process from "node:process"
import Path from "node:path"
import MIME from 'mime'
import { ComponentCatalogsDescriptor, ComponentID, ComponentManifest, ComponentPublication, makeComponentPublication, ResourceEntry } from "../model/component.js"
import { compute_hashID, make_filename, make_relative_path, MapLike } from "../utils/helpers.js"
import { AppEntry, AssetsEntry, Library, PackageDescriptor, WebviewEntry, Workspace } from "../model/workspace.js"
import { create_esbuild_context } from "../builder/esbuild-plugins.js"
import { copyToStorageStream, StorageFiles } from "../model/storage.js"
import DtsGenerator from "./emit-dts.js"
import * as esbuild from 'esbuild'
import { file } from "../utils/file.js"

export class BuildFile {
   name: string
   data?: string
   emitter: BuildTask
   read(to: BuildTask): string {
      return this.data
   }
   write(data: string, from: BuildTask) {
   }
}

export abstract class BuildTask {
   useds: BuildFile[] = []
   constructor(readonly target: BuildTarget) { }
   async init(): Promise<void> { }
   abstract execute(): Promise<void>
}

export class WebviewTask extends BuildTask {
   constructor(
      target: BuildTarget,
      readonly name: string,
      readonly title: string,
      readonly desc: WebviewEntry,
      readonly html_injects: string[],
   ) {
      super(target)
   }
   async execute() {
      const { name, title, desc, html_injects, target } = this
      const { storage } = target
      storage.commitFile(name, `<!DOCTYPE html>
         <html>
             <head>
                 <title>${title}</title>
                 <meta charset="utf-8">
                 <meta name="viewport" content="width=device-width, initial-scale=1.0">
                 ${desc.favicon ? `<link rel="icon" type="${MIME.getType(desc.favicon)}" href="${desc.favicon}">` : ""}
                 <script defer type="module" src="./${name}.js"></script>
                 ${html_injects.join('\n           ')}
             </head>
             <body>
             </body>
         </html>`)
   }
}

export class TypescriptDefinitionTask extends BuildTask {

   constructor(
      target: BuildTarget,
      readonly library: Library,
   ) {
      super(target)
   }
   async execute() {
      const lib = this.library
      const { storage } = this.target
      try {
         const configText =
            file.read.text(Path.join(lib.path, "./tsconfig.json"))
            || file.read.text("./tsconfig.json")
         await DtsGenerator({
            prefix: lib.name,
            baseDir: lib.path,
            outDtsFile: storage.baseDir + "/types.d.ts",
            outDir: storage.baseDir,
            exclude: ["node_modules/**/*"],
            compilerOptions: configText,
         })
      }
      catch (e) {
         console.error("! no 'type.d.ts' will be generated for the package:", e.message)
      }
   }
}

export class ComponentCatalogsTask extends BuildTask {
   async execute() {
      const { target } = this
      const { storage } = target

      // Emit static components manifest
      const manifest: ComponentCatalogsDescriptor = {
         name: target.name,
         baseline: target.workspace.version,
         components: {},
         catalogs: {},
      }
      const catalogs: MapLike<ComponentPublication[]> = { "every": [] }
      for (const id in target.components) {
         const manif = target.components[id]
         const pub = makeComponentPublication(manif)
         if (Array.isArray(manif.catalogs)) {
            for (const name of manif.catalogs) {
               let catalog = catalogs[name]
               if (!catalog) catalog = catalogs[name] = []
               catalog.push(pub)
            }
         }
         catalogs.every.push(pub)
         manifest.components[id] = await storage.commitContent(JSON.stringify(manif, null, 2), MIME.getType(".json"))
      }

      // Emit static components catalogs
      for (const name in catalogs) {
         const catalog = JSON.stringify(catalogs[name], null, 2)
         manifest.catalogs[name] = await storage.commitContent(catalog, MIME.getType(".json"))
      }

      await storage.commitFile(`components.manifest.json`, JSON.stringify(manifest, null, 2))
   }
}

export type AssetMapping = {
   from: string
   to: string
}

export class AssetsTask extends BuildTask {
   assets: AssetMapping[] = []
   statics: MapLike<string> = {}
   add_entry(entry: AssetsEntry, baseDir: string, library: Library) {
      let asset: AssetMapping = null

      if (typeof entry === "string") {
         const from = resolve_entry_path(library, entry, baseDir)
         if (!from) throw new Error(`In '${baseDir}', cannot found asset from: '${entry}'`)
         asset = { from, to: Path.basename(entry) }
      }
      else {
         const from = resolve_entry_path(library, entry.from, baseDir)
         if (!from) throw new Error(`In '${baseDir}', cannot found asset from: '${entry.from}'`)
         asset = { from, to: entry.to }
      }

      console.log(`+ assets '${library.name}': ${asset.from} -> ${asset.to}`)
      this.assets.push(asset)
   }
   add_static_text(name: string, data: string) {
      this.statics[name] = data
   }
   add_static_json(name: string, data: any) {
      this.statics[name] = JSON.stringify(data, null, 2)
   }
   async execute(): Promise<any> {
      const { storage } = this.target
      for (const key in this.statics) {
         storage.commitFile(key, this.statics[key], MIME.getType(key))
      }
      for (const asset of this.assets) {
         if (typeof asset === "string") {
            copyToStorageStream(storage, asset, asset)
         }
         else {
            copyToStorageStream(storage, asset.to, asset.from)
         }
      }
   }
}

export class ESModulesTask extends BuildTask {
   entries: { [url: string]: string } = {}
   imports: { [file: string]: string } = {}
   plugins: esbuild.Plugin[] = []
   context: esbuild.BuildContext = null
   add_entry(name: string, path: string) {
      this.entries[name] = path
      this.imports[path] = name
   }
   add_resource_entry(resource: ResourceEntry, baseDir: string, library: Library): ResourceEntry {
      if (typeof resource === "string") {
         const parts = resource.split("#")
         const file = resolve_entry_path(library, parts[0], baseDir)
         if (file) {
            let named = this.imports[file]
            if (!named) {
               named = make_filename("lambda_" + compute_hashID(file))
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
      const storage = this.target.storage
      this.context = await create_esbuild_context(target, storage, storage.baseDir, target.devmode, this.plugins)

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
   constructor(
      readonly name: string,
      readonly storage: StorageFiles,
      readonly workspace: Workspace,
      readonly devmode: boolean,
      readonly watch: boolean,
   ) {
   }
   add_component(descriptor: ComponentManifest, baseDir: string, library: Library) {
      const id = descriptor.$id
      if (this.components[id]) {
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
            manifest.resources[name] = this.esmodules.add_resource_entry(descriptor.services[name], baseDir, library)
         }
      }

      this.components[id] = manifest
   }
   async build() {
      this.storage.begin(!this.watch)

      // Make assets
      await this.assets.execute()

      // Make generic tasks
      for (const task of this.tasks) {
         await task.execute()
      }

      // Make esmodules
      await this.esmodules.execute()

      if (this.watch) {
         await new Promise((resolve) => {
            process.on('SIGQUIT', () => resolve(null))
         })
      }
      else {
         this.storage.end()
      }
   }
   error(err: string | Error) {
      console.error(err)
   }
}

export function resolve_entry_path(lib: Library, entryId: string, baseDir: string): string {
   const fpath = make_relative_path(Process.cwd(), Path.resolve(baseDir, entryId))
   if (entryId.startsWith(".")) return fpath

   const parts = entryId.split("/")
   for (const search_path of lib.search_directories) {
      if (Fs.existsSync(search_path + "/" + parts[0])) {
         return make_relative_path(Process.cwd(), search_path + "/" + entryId)
      }
   }

   if (Fs.existsSync(fpath)) return fpath
   return null
}

function createComponentDuplicateMessage(id: string, workspace: Workspace) {
   const duplicates = []
   const libs = []
   for (const lib of workspace.libraries) {
      for (const [cpath, cmanifest] of lib.components.entries()) {
         if (cmanifest.$id === id) {
            duplicates.push(`\n - ${cpath}`)
         }
      }
      libs.push(`\n - ${lib.name}: ${lib.path}`)
   }
   return `Component '${id}' declared multiple times: ${duplicates.join("")}\n> libraries:${libs.join("")}\n`
}
