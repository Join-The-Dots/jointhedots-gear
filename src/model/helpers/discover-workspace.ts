import Fs from "node:fs"
import Fsp from "node:fs/promises"
import Path from "node:path"
import { readJsonFile } from "../storage.ts"
import { checkComponentManifest, type ComponentCatalogsDescriptor, type ComponentManifest } from "../component.ts"
import { makeNormalizedName, NameStyle } from "../../utils/normalized-name.ts"
import { create_manifests } from "./create-manifests.ts"
import { Bundle, Library, Workspace, type AppDescriptor, type DeclarationDescriptor, type PackageBundleDescriptor, type PackageDescriptor } from "../workspace.ts"

const exclude_dirs = ["node_modules"]

async function discover_component(lib: Library, fpath: string) {
   try {
      const data = await Fsp.readFile(fpath)
      const desc = JSON.parse(data.toString()) as ComponentManifest
      const err = checkComponentManifest(desc, fpath)
      if (err) throw err
      lib.components.set(fpath, desc)
      lib.log.info(`+ component '${lib.name}': ${desc.$id}`)
   }
   catch (e) {
      const data = await Fsp.readFile(fpath)
      const desc = JSON.parse(data.toString()) as ComponentManifest
      const err = checkComponentManifest(desc, fpath)
      lib.log.error(`! invalid component at ${fpath}: ${e?.message}`)
   }
}

async function discover_declaration(lib: Library, fpath: string) {
   try {
      const data = await Fsp.readFile(fpath)
      const desc = JSON.parse(data.toString()) as DeclarationDescriptor
      lib.declarations.set(fpath, desc)
      lib.log.info(`+ declaration '${lib.name}': ${Path.relative(lib.path, fpath)}`)
   }
   catch (e) {
      lib.log.error(`! invalid declaration at ${fpath}: ${e?.message}`)
   }
}

async function discover_application(lib: Library, fpath: string) {
   try {
      const data = await Fsp.readFile(fpath)
      const desc = JSON.parse(data.toString()) as AppDescriptor
      lib.applications.set(fpath, desc)
      lib.log.info(`+ application '${lib.name}': ${Path.relative(lib.path, fpath)}`)
   }
   catch (e) {
      lib.log.error(`! invalid declaration at ${fpath}: ${e?.message}`)
   }
}

function is_config_filename(fname: string, config_ext: string) {
   return fname === config_ext || (fname.endsWith(config_ext) && fname.endsWith("." + config_ext))
}

async function discover_library_components(lib: Library, path: string, subdir: boolean = false) {

   // List names from directory
   const fnames = await Fsp.readdir(path)
   if (subdir && fnames.includes("package.json")) {
      return // Stop at other package
   }

   // Collect declaration files from library directory
   for (const fname of await Fsp.readdir(path)) {
      const fpath = `${path}/${fname}`
      const fstat = await Fsp.stat(fpath)
      if (fstat.isDirectory()) {
         if (!exclude_dirs.includes(fname)) {
            await discover_library_components(lib, fpath, true)
         }
      }
      else if (fstat.isFile()) {
         if (is_config_filename(fname, "component.json")) {
            await discover_component(lib, fpath)
         }
         else if (is_config_filename(fname, "application.json")) {
            await discover_application(lib, fpath)
         }
         else if (is_config_filename(fname, "declaration.json")) {
            await discover_declaration(lib, fpath)
         }
         else if (fname === "publication.json") {
            throw new Error(`Rename 'publication.json' into 'declaration.json' at: ${fpath}`)
         }
      }
   }

   // Analyze libary deployment manifest
   const manifest_path = `${path}/components.manifest.json`
   if (Fs.existsSync(manifest_path)) {
      const manifest = JSON.parse(Fs.readFileSync(manifest_path).toString()) as ComponentCatalogsDescriptor
      for (const id in manifest.components) {
         const fpath = Path.join(path, manifest.components[id])
         await discover_component(lib, fpath)
      }
   }
}

function resolve_canonical_path(ws: Workspace, targetPath: string): string {
   targetPath = Path.resolve(ws.path, targetPath)
   try {
      const stats = Fs.lstatSync(targetPath)
      if (stats.isSymbolicLink()) {
         return Path.resolve(Fs.readlinkSync(targetPath))
      }
   }
   catch (err) { }
   return targetPath
}

function make_library_bundle_descriptor(lib: Library, file_desc?: Partial<PackageBundleDescriptor>): PackageBundleDescriptor {
   const desc: PackageBundleDescriptor = {
      id: lib.name,
      alias: lib.name,
      package: lib.get_id(),
      namespaces: [],
      dependencies: [],
      distribueds: {},
   }

   if (file_desc) {
      desc.id = file_desc.id ?? desc.id
      desc.alias = file_desc.alias ?? desc.alias
      if (file_desc.distribueds) {
         const { distribueds } = file_desc
         if (Array.isArray(distribueds)) distribueds.forEach(dist => desc.distribueds[dist] = "*")
         else Object.assign(desc.distribueds, distribueds)
      }
      if (file_desc.namespaces) {
         desc.namespaces = file_desc.namespaces ?? []
      }
      if (file_desc.dependencies) {
         desc.dependencies = file_desc?.dependencies
      }
   }

   const normed_id = makeNormalizedName(desc.id, NameStyle.OBJECT)
   if (normed_id !== desc.id) {
      lib.log.warn(`Bundle '${desc.id}' is normalized into '${normed_id}'`)
      desc.id = normed_id
   }

   return desc
}

async function discover_library(ws: Workspace, location: string) {
   const lib_path = resolve_canonical_path(ws, location)
   const lib_not_exists = ws.libraries.reduce((r, lib) => r && lib.path !== lib_path, true)
   if (lib_not_exists) {
      const lib_desc = await readJsonFile(Path.join(lib_path, "/package.json")) as PackageDescriptor
      const bundle_desc = await readJsonFile(Path.join(lib_path, "/jointhedots.json"))
      if (bundle_desc || lib_desc?.componentsContainer) {
         const other = ws.get_library(lib_desc.name)
         if (other) {
            if (lib_path.includes(other.path)) {
               ws.log.info(`ignore library build at ${lib_path}`)
               return
            }
            else {
               throw new Error(`library '${lib_desc.name}' declared multiple times\n - ${other.path}\n - ${lib_path}`)
            }
         }

         const lib = new Library(lib_desc.name, lib_path, lib_desc, ws)
         ws.libraries.push(lib)

         if (bundle_desc) {
            const bdesc = make_library_bundle_descriptor(lib, bundle_desc)
            let bun = ws.get_bundle(bdesc.id)
            if (!bun) {
               bun = new Bundle(bdesc, ws)
               lib.bundle = bun
               bun.source = lib
               ws.bundles.push(bun)
            }
            else {
               throw new Error(`Library '${lib.get_id()}' is associate to a bundle '${bun.id}' that is already associated`)
            }
         }

         const lib_search_path = lib_path + "/node_modules"
         if (Fs.existsSync(lib_search_path)) {
            lib.search_directories.push(lib_search_path)
         }

         await discover_library_components(lib, Path.resolve(lib_path))
      }

   }
}

async function discover_workspace_libraries(ws: Workspace) {

   async function walk(dir: string) {
      await discover_library(ws, dir)
      for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
         if (entry.name === "node_modules") continue
         const fullPath = Path.join(dir, entry.name)
         if (entry.isDirectory()) {
            await walk(fullPath)
         }
      }
   }

   await walk(Path.resolve(ws.path))
}

export async function discover_workspace(ws: Workspace): Promise<Workspace> {
   let package_lock: any = null
   for (let path = Path.resolve(ws.path); ;) {
      const package_json = await readJsonFile(path + "/package.json")
      if (package_json) {
         const search_path = path + "/node_modules"
         if (Fs.existsSync(search_path)) {
            ws.search_directories.push(search_path)
         }
         if (package_json.constants) {
            ws.constants = {
               ...package_json.constants,
               ...ws.constants,
            }
         }
      }
      const package_lock_path = path + "/package-lock.json"
      if (!package_lock && Fs.existsSync(package_lock_path)) {
         package_lock = await readJsonFile(package_lock_path)
      }
      const next_path = Path.dirname(path)
      if (next_path === path) break
      path = next_path
   }
   if (!package_lock) {
      throw new Error(`Package lock not found for '${ws.name}'`)
   }

   await discover_workspace_libraries(ws)
   for (const location in package_lock.packages) {
      await discover_library(ws, location)
   }

   for (const bun of ws.bundles) {
      if (bun.source) {
         const manifs = create_manifests(bun.source, bun)
         bun.manifest = manifs.bundle
      }
   }

   return ws
}
