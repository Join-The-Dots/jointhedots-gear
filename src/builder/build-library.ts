import { Library, PackageDescriptor } from "../model/workspace.js"
import { StorageFiles } from "../model/storage.js"
import ChildProcess from "child_process"
import { BuildTarget, ComponentCatalogsTask, resolve_entry_path } from "./build-target.js"
import { TypescriptDefinitionTask } from "./emit-dts.js"
import { compute_hashID, make_filename } from "../utils/helpers.js"
import Path from "node:path"

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
   let exports: PackageDescriptor["exports"]

   // Prepare library package exports
   for (const exp_id in lib.descriptor.exports) {
      const exported = lib.descriptor.exports[exp_id]
      const entry = resolve_entry_path(lib, typeof exported === "string" ? exported : exported?.import, lib.path)
      const name = make_filename("export_" + compute_hashID(entry))
      if (!exports) {
         exports = {}
      }
      exports[exp_id] = {
         import: `./${name}.js`,
         types: "./types.d.ts",
      }
      target.esmodules.add_entry(name, entry)
   }

   // Add library types.d.ts
   target.tasks.push(new TypescriptDefinitionTask(target, lib))

   // Add components catalog
   target.tasks.push(new ComponentCatalogsTask(target))

   // Add library package.json
   target.assets.add_static_json("package.json", {
      ...lib.descriptor,
      name: lib.name,
      version: opts.version || lib.descriptor.version,
      type: "module",
      exports,
   } as PackageDescriptor)

   // Add library components
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

   // Register esbuild plugin for external dependencies
   target.esmodules.plugins.push({
      name: "externals",
      setup(build) {
         build.onResolve({ filter: /.*/ }, ({ path }) => {
            if (!path.startsWith(lib.name)) {
               if (!path.startsWith(".") || path.startsWith("react")) {
                  //console.log("> exclude:", path)
                  return { external: true }
               }
            }
         })
      }
   })

   return target
}

export async function build_library(opts: BuildLibraryOptions, packageDir?: string) {
   const target = create_library_target({
      library: opts.library,
      storage: opts.storage,
      version: opts.version,
      devmode: opts.devmode,
      watch: opts.watch,
      clean: opts.clean,
   })

   console.log(`> Build library: ${target.name}`)
   await target.build()

   if (!target.watch && packageDir) {
      ChildProcess.execSync("npm pack --pack-destination " + packageDir, { cwd: target.storage.baseDir })
   }
}

export function make_libname(pattern: string) {
   return pattern.split(/[^a-zA-Z0-9]/).filter(x => x.length > 0).join("-")
}

