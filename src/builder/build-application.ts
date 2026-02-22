import { Library, matchComponentSelection, type AppEntry, type ChromeAppDescriptor, type ChromeAppManifest, type WebviewEntry } from "../model/workspace.ts"
import { StorageFiles } from "../model/storage.ts"
import { BuildTarget, BuildTask, BundleManifestTask } from "./build-target.ts"
import type { WebAppManifest } from 'web-app-manifest'
import Path from "node:path"
import Fs from "node:fs"
import Sharp from "sharp"
import MIME from 'mime'
import { build_app_composable_host } from "./build-app-host.ts"
import { DependencyDeduplicationPlugin } from "./esbuild-plugins.ts"

export type BuildApplicationOptions = {
   app: AppEntry
   storage: StorageFiles
   version: string
   devmode?: boolean
   watch?: boolean
   clean?: boolean
   devserver?: string
}

function collect_app_libraries(app: AppEntry): Library[] {
   const libs: Library[] = [app.library]
   function collect_library_deps(lib: Library) {
      const ws = lib.workspace
      const deps = {
         ...lib.descriptor.dependencies,
         ...lib.descriptor.devDependencies,
         ...lib.descriptor.peerDependencies,
      }
      for (const depId in deps) {
         const lib = ws.get_library(depId)
         if (lib && !libs.includes(lib)) {
            libs.push(lib)
         }
      }
   }
   for (let i = 0; i < libs.length; i++) {
      collect_library_deps(libs[i])
   }
   return libs
}

export function create_application_monolith_target(opts: {
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
   const ws = lib.workspace
   const target = new BuildTarget(name, opts.storage, ws, opts.devmode == true, opts.watch == true, opts.clean == true)
   const libs = collect_app_libraries(app)

   // Generate hotreload assets
   const html_injects: string[] = []
   if (opts.devserver) {
      html_injects.push(`<script type="module" src="./esbuild-hotreload.js"></script>`)
      target.assets.add_static_text(`esbuild-hotreload.js`,
         `new EventSource('${opts.devserver}/esbuild').addEventListener('change', e => { location.reload() })`
      )
   }

   // Manage app type specific
   if (type === "web") {
      // Generate web manifest
      html_injects.push(`<link rel="manifest" href="/manifest.json">`)
      html_injects.push(`<link rel="icon" type="image/webp" href="favicon.webp" />`)
      target.tasks.push(new PWAPackageTask(target, app))
   }
   else if (type === "chrome") {
      // Generate chrome extension manifest
      target.tasks.push(new ChromePackageTask(target, app, version))
   }
   else {
      throw new Error(`App type '${type}' unsupported`)
   }

   // Add application webviews
   for (const name in webviews) {
      const { title, favicon, entry } = webviews[name]
      const entry_name = lib.make_file_id("webview", name)
      const entry_path = app.library.resolve_entry_path(entry, app.baseDir)
      target.esmodules.add_entry(entry_name, entry_path)

      const webview = {
         ...webviews[name],
         entry: `./${entry_name}.js`,
         favicon: favicon ? app.library.resolve_entry_path(favicon, app.baseDir) : null,
      }
      target.tasks.push(new WebviewTask(target, name, title || name, webview, html_injects))

      if (opts.devserver) {
         target.log.info(`+ 🌐 webview: ${name} : ${opts.devserver}/${name}`)
      }
   }

   // Add application modules
   for (const name in modules) {
      const entry_path = app.library.resolve_entry_path(modules[name], app.baseDir)
      if (!entry_path) {
         target.log.error(`Invalid module '${name}' path at ${entry_path}`)
      }
      else if (name.endsWith(".js")) {
         const entry_name = name.slice(0, -3)
         target.esmodules.add_entry(entry_name, entry_path)
         if (opts.devserver) {
            target.log.info(`+ 🔌 module: ${name} : ${opts.devserver}/${name}`)
         }
      }
      else {
         target.log.error(`Invalid module name '${name}' in ${name}`)
      }
   }

   // Add application static assets
   if (Array.isArray(assets)) {
      for (const asset of assets) {
         target.assets.add_entry(asset, app.baseDir, app.library)
      }
   }

   // Add bundle content
   const { bundle } = lib
   if (bundle) {

      // Add bundle manifest
      target.tasks.push(new BundleManifestTask(target, bundle))

      // Add workspace components
      for (const lib of libs) {
         if (lib.bundle) {
            for (const [path, desc] of lib.bundle.components) {
               if (!matchComponentSelection(components, desc.selectors)) continue
               const baseDir = Path.dirname(path)
               target.add_component(desc, baseDir, lib)
            }
         }
      }

   }

   // Add workspace assets
   for (const lib of libs) {
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

   // Register esbuild plugin for dependency deduplication (graph-based + singleton)
   const rootNodeModules = ws.search_directories[0] || Path.join(ws.path, 'node_modules')
   target.esmodules.plugins.push(DependencyDeduplicationPlugin(libs, rootNodeModules, target.log))
   return target
}

export async function build_app_monolith(opts: BuildApplicationOptions): Promise<void> {
   const { app } = opts
   opts.storage.clean()

   const target = create_application_monolith_target({
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

export async function build_application(opts: BuildApplicationOptions): Promise<void> {
   if (opts.app.descriptor.type === "composable") {
      return build_app_composable_host(opts)
   }
   else {
      return build_app_monolith(opts)
   }
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
      const { name, title, desc, html_injects } = this
      const tx = this.target.edit()
      tx.commitFile(name, `<!DOCTYPE html>
         <html>
             <head>
                 <title>${title}</title>
                 <meta charset="utf-8">
                 <meta name="viewport" content="width=device-width, initial-scale=1.0">
                 ${desc.favicon ? `<link rel="icon" type="${MIME.getType(desc.favicon)}" href="${desc.favicon}">` : ""}
                 <script defer type="module" src="${desc.entry}"></script>
                 ${html_injects.join('\n           ')}
             </head>
             <body>
             </body>
         </html>`)
   }
}

export class ChromePackageTask extends BuildTask {
   constructor(
      target: BuildTarget,
      readonly app: AppEntry,
      readonly version: string,
   ) {
      super(target)
   }
   async execute() {
      const { app } = this
      const tx = this.target.edit()
      const desc = app.descriptor as ChromeAppDescriptor
      const infos: ChromeAppManifest = desc.manifest || {} as any
      const icon = Sharp(Path.resolve(app.baseDir, desc.icon))

      // Create default favorite icon
      const favicon_data = await createIcon(icon, 64, "png")
      const favicon_url = await tx.commitContent(favicon_data, "image/png")

      // Create manifest
      const manifest: ChromeAppManifest = {
         ...infos,
         name: infos?.name || desc.name,
         version: this.version,
         manifest_version: 3,
         description: infos.description || desc.description,
         icons: infos.icons || await this.createIcons(icon),
         action: {
            ...infos.action,
            "default_icon": infos.action?.default_icon || favicon_url,
            "default_title": infos.action?.default_title || desc.title || desc.name,
         }
      }

      // Write manifest
      tx.commitFile("manifest.json", JSON.stringify(manifest, null, 2))
   }
   async createIcons(base: Sharp.Sharp): Promise<ChromeAppManifest["icons"]> {
      const tx = this.target.edit()
      const icons = {}
      for (const size of [16, 32, 64, 128, 256]) {
         const img_data = await createIcon(base, size, "png")
         icons[size] = tx.commitContent(img_data, "image/png")
      }
      return icons
   }
}

export class PWAPackageTask extends BuildTask {
   constructor(
      target: BuildTarget,
      readonly app: AppEntry,
   ) {
      super(target)
   }
   async execute() {
      const { app } = this
      const tx = this.target.edit()
      const desc = app.descriptor

      // Create webapp icons
      let icons: WebAppManifest["icons"] = undefined
      if (desc.icon) {
         try {
            const base_icon = Sharp(Path.resolve(app.baseDir, desc.icon))
            icons = await this.createIcons(base_icon)

            // Create default favorite icon
            const favicon_data = await createIcon(base_icon, 64, "webp")
            tx.commitFile("favicon.webp", favicon_data, "image/webp")
         }
         catch (e) {
            this.log.error(`${app.path} has invalid icons: ${e.message}`)
         }
      }

      tx.commitFile(`manifest.json`, JSON.stringify({
         "short_name": desc.name,
         "name": desc.title || desc.name,
         "icons": icons,
         "id": "/index.html",
         "start_url": "/index.html",
         "background_color": "#3367D6",
         "display": "standalone",
         "scope": "/",
         "theme_color": "#3367D6",
         "description": desc.description || "",
         "shortcuts": [],
         ...desc.manifest,
      }, null, 2))
   }
   async createIcons(base: Sharp.Sharp): Promise<WebAppManifest["icons"]> {
      const tx = this.target.edit()
      const icons = []
      for (const size of [32, 64, 128, 256, 512]) {
         const img_data = await createIcon(base, size, "webp")
         const img_url = tx.commitContent(img_data, "image/webp")
         icons.push({
            "src": img_url,
            "sizes": `${size}x${size}`,
            "type": "image/webp"
         })
      }
      return icons
   }
}

function createIcon(base: Sharp.Sharp, size: number, format: "webp" | "png"): Promise<Buffer> {
   return base
      .resize(size, size, { fit: 'cover', position: 'center', })
      .toFormat(format, { quality: 80 })
      .toBuffer()
}


