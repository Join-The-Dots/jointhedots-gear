import Fs from "node:fs"
import Fsp from "node:fs/promises"
import { readJsonFile } from "../storage.ts"
import { checkComponentManifest, type BundleManifest, type ComponentManifest } from "../component.ts"
import { Bundle, Library, Workspace, type AppDescriptor, type DeclarationDescriptor, type PackageDescriptor } from "../workspace.ts"
import { file, make_canonical_path, make_normalized_dirname, make_normalized_path, make_relative_path } from "../../utils/file.ts"
import { findConfigFile, is_config_filename, readConfigFile, readSingletonConfigFile } from "./config-loader.ts"
import { read_lockfile, type PackageDepsInfo } from "./lockfile.ts"
import { LoadLibraryPackager, type LibraryPackager } from "../packager.ts"
import { DefaultLibraryPackager } from "../packagers/packager-standard.ts"

const exclude_dirs = ["node_modules", ".git"]

function is_ignored_dir(ws: Workspace, path: string): boolean {
   const normalized_path = make_normalized_path(path)
   for (const ignored of ws.ignored_directories) {
      if (normalized_path === ignored || normalized_path.startsWith(ignored + "/")) {
         return true
      }
   }
   return false
}

export async function discover_component(lib: Library, fpath: string) {
   const { master } = lib
   if (master.components.has(fpath)) {
      return true
   }
   try {
      const desc = await readConfigFile<ComponentManifest>(fpath)
      if (!desc) throw new Error("failed to parse config")
      if (desc.type !== "bundle") {
         const err = checkComponentManifest(desc, fpath)
         if (err) throw err
         if (!desc.apis && desc["services"]) {
            desc.apis = desc["services"] // Migrate renaming 'services' -> 'apis'
            lib.log.warn(`Component '${desc.$id}' manifest shall rename 'services' -> 'apis'`)
         }
         master.components.set(fpath, desc)
         lib.log.info(`+ 🧩 component: ${desc.$id} ${desc.type ? `(${desc.type})` : ""}`)
         return true
      }
      else if (master.path !== make_normalized_dirname(fpath)) {
         lib.log.error(`invalid bundle component at ${fpath}`)
      }
   }
   catch (e) {
      lib.log.error(`invalid component at ${fpath}: ${e?.message}`)
   }
   return false
}

async function discover_declaration(lib: Library, fpath: string) {
   try {
      const desc = await readConfigFile<DeclarationDescriptor>(fpath)
      if (!desc) throw new Error("failed to parse config")
      lib.declarations.set(fpath, desc)
      lib.log.info(`+ 🔧 declaration: ${make_relative_path(lib.path, fpath)}`)
   }
   catch (e) {
      lib.log.error(`invalid declaration at ${fpath}: ${e?.message}`)
   }
}

async function discover_application(lib: Library, fpath: string) {
   try {
      const desc = await readConfigFile<AppDescriptor>(fpath)
      if (!desc) throw new Error("failed to parse config")
      lib.applications.set(fpath, desc)
      lib.log.info(`+ 🚀 application: ${make_relative_path(lib.path, fpath)}`)
   }
   catch (e) {
      lib.log.error(`invalid application at ${fpath}: ${e?.message}`)
   }
}

export async function discover_library_definitions(lib: Library, path: string, subdir: boolean = false) {

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
            if (await discover_bundle(lib, fpath) === Discovered.None) {
               await discover_library_definitions(lib, fpath, true)
            }
         }
      }
      else if (fstat.isFile()) {
         if (is_config_filename(fname, "component")) {
            await discover_component(lib, fpath)
         }
         else if (is_config_filename(fname, "application")) {
            await discover_application(lib, fpath)
         }
         else if (is_config_filename(fname, "declaration")) {
            await discover_declaration(lib, fpath)
         }
         else if (fname === "publication.json") {
            throw new Error(`Rename 'publication.json' into 'declaration.json' at: ${fpath}`)
         }
      }
   }
}

enum Discovered {
   None,
   Ignored,
   Registered,
}

async function discover_library(ws: Workspace, location: string) {
   const lib_path = make_canonical_path(ws.path, location)
   if (is_ignored_dir(ws, lib_path)) return Discovered.Ignored

   const has_bundle_manifest = file.exists(findConfigFile(lib_path, "bundle.manifest"))
   if (has_bundle_manifest) {
      // discover_bundle
      return Discovered.Ignored
   }

   const package_path = lib_path + "/package.json"
   const has_package_manifest = file.exists(package_path)
   if (!has_package_manifest) return Discovered.None

   const lib_manifest = await readJsonFile<PackageDescriptor>(package_path)
   if (!lib_manifest?.name) return Discovered.Ignored
   if (!lib_manifest?.dots) return Discovered.None

   const other = ws.get_library(lib_manifest.name)
   if (other) {
      if (lib_path.includes(other.path)) {
         ws.log.info(`ignore library build at ${lib_path}`)
         return Discovered.Ignored
      }
      else {
         throw new Error(`library '${lib_manifest.name}' declared multiple times\n - ${other.path}\n - ${lib_path}`)
      }
   }

   const lib = new Library(lib_manifest.name, lib_path, lib_manifest, ws)
   ws.libraries.push(lib)
   ws.log.info(`+ 📚 library: ${lib.get_id()} (${make_relative_path(ws.path, location)})`)

   // Discover library-level search_directories, lockfile, and constants (walk up to workspace root)
   lib.constants = { ...ws.constants }
   for (let path = lib.path; ;) {
      const package_json = await readJsonFile(path + "/package.json")
      if (package_json) {
         const search_path = path + "/node_modules"
         if (Fs.existsSync(search_path)) {
            lib.search_directories.push(search_path)
         }
         if (package_json.constants) {
            lib.constants = {
               ...package_json.constants,
               ...lib.constants,
            }
         }
      }
      if (!lib.deps) {
         lib.deps = await read_lockfile(path)
      }
      const next_path = make_normalized_dirname(path)
      if (next_path === path) break
      path = next_path
   }
   if (!lib.deps) throw new Error(`Lock file not found for '${lib.name}'`)

   // Discover side bundles from lock file
   for (const dep_id in lib.deps.resolved_paths) {
      const dep_path = lib.deps.resolved_paths[dep_id]
      await discover_bundle(lib, dep_path)
   }

   // Load library packager
   let packager: LibraryPackager = null
   const declaration_config = await readSingletonConfigFile<DeclarationDescriptor>(lib_path, "declaration")
   const packager_ref = declaration_config && declaration_config.data?.packager
   if (packager_ref) {
      packager = await LoadLibraryPackager(packager_ref)
   }
   else {
      packager = new DefaultLibraryPackager()
   }

   // Discover library with packager
   await packager.discover_library(lib)

   return Discovered.Registered
}

async function discover_bundle(lib: Library, location: string) {
   const bun_path = make_canonical_path(lib.path, location)
   if (is_ignored_dir(lib.workspace, bun_path)) return Discovered.Ignored

   const bun_manif_path = findConfigFile(bun_path, "bundle.manifest")
   if (!bun_manif_path) return Discovered.None
   const bun_manif = await readConfigFile<BundleManifest>(bun_manif_path)
   if (!bun_manif) {
      lib.log.error(`bundle manifest invalid at: ${bun_manif_path}`)
      return Discovered.Ignored
   }

   const other = lib.get_bundle(bun_manif.$id)
   if (other) {
      if (bun_path.includes(other.path)) {
         lib.log.info(`ignore bundle at ${bun_path}`)
         return Discovered.Ignored
      }
      else {
         lib.log.error(`bundle '${bun_manif.$id}' declared multiple times\n - ${other.path}\n - ${bun_path}`)
         return Discovered.Ignored
      }
   }

   // Register bundle into library
   const bun = new Bundle(bun_manif, lib.path, lib)
   lib.shelve.push(bun)
   lib.log.info(`+ 📦 bundle: ${bun.id} ⏬`)

   // Analyze library deployment manifest (supports json/yaml/yml/toml, singleton)
   if (bun_manif?.data?.components) {
      for (const pub of bun_manif.data.components) {
         const fpath = bun_path + "/" + (pub.ref ?? pub.id)
         await discover_component(lib, fpath)
      }
   }

   return Discovered.Registered
}

function show_constants(ws: Workspace) {
   // Collect all constant keys across libraries
   const all_keys = new Set<string>()
   for (const lib of ws.libraries) {
      for (const key in lib.constants) all_keys.add(key)
   }
   for (const name of all_keys) {
      const lib_values = new Map<string | number, string[]>()
      for (const lib of ws.libraries) {
         if (name in lib.constants) {
            const val = lib.constants[name]
            const key = String(val)
            if (!lib_values.has(val)) lib_values.set(val, [])
            lib_values.get(val).push(lib.name)
         }
      }
      if (lib_values.size === 1) {
         const [value] = lib_values.keys()
         ws.log.info(`+ 🔖 ${name} = ${value}`)
      } else {
         for (const [value, libs] of lib_values) {
            ws.log.info(`+ 🔖 ${name} = ${value} (${libs.join(", ")})`)
         }
      }
   }
}

export async function discover_workspace(ws: Workspace): Promise<Workspace> {

   async function walk(dir: string) {
      if (await discover_library(ws, dir) === Discovered.None) {
         for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue
            const fullPath = dir + "/" + entry.name
            if (entry.isDirectory()) {
               await walk(fullPath)
            }
         }
      }
   }

   await walk(ws.path)

   show_constants(ws)
   return ws
}
