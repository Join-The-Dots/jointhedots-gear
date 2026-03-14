import { Bundle, matchComponentSelection, Workspace, type AppEntry, type PackageDescriptor, } from "../workspace/workspace.ts"
import { StorageFiles } from "../workspace/storage.ts"
import { BuildTarget } from "./build-target.ts"
import { build_app_composable_bundle } from './build-app-bundle.ts'
import Path from "node:path"
import { PWAPackageTask, WebviewTask, type BuildApplicationOptions } from "./build-application.ts"
import type { BundleID } from "../workspace/component.ts"
import { topologicalSort } from "../utils/graph-ordering.ts"

function create_application_composable_target(opts: {
   app: AppEntry
   storage: StorageFiles
   version: string
   devmode: boolean
   devserver?: string
   watch: boolean
   clean: boolean
}): BuildTarget {
   const { app, version } = opts
   const { type, name, webviews, modules, assets, components } = app.descriptor
   const lib = app.library
   const bundle = lib.bundle
   const ws = lib.workspace
   const target = new BuildTarget(name, opts.storage, ws, opts.devmode == true, opts.watch == true, opts.clean == true)

   // Prepare esm setup
   target.esmodules.set_root(lib.path)

   // Generate hotreload assets
   const html_injects: string[] = []
   if (opts.devserver) {
      html_injects.push(`<script type="module" src="./esbuild-hotreload.js"></script>`)
      target.assets.add_static_text(`esbuild-hotreload.js`,
         `new EventSource('${opts.devserver}/esbuild').addEventListener('change', e => { location.reload() })`
      )
   }

   // Generate web manifest
   html_injects.push(`<link rel="manifest" href="/manifest.json">`)
   html_injects.push(`<link rel="icon" type="image/webp" href="favicon.webp" />`)
   target.tasks.push(new PWAPackageTask(target, app))

   // Add application webviews
   for (const name in webviews) {
      const { title, favicon } = webviews[name]
      const entry_name = lib.make_file_id("webview", name)

      const webview = {
         ...webviews[name],
         entry: `./${bundle.id}/${entry_name}.js`,
         favicon: favicon ? app.library.resolve_entry_path(favicon, Path.dirname(app.baseDir)) : null,
      }
      target.tasks.push(new WebviewTask(target, name, title || name, webview, html_injects))

      if (opts.devserver) {
         target.log.info(`+ 🌐 webview: ${name} : ${opts.devserver}/${name}`)
      }
   }

   // Add application modules
   for (const name in modules) {
      if (name.endsWith(".js")) {
         const entry_name = lib.make_file_id("module", name.slice(0, -3))
         target.esmodules.add_entry_typescript(`export * from "./${bundle.id}/${entry_name}.js"`, name.slice(0, -3))
         if (opts.devserver) {
            target.log.info(`+ 🔌 module: ${name} : ${opts.devserver}/${name}`)
         }
      }
      else {
         target.log.error(`Invalid module name '${name}' in ${name}`)
      }
   }

   // Add application package.json
   target.assets.add_static_json("package.json", {
      name: name,
      version: opts.version || app.library.descriptor.version,
      description: app.descriptor.description,
   } as PackageDescriptor)

   // TODO: Collect components catalogs
   // Add workspace components
   /*for (const lib of ws.libraries) {
      for (const [path, desc] of lib.components) {
         if (!matchComponentSelection(components, desc.selectors)) continue
         const baseDir = Path.dirname(path)
         target.add_component(desc, baseDir, lib)
      }
   }*/

   // Add workspace assets
   for (const lib of ws.libraries) {
      for (const [path, desc] of lib.declarations) {
         if (!matchComponentSelection(components, desc.selectors)) continue
         if (desc.assets) {
            const baseDir = Path.dirname(path)
            for (const entry of desc.assets) {
               target.assets.add_entry(entry, baseDir, lib)
            }
         }
      }
   }

   return target
}

export async function build_app_composable_host(opts: BuildApplicationOptions): Promise<void> {
   const { app, storage } = opts
   const ws = app.library.workspace
   opts.storage.clean()

   const shelveBundles = new BundleSelector(ws)
   const { bundle } = app.library
   if (bundle) shelveBundles.add(bundle)

   const shelvePendings = []
   for (const bundle of shelveBundles) {
      shelvePendings.push(build_app_composable_bundle({
         bundle,
         shelve: storage,
         version: opts.version,
         devmode: opts.devmode,
         watch: opts.watch,
         clean: opts.clean || !opts.devmode,
      }))
   }
   if (shelveBundles.missing.length > 0) {
      ws.log.warn(`Missing bundle dependencies: ${shelveBundles.missing.join(", ")}`)
   }
   await Promise.all(shelvePendings)

   const target = create_application_composable_target({
      app,
      storage: opts.storage,
      version: opts.version,
      devmode: opts.devmode,
      devserver: opts.devserver,
      watch: opts.devserver ? true : opts.watch,
      clean: opts.clean,
   })

   target.log.info(`Build app: ${target.name}`)
   return target.build()
}

export class BundleSelector {
   readonly selected = new Map<BundleID, Bundle>()
   readonly missing: BundleID[] = []

   constructor(readonly workspace: Workspace) { }

   /** Add a bundle and recursively collect all its dependencies */
   add(bundle: string | Bundle): this {
      const bun = typeof bundle === "string" ? this.workspace.get_bundle(bundle) : bundle
      if (!bun) {
         const id = typeof bundle === "string" ? bundle : bundle?.id
         if (id && !this.missing.includes(id)) {
            this.missing.push(id)
         }
         return this
      }
      if (this.selected.has(bun.id)) {
         return this
      }
      this.selected.set(bun.id, bun)

      // Recursively add dependencies
      const deps = bun.dependencies
      for (const depId of deps) {
         this.add(depId)
      }
      if (bun.source) {
         for (const depId in bun.source.descriptor?.dependencies) {
            const lib = this.workspace.get_library(depId)
            if (lib?.bundle) this.add(lib.bundle)
         }
      }
      return this
   }

   /** Check if the selector has any bundles */
   get isEmpty(): boolean {
      return this.selected.size === 0
   }

   /** Get all selected bundles as an array in topological order (dependencies first) */
   toArray(): Bundle[] {
      return topologicalSort(
         this.selected.values(),
         bun => {
            const deps = bun.dependencies || []
            return deps.map(id => this.selected.get(id))
               .filter((b): b is Bundle => b !== undefined)
         }
      )
   }

   /** Get all selected bundle IDs */
   getIds(): BundleID[] {
      return Array.from(this.selected.keys())
   }

   /** Iterate over selected bundles */
   [Symbol.iterator](): Iterator<Bundle> {
      return this.toArray().values()
   }
}
