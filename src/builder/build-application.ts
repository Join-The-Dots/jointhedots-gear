import Express from 'express'
import { matchComponentSelection, AppEntry, ChromeAppDescriptor, ChromeAppManifest, } from "../model/workspace.js"
import { StorageFiles } from "../model/storage.js"
import { BuildTarget, BuildTask, ComponentCatalogsTask, resolve_entry_path, WebviewTask } from "./build-target.js"
import Path from "node:path"
import Sharp from "sharp"
import { WebAppManifest } from 'web-app-manifest'

export type BuildApplicationOptions = {
   app: AppEntry
   storage: StorageFiles
   version: string
   devmode?: boolean
   watch?: boolean
   port?: number
}

export function create_application_target(opts: {
   app: AppEntry
   storage: StorageFiles
   version: string
   devmode: boolean
   devserver?: string
   watch: boolean
}): BuildTarget {
   const { app, version } = opts
   const { type, name, webviews, modules, assets, components } = app.descriptor
   const ws = app.library.workspace
   const target = new BuildTarget(name, opts.storage, ws, opts.devmode == true, opts.watch == true)

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
      const { title, entry, favicon } = webviews[name]
      const webview = {
         ...webviews[name],
         entry: resolve_entry_path(app.library, entry, app.baseDir),
         favicon: favicon ? resolve_entry_path(app.library, favicon, app.baseDir) : null,
      }
      target.esmodules.add_entry(name, webview.entry)
      target.tasks.push(new WebviewTask(target, name, title || name, webview, html_injects))
      if (opts.devserver) {
         console.log(`+ webview '${app.library.name}': ${name} : ${opts.devserver}/${name}`)
      }
   }

   // Add application modules
   for (const name in modules) {
      const entry = resolve_entry_path(app.library, modules[name], app.baseDir)
      if (name.endsWith(".js")) {
         target.esmodules.add_entry(name.slice(0, -3), entry)
         if (opts.devserver) {
            console.log(`+ module '${app.library.name}': ${name} : ${opts.devserver}/${name}`)
         }
      }
      else {
         target.error(`Invalid module name '${name}' in ${name}`)
      }
   }

   // Add application static assets
   if (Array.isArray(assets)) {
      for (const asset of assets) {
         target.assets.add_entry(asset, app.baseDir, app.library)
      }
   }

   // Add components catalog
   target.tasks.push(new ComponentCatalogsTask(target))

   // Add workspace components
   for (const lib of ws.libraries) {
      for (const [path, desc] of lib.components) {
         if (!matchComponentSelection (components, desc.selectors)) continue
         const baseDir = Path.dirname(path)
         target.add_component(desc, baseDir, lib)
      }
   }

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

export async function build_application(opts: BuildApplicationOptions): Promise<void> {
   const { app, storage } = opts

   const target = create_application_target({
      app,
      storage: opts.storage,
      version: opts.version,
      devmode: opts.devmode,
      devserver: opts.port && `http://localhost:${opts.port}`,
      watch: opts.port ? true : opts.watch,
   })

   console.log(`> Build app: ${target.name}`)
   if (opts.port) {
      await Promise.all([
         target.build(),
         serve(opts.port, storage)
      ])
   }
   else {
      await target.build()
   }
}

async function serve(port: number, storage: StorageFiles) {
   const app = Express()
   app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader('Access-Control-Allow-Methods', '*')
      res.setHeader("Access-Control-Allow-Headers", "*")
      next()
   })
   app.get('/esbuild', storage.on_changes.route())
   app.get('*', storage.route())
   app.listen(port, () => {
      console.log(`Server is running at http://localhost:${port}`)
   })
   return new Promise((resolve) => {
      process.on('SIGQUIT', () => resolve(null))
   })
}


class ChromePackageTask extends BuildTask {
   constructor(
      target: BuildTarget,
      readonly app: AppEntry,
      readonly version: string,
   ) {
      super(target)
   }
   async execute() {
      const { target, app } = this
      const { storage } = target
      const desc = app.descriptor as ChromeAppDescriptor
      const infos: ChromeAppManifest = desc.manifest || {} as any
      const icon = Sharp(Path.resolve(app.baseDir, desc.icon))

      // Create default favorite icon
      const favicon_data = await createIcon(icon, 64, "png")
      const favicon_url = await storage.commitContent(favicon_data, "image/png")

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
      storage.commitFile("manifest.json", JSON.stringify(manifest, null, 2))
   }
   async createIcons(base: Sharp.Sharp): Promise<ChromeAppManifest["icons"]> {
      const { storage } = this.target
      const icons = {}
      for (const size of [16, 32, 64, 128, 256]) {
         const img_data = await createIcon(base, size, "png")
         icons[size] = storage.commitContent(img_data, "image/png")
      }
      return icons
   }
}

class PWAPackageTask extends BuildTask {
   constructor(
      target: BuildTarget,
      readonly app: AppEntry,
   ) {
      super(target)
   }
   async execute() {
      const { target, app } = this
      const { storage } = target
      const desc = app.descriptor

      // Create webapp icons
      const base_icon = Sharp(Path.resolve(app.baseDir, desc.icon))
      const icons = await this.createIcons(base_icon)

      // Create default favorite icon
      const favicon_data = await createIcon(base_icon, 64, "webp")
      storage.commitFile("favicon.webp", favicon_data, "image/webp")

      storage.commitFile(`manifest.json`, JSON.stringify({
         "short_name": desc.name,
         "name": desc.title || desc.name,
         "icons": icons,
         "id": "/show.html",
         "start_url": "/show.html",
         "background_color": "#3367D6",
         "display": "standalone",
         "scope": "/",
         "theme_color": "#3367D6",
         "description": desc.description || "",
         "shortcuts": []
      }, null, 2))
   }
   async createIcons(base: Sharp.Sharp): Promise<WebAppManifest["icons"]> {
      const { storage } = this.target
      const icons = []
      for (const size of [32, 64, 128, 256, 512]) {
         const img_data = await createIcon(base, size, "webp")
         const img_url = storage.commitContent(img_data, "image/webp")
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
