import { Bundle, Library } from "../model/workspace.ts"
import { StorageFiles } from "../model/storage.ts"
import { BuildTarget, ComponentCatalogsTask } from "./build-target.ts"
import { TypescriptDefinitionTask } from "./emit-dts.ts"
import Path from "node:path"
import { PathQualifier } from "./helpers/path-helpers.ts"
import { create_manifests } from "../model/helpers/create-manifests.ts"

export type BuildBundleOptions = {
   bundle: Bundle
   shelve: StorageFiles
   version: string
   devmode: boolean
   watch: boolean
   clean: boolean
}

export enum PathStatus {
   Unknown = undefined,
   Internal = 1,
   External = 2,
   Dependency = 3,
   ExternalBundle = 4,
}

export function create_bundle_target(opts: {
   bundle: Bundle
   library: Library
   shelve: StorageFiles
   version: string
   devmode: boolean
   watch: boolean
   clean: boolean
}): BuildTarget {
   const { bundle, library, shelve } = opts
   const lib = library
   const storage = shelve.branch(bundle.id)
   const target = new BuildTarget(bundle.id, storage, lib.workspace, opts.devmode == true, opts.watch == true, opts.clean == true)
   const manifs = create_manifests(lib, bundle, opts.version)

   // Add bundle package.json
   target.assets.add_static_json("package.json", manifs.package)

   // Add bundle types.d.ts
   target.tasks.push(new TypescriptDefinitionTask(target, lib))

   // Add components catalog
   target.tasks.push(new ComponentCatalogsTask(target))

   // Add bundle exporteds
   const { esmodules } = target
   for (const exp_id in manifs.entries) {
      const exp = manifs.entries[exp_id]
      esmodules.add_entry(exp.basename, exp.source)
   }

   // Add bundle components
   for (const [path, desc] of lib.components) {
      const baseDir = Path.dirname(path)
      target.add_component(desc, baseDir, lib)
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
         target.esmodules.add_entry(entry_name, esmodule_entry)
      }
   }

   // Add application modules entries
   for (const [appPath, app] of lib.applications) {
      const baseDir = Path.dirname(appPath)
      for (const name in app.modules) {
         const entry_name = lib.make_file_id("module", name.slice(0, -3))
         const entry = lib.resolve_entry_path(app.modules[name], baseDir)
         if (name.endsWith(".js")) {
            target.esmodules.add_entry(entry_name, entry)
         }
         else {
            target.log.error(`Invalid module name '${name}' in ${name}`)
         }
      }
   }

   const paths_qualifier = new PathQualifier<PathStatus | Bundle>()
   paths_qualifier.set(".", PathStatus.Internal)
   paths_qualifier.set("..", PathStatus.Internal)
   if (bundle.dependencies) {
      for (const dep of bundle.dependencies) {
         paths_qualifier.set(dep, PathStatus.ExternalBundle)
      }
   }
   for (const xbun of lib.workspace.bundles) {
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
   target.esmodules.plugins.push({
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
               //target.log.info(`External: ${path} <- ${importer}`)
               return { external: true }
            }
            if (state === PathStatus.ExternalBundle) {
               throw new Error(`ExternalBundle: ${path} <- ${importer}`)
            }
            if (state instanceof Bundle) {
               //target.log.info(`Bundle: ${state.id} <- ${importer}`)
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
            //target.log.trace(`Internal: ${path} <- ${importer}`)
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
               resolveDir: target.workspace.path,
            }
         })

         // Handle imports from within the proxy modules - these should be truly external
         build.onResolve({ filter: /^\.\.\//, namespace: "external-bundle-proxy" }, (args) => {
            return { path: args.path, external: true }
         })
      }
   })

   return target
}

export async function build_app_composable_bundle(opts: BuildBundleOptions) {
   const { bundle } = opts
   if (bundle.source) {
      const target = create_bundle_target({
         bundle,
         library: bundle.source,
         shelve: opts.shelve,
         version: opts.version,
         devmode: opts.devmode,
         watch: opts.watch,
         clean: opts.clean,
      })

      target.log.info(`Build bundle: ${target.name}`)
      await target.build()
   }
   else {
      bundle.log.info(`Prebuild bundle: ${opts.bundle.id}`)
   }
}

