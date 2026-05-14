import Path from "node:path"
import { Bundle, Library } from "../workspace.ts"
import { StorageFiles, type IStorageZone } from "../storage.ts"
import { BuildTarget } from "./target.ts"
import { TypescriptDefinitionTask } from "../tasks/emit-typescript-definition.ts"
import { PackageManifestTask } from "../tasks/emit-package-manifest.ts"
import { PathQualifier } from "../tasks/path-helpers.ts"
import { create_export_map } from "../helpers/create-manifests.ts"
import { DependencyDeduplicationPlugin, collectLibraryGraph } from "../tasks/emit-esmodules.ts"
import { BundleManifestTask } from "../tasks/emit-bundle-manifest.ts"
import { ArtifactNpmTask } from "../tasks/emit-artifact.ts"

export type BuildBundleOptions = {
   bundle: Bundle
   shelve: StorageFiles
   version: string
   devmode: boolean
   watch: boolean
   clean: boolean
   artifactDir?: string
}

export enum PathStatus {
   Unknown = undefined,
   Internal = 1,
   External = 2,
   Dependency = 3,
   ExternalBundle = 4,
}

export function create_plugin_target(opts: {
   bundle: Bundle
   library: Library
   storage: IStorageZone
   version: string
   devmode: boolean
   watch: boolean
   clean: boolean
}): BuildTarget {
   const { bundle, library: lib, storage } = opts
   const target = new BuildTarget(bundle.id, storage, lib, opts.devmode == true, opts.watch == true, opts.clean == true)

   // Prepare esm setup
   target.modules.set_root(lib.path)

   // Add bundle package.json
   target.tasks.push(new PackageManifestTask(target, lib, opts.version))

   // Add bundle types.d.ts
   target.tasks.push(new TypescriptDefinitionTask(target, lib))

   // Add bundle exporteds
   const entries = create_export_map(lib, lib.master)
   for (const exp_id in entries) {
      const exp = entries[exp_id]
      target.modules.add_entry(exp.basename, exp.source)
   }

   // Add bundle content
   if (bundle) {

      // Add bundle manifest
      target.tasks.push(new BundleManifestTask(target, bundle))

      // Add bundle components
      for (const [path, desc] of bundle.components) {
         const baseDir = Path.dirname(path)
         target.add_component(desc, baseDir, bundle)
      }
   }

   // Add declarations descriptors
   for (const [path, desc] of lib.declarations) {
      if (desc.assets) {
         const baseDir = Path.dirname(path)
         for (const entry of desc.assets) {
            target.assets.add_entry(entry, baseDir, lib)
         }
      }
   }

   // Add application webviews entries
   for (const [appPath, app] of lib.applications) {
      const baseDir = Path.dirname(appPath)
      for (const name in app.webviews) {
         const { entry } = app.webviews[name]
         const entry_name = lib.make_file_id("webview", name)
         const esmodule_entry = lib.resolve_entry_path(entry, baseDir)
         target.modules.add_entry(entry_name, esmodule_entry)
      }
   }

   // Add application modules entries
   for (const [appPath, app] of lib.applications) {
      const baseDir = Path.dirname(appPath)
      for (const name in app.modules) {
         const entry_name = lib.make_file_id("module", name.slice(0, -3))
         const entry = lib.resolve_entry_path(app.modules[name], baseDir)
         if (name.endsWith(".js")) {
            target.modules.add_entry(entry_name, entry)
         }
         else {
            target.log.error(`Invalid module name '${name}' in ${name}`)
         }
      }
   }

   const paths_qualifier = new PathQualifier<PathStatus | Bundle>()
   paths_qualifier.set(".", PathStatus.Internal)
   paths_qualifier.set("..", PathStatus.Internal)
   const deps = bundle.dependencies
   if (deps) {
      for (const dep of deps) {
         paths_qualifier.set(dep, PathStatus.ExternalBundle)
      }
   }
   for (const xbun of lib.shelve) {
      if (xbun !== bundle) {
         paths_qualifier.set(xbun.id, xbun)
         paths_qualifier.set(xbun.alias, xbun)
         for (const dist in xbun.distribueds) {
            paths_qualifier.set(dist, xbun)
         }
      }
   }
   paths_qualifier.set(bundle.id, PathStatus.Internal)
   paths_qualifier.set(bundle.alias, PathStatus.Internal)
   for (const dist in bundle.distribueds) {
      let state = paths_qualifier.check(dist)
      if (state === PathStatus.Unknown) {
         paths_qualifier.set(dist, PathStatus.Internal)
      }
      else if (state instanceof Bundle) {
         target.log.error(`Bundle cannot the already distributed '${dist}' by '${state.id}'`)
      }
      else if (state !== PathStatus.Internal) {
         target.log.error(`Bundle cannot distributed '${dist}' (status ${state})`)
      }
   }
   // TODO: traverse all workspace bundles to add their entrypoint has PathStatus.Dependency

   // Register esbuild plugin for external dependencies
   target.modules.plugins.push({
      name: "externals",
      setup(build) {
         const externalBundleModules = new Map<string, string>()

         build.onResolve({ filter: /.*/ }, (args) => {
            const { namespace, path, importer } = args
            if (namespace === "external-bundle-proxy") {
               return { external: true }
            }
            let state = paths_qualifier.check(path)
            if (state === PathStatus.Dependency || state === PathStatus.External) {
               //target.log.warn(`External: ${path} <- ${importer}`)
               return { external: true }
            }
            if (state === PathStatus.ExternalBundle) {
               throw new Error(`ExternalBundle: ${path} <- ${importer}`)
            }
            if (state instanceof Bundle) {
               //target.log.warn(`Bundle: ${state.id} <- ${importer}`)
               const entry_id = state.resolve_export(path)
               if (!entry_id) {
                  return { errors: [{ text: `Bundle '${state.id}' do not distribute expected entry: ${path}` }] }
               }
               if (entry_id.includes("#")) {
                  return { errors: [{ text: `TODO: manage module internal identifier access` }] }
               }

               // Create virtual module content that re-exports from external bundle
               const externalPath = "/" + state.id + "/" + entry_id
               const externalBundleModuleId = `external-bundle:${path}_proxy.cjs`
               if (!externalBundleModules.has(externalBundleModuleId)) {
                  // Use namespace import to safely handle modules that may not have default export
                  const moduleContent = `import * as _ns from "${externalPath}"; module.exports={..._ns?.default,..._ns,default:_ns?.default,__esModule:true};`
                  externalBundleModules.set(externalBundleModuleId, moduleContent)
               }
               return {
                  path: externalBundleModuleId,
                  namespace: "external-bundle-proxy",
               }
            }
            //target.log.warn(`Internal: ${path} <- ${importer}`)
         })

         // Load virtual proxy modules for external bundle references
         build.onLoad({ filter: /.*/, namespace: "external-bundle-proxy" }, (args) => {
            const contents = externalBundleModules.get(args.path)
            if (!contents) {
               return { errors: [{ text: `External bundle proxy not found: ${args.path}` }] }
            }
            return {
               contents,
               loader: "js",
               resolveDir: lib.path,
            }
         })

         // Handle imports from within the proxy modules - these should be truly external
         build.onResolve({ filter: /^\.\.\//, namespace: "external-bundle-proxy" }, (args) => {
            return { path: args.path, external: true }
         })
      }
   })

   // Register esbuild plugin for dependency deduplication (graph-based + singleton)
   const rootNodeModules = lib.search_directories[0] || Path.join(lib.path, 'node_modules')
   const libGraph = collectLibraryGraph(lib)
   target.modules.plugins.push(DependencyDeduplicationPlugin(libGraph, rootNodeModules, target.log))

   return target
}

export async function build_app_composable_plugin(opts: BuildBundleOptions): Promise<BuildTarget> {
   const { bundle } = opts
   if (bundle.source) {
      const storage = opts.shelve.branch(bundle.id)
      storage.clean()

      const target = create_plugin_target({
         bundle,
         library: bundle.source,
         storage: storage,
         version: opts.version,
         devmode: opts.devmode,
         watch: opts.watch,
         clean: opts.clean,
      })

      if (opts.artifactDir) {
         target.finalTasks.push(new ArtifactNpmTask(target, opts.artifactDir))
      }

      target.log.info(`Build bundle: ${target.name}`)
      await target.build()
      return target
   }
   else {
      bundle.log.info(`Prebuild bundle: ${opts.bundle.id}`)
   }
}

