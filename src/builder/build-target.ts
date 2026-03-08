import { type ComponentID, type ComponentManifest } from "../model/component.ts"
import { Library, Workspace } from "../model/workspace.ts"
import type { Log } from "../model/helpers/logger.ts"
import { ESModulesTask } from "./helpers/emit-esmodules.ts"
import { type IStorageTransaction, type IStorageZone } from "../model/storage.ts"
import { AssetsTask } from "./helpers/emit-static-assets.ts"
import type { BuildTask } from "./helpers/task.ts"

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
