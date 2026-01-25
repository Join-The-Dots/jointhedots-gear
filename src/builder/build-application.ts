import { Library, matchComponentSelection, type AppEntry, type ChromeAppDescriptor, type ChromeAppManifest, type WebviewEntry } from "../model/workspace.ts"
import { StorageFiles } from "../model/storage.ts"
import { BuildTarget, BuildTask, ComponentCatalogsTask } from "./build-target.ts"
import type { WebAppManifest } from 'web-app-manifest'
import Path from "node:path"
import Fs from "node:fs"
import Sharp from "sharp"
import MIME from 'mime'
import { build_app_composable_host } from "./build-app-host.ts"

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
   const lib = app.library
   const ws = lib.workspace
   const deps = {
      ...app.library.descriptor.dependencies,
      ...app.library.descriptor.devDependencies,
      ...app.library.descriptor.peerDependencies,
   }
   const libs: Library[] = []
   for (const depId in deps) {
      const lib = ws.get_library(depId)
      if (ws.get_library(depId)) {
         libs.push(lib)
      }
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
         target.log.info(`+ webview '${app.library.name}': ${name} : ${opts.devserver}/${name}`)
      }
   }

   // Add application modules
   for (const name in modules) {
      if (name.endsWith(".js")) {
         const entry_name = lib.make_file_id("module", name.slice(0, -3))
         target.esmodules.add_entry_typescript(`export * from "./${entry_name}.js"`, name.slice(0, -3))
         if (opts.devserver) {
            target.log.info(`+ module '${app.library.name}': ${name} : ${opts.devserver}/${name}`)
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

   // Add components catalog
   target.tasks.push(new ComponentCatalogsTask(target))

   // Add workspace components
   for (const lib of libs) {
      for (const [path, desc] of lib.components) {
         if (!matchComponentSelection(components, desc.selectors)) continue
         const baseDir = Path.dirname(path)
         target.add_component(desc, baseDir, lib)
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

   // Register esbuild plugin for peers dependencies deduplication
   target.esmodules.plugins.push(createPeersDependenciesDeduplicationPlugin(app, libs))
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
            console.error(`${app.path} has invalid icons: ${e.message}`)
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

/**
 * Creates an esbuild plugin that deduplicates peer dependencies across workspace libraries.
 * 
 * When multiple libraries declare the same peer dependency, this plugin ensures they all
 * resolve to the same version from the application's node_modules, preventing duplicate
 * bundles of packages like React, React DOM, etc.
 */
function createPeersDependenciesDeduplicationPlugin(app: AppEntry, libs: Library[]): import('esbuild').Plugin {
   // Collect all peer dependencies from all workspace libraries
   const peerDependencies = new Map<string, string>()
   
   // Add app's own peer dependencies first (highest priority)
   const appPeers = app.library.descriptor.peerDependencies || {}
   for (const [name, version] of Object.entries(appPeers)) {
      peerDependencies.set(name, version as string)
   }
   
   // Add peer dependencies from all dependent libraries
   for (const lib of libs) {
      const libPeers = lib.descriptor.peerDependencies || {}
      for (const [name, version] of Object.entries(libPeers)) {
         // Only add if not already defined (app takes priority)
         if (!peerDependencies.has(name)) {
            peerDependencies.set(name, version as string)
         }
      }
   }

   // Find the app's node_modules path (where app dependencies are installed)
   const appNodeModules = Path.join(app.library.path, 'node_modules')
   
   // Find the root node_modules path from workspace search directories
   const ws = app.library.workspace
   const rootNodeModules = ws.search_directories[0] || Path.join(ws.path, 'node_modules')

   // Determine which node_modules to use for resolution
   // Prefer app's node_modules if it exists, otherwise use root
   const targetNodeModules = Fs.existsSync(appNodeModules) ? appNodeModules : rootNodeModules

   // Cache resolved paths to avoid re-resolving the same package multiple times
   const resolvedPaths = new Map<string, string>()

   // Log what we're deduplicating
   console.log(`[deduplicate-peers] Deduplicating ${peerDependencies.size} peer dependencies from ${targetNodeModules}:`)
   for (const [name] of peerDependencies) {
      console.log(`  - ${name}`)
   }

   return {
      name: "deduplicate-peers-dependencies",
      setup(build) {
         // Intercept resolution of peer dependencies
         build.onResolve({ filter: /.*/ }, async (args) => {
            // Avoid infinite recursion - skip if already processed by this plugin
            if (args.pluginData?.deduplicatedPeer) {
               return null
            }

            // Skip if not a bare module specifier (relative or absolute paths)
            if (args.path.startsWith('.') || args.path.startsWith('/') || Path.isAbsolute(args.path)) {
               return null
            }

            // Extract the package name (handle scoped packages like @scope/package)
            const packageName = getPackageName(args.path)
            
            // Check if this is a peer dependency we're tracking
            if (!peerDependencies.has(packageName)) {
               return null
            }

            // Check cache first
            const cacheKey = args.path
            if (resolvedPaths.has(cacheKey)) {
               return { path: resolvedPaths.get(cacheKey), namespace: 'file' }
            }

            // Always resolve peer dependencies from the target node_modules
            // This ensures all imports of the same package resolve to the same instance
            const result = await build.resolve(args.path, {
               kind: args.kind,
               resolveDir: targetNodeModules,
               importer: args.importer,
               namespace: args.namespace,
               pluginData: { ...args.pluginData, deduplicatedPeer: true },
            })

            if (!result.errors || result.errors.length === 0) {
               // Cache the resolved path
               resolvedPaths.set(cacheKey, result.path)
               console.log(`[deduplicate-peers] ${args.path} -> ${result.path}`)
               return result
            }

            return null
         })
      }
   }
}

/**
 * Extracts the package name from an import path.
 * Handles both regular packages (e.g., "react") and scoped packages (e.g., "@scope/package").
 */
function getPackageName(importPath: string): string {
   if (importPath.startsWith('@')) {
      // Scoped package: @scope/package or @scope/package/subpath
      const parts = importPath.split('/')
      if (parts.length >= 2) {
         return `${parts[0]}/${parts[1]}`
      }
      return importPath
   } else {
      // Regular package: package or package/subpath
      const slashIndex = importPath.indexOf('/')
      return slashIndex === -1 ? importPath : importPath.substring(0, slashIndex)
   }
}
