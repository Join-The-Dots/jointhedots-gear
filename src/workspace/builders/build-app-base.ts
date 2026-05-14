import { Bundle, matchComponentSelection, Workspace, type AppEntry, type PackageDescriptor, } from "../workspace.ts"
import { StorageFiles } from "../storage.ts"
import { BuildTarget } from "./target.ts"
import { build_app_composable_plugin } from "./build-app-plugin.ts"
import Path from "node:path"
import { PWAPackageTask, WebviewTask, type BuildApplicationOptions } from "./build-application.ts"
import { makeComponentPublication, type BundleID, type BundleManifest, type ComponentManifest, type ComponentPublication } from "../../core/mod-node.ts"
import { topologicalSort } from "../../utils/graph-ordering.ts"
import { BuildTask } from "../tasks/task.ts"
import { ArtifactZipTask } from "../tasks/emit-artifact.ts"

export class ShelveManifestTask extends BuildTask {
   constructor(readonly target: BuildTarget, readonly bundles: Bundle[]) {
      super(target)
   }
   async execute() {
      const { bundles } = this

      // Emit static components manifest
      const namespaces = new Set<string>()
      const components: ComponentPublication[] = []
      for (const bundle of bundles) {
         const pub = makeComponentPublication(bundle.manifest)
         const nss = bundle.manifest.type === "bundle" && bundle.manifest.data?.["namespaces"]
         if (Array.isArray(nss)) {
            for (const ns of nss) {
               namespaces.add(ns)
            }
         }
         components.push(pub)
      }

      // Emit bundle manifest
      const tx = this.target.edit()
      const manifest: BundleManifest = {
         $id: ".",
         type: "bundle",
         data: {
            namespaces: Array.from(namespaces),
            components,
         }
      }
      await tx.commitFile(`bundle.manifest.json`, JSON.stringify(manifest, null, 2))
   }
}


function create_application_composable_base(opts: {
   app: AppEntry
   bundles: Bundle[]
   storage: StorageFiles
   version: string
   devmode: boolean
   devserver?: string
   watch: boolean
   clean: boolean
}): BuildTarget {
   const { app, bundles, version } = opts
   const { name, webviews, modules, components } = app.descriptor
   const { library: lib } = app
   const target = new BuildTarget(name, opts.storage, lib, opts.devmode == true, opts.watch == true, opts.clean == true)

   // Prepare esm setup
   target.modules.set_root(lib.path)

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

   // Generate shelve manifest
   target.tasks.push(new ShelveManifestTask(target, bundles))

   // Add application webviews
   for (const name in webviews) {
      const { title, favicon } = webviews[name]
      const entry_name = lib.make_file_id("webview", name)

      const webview = {
         ...webviews[name],
         entry: `./${lib.master.id}/${entry_name}.js`,
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
         target.modules.add_entry_typescript(`export * from "./${lib.master.id}/${entry_name}.js"`, name.slice(0, -3))
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
   for (const slib of lib.workspace.libraries) {
      for (const [path, desc] of slib.declarations) {
         if (!matchComponentSelection(components, desc.selectors)) continue
         if (desc.assets) {
            const baseDir = Path.dirname(path)
            for (const entry of desc.assets) {
               target.assets.add_entry(entry, baseDir, slib)
            }
         }
      }
   }

   return target
}

export async function build_app_composable(opts: BuildApplicationOptions): Promise<void> {
   const { app, storage } = opts
   const { library: lib } = app
   opts.storage.clean()

   const shelveBundles = new BundleSelector(lib.workspace)
   if (lib.master) shelveBundles.add(lib.master)

   const shelvePendings = []
   for (const bundle of shelveBundles) {
      shelvePendings.push(build_app_composable_plugin({
         bundle,
         shelve: storage,
         version: opts.version,
         devmode: opts.devmode,
         watch: opts.watch,
         clean: opts.clean || !opts.devmode,
      }))
   }
   if (shelveBundles.missing.length > 0) {
      lib.log.warn(`Missing bundle dependencies: ${shelveBundles.missing.join(", ")}`)
   }

   const target = create_application_composable_base({
      app,
      bundles: await Promise.all(shelveBundles),
      storage: opts.storage,
      version: opts.version,
      devmode: opts.devmode,
      devserver: opts.devserver,
      watch: opts.devserver ? true : opts.watch,
      clean: opts.clean,
   })

   if (opts.artifactDir) {
      target.finalTasks.push(new ArtifactZipTask(target, opts.artifactDir, target.name))
   }

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
      if (deps) {
         for (const depId of deps) {
            this.add(depId)
         }
      }
      if (bun.source) {
         for (const depId in bun.source.descriptor?.dependencies) {
            const lib = this.workspace.get_library(depId)
            if (lib?.master) this.add(lib.master)
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
