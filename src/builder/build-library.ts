import Path from "node:path"
import ChildProcess from "node:child_process"
import { Library } from "../workspace/workspace.ts"
import { StorageFiles } from "../workspace/storage.ts"
import { BuildTarget } from "./build-target.ts"
import { TypescriptDefinitionTask } from "./helpers/emit-typescript-definition.ts"
import { PackageManifestTask } from "./helpers/emit-package-manifest.ts"
import { create_export_map } from "../workspace/helpers/create-manifests.ts"
import { BundleManifestTask } from "./helpers/emit-bundle-manifest.ts"
import { ComponentsDtsTask } from "./helpers/emit-components-dts.ts"
import { ArtifactNpmTask } from "./helpers/emit-artifact.ts"

export type BuildLibraryOptions = {
   library: Library
   storage: StorageFiles
   version: string
   devmode: boolean
   watch: boolean
   clean: boolean
   artifactDir?: string
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
   const target = new BuildTarget(lib.name, opts.storage, lib, opts.devmode == true, opts.watch == true, opts.clean == true)

   // Prepare esm setup
   target.esmodules.set_root(lib.path)

   // Add bundle exporteds
   const entries = create_export_map(lib, lib.master)
   for (const exp_id in entries) {
      const exp = entries[exp_id]
      target.esmodules.add_entry(exp.basename, exp.source)
   }

   // Add library types.d.ts
   target.tasks.push(new TypescriptDefinitionTask(target, lib))

   // Add library package.json
   target.tasks.push(new PackageManifestTask(target, lib, opts.version))
   target.tasks.push(new ComponentsDtsTask(target, lib.master))

   // Add bundle content
   const { master } = lib
   if (master) {

      // Add bundle catalog
      target.tasks.push(new BundleManifestTask(target, master))

      // Add library components
      for (const [path, desc] of master.components) {
         const baseDir = Path.dirname(path)
         target.add_component(desc, baseDir, master)
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

   if (opts.artifactDir) {
      target.finalTasks.push(new ArtifactNpmTask(target, opts.artifactDir))
   }

   target.log.info(`Build library: ${target.name}`)
   await target.build()

   if (!target.watch && packageDir) {
      ChildProcess.execSync("npm pack --pack-destination " + packageDir, { cwd: target.storage.getBaseDirFS() })
   }
}
