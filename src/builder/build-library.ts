import { Library, type PackageDescriptor } from "../model/workspace.ts"
import { StorageFiles } from "../model/storage.ts"
import ChildProcess from "child_process"
import { BuildTarget, BundleManifestTask } from "./build-target.ts"
import { TypescriptDefinitionTask } from "./emit-dts.ts"
import Path from "node:path"
import { create_manifests } from "../model/helpers/create-manifests.ts"

export type BuildLibraryOptions = {
   library: Library
   storage: StorageFiles
   version: string
   devmode: boolean
   watch: boolean
   clean: boolean
}

export function create_library_target(opts: {
   library: Library
   storage: StorageFiles
   version: string
   devmode: boolean
   watch: boolean
   clean: boolean
}): BuildTarget {
   const lib = opts.library
   const target = new BuildTarget(lib.name, opts.storage, lib.workspace, opts.devmode == true, opts.watch == true, opts.clean == true)
   const manifs = create_manifests(lib, lib.bundle, opts.version)

   // Add bundle exporteds
   const { esmodules } = target
   for (const exp_id in manifs.entries) {
      const exp = manifs.entries[exp_id]
      esmodules.add_entry(exp.basename, exp.source)
   }

   // Add library types.d.ts
   target.tasks.push(new TypescriptDefinitionTask(target, lib))

   // Add library package.json
   target.assets.add_static_json("package.json", manifs.package)

   // Add bundle content
   const { bundle } = lib
   if (bundle) {

      // Add bundle catalog
      target.tasks.push(new BundleManifestTask(target, bundle))

      // Add library components
      for (const [path, desc] of bundle.components) {
         const baseDir = Path.dirname(path)
         target.add_component(desc, baseDir, lib)
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

   // Register esbuild plugin for external dependencies
   target.esmodules.polyfilled = false
   target.esmodules.plugins.push({
      name: "externals",
      setup(build) {
         const lib_prefix = lib.name + "/"
         build.onResolve({ filter: /.*/ }, ({ path }) => {
            if (path !== lib.name && !path.startsWith(lib_prefix) && !path.startsWith(".")) {
               //target.log.warn("exclude:", path)
               return { external: true }
            }
         })
      }
   })

   return target
}

export async function build_library(opts: BuildLibraryOptions, packageDir?: string) {
   //opts.storage.clean()

   const target = create_library_target({
      library: opts.library,
      storage: opts.storage,
      version: opts.version,
      devmode: opts.devmode,
      watch: opts.watch,
      clean: opts.clean,
   })

   target.log.info(`Build library: ${target.name}`)
   await target.build()

   if (!target.watch && packageDir) {
      ChildProcess.execSync("npm pack --pack-destination " + packageDir, { cwd: target.storage.getBaseDirFS() })
   }
}
