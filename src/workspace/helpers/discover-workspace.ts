import Fs from "node:fs"
import Fsp from "node:fs/promises"
import { readJsonFile } from "../storage.ts"
import { checkComponentManifest, type BundleManifest, type ComponentManifest } from "../component.ts"
import { makeNormalizedName, NameStyle } from "../../utils/normalized-name.ts"
import { create_bundle_manifest } from "./create-manifests.ts"
import { Bundle, Library, Workspace, type AppDescriptor, type DeclarationDescriptor, type PackageDescriptor } from "../workspace.ts"
import { file, make_canonical_path, make_normalized_dirname, make_normalized_path, make_relative_path } from "../../utils/file.ts"
import { findConfigFile, is_config_filename, readConfigFile, readSingletonConfigFile } from "./config-loader.ts"
import { read_lockfile } from "./lockfile.ts"
import { LoadLibraryPackager, type LibraryPackager } from "../packager.ts"
import { BundledLibraryPackager, DefaultLibraryPackager } from "../packagers/packager-standard.ts"

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

export function setup_library_bundle(lib: Library) {
   const ws = lib.workspace
   const manif = make_library_bundle_manifest(lib)
   let bun = ws.get_bundle(manif.$id)
   if (!bun) {
      bun = new Bundle(manif, lib.path, ws, lib)
      lib.bundle = bun
      ws.bundles.push(bun)
      lib.log.info(`+ 📦 bundle: ${bun.id}`)
      return bun
   }
   else {
      throw new Error(`Library '${lib.get_id()}' is associate to a bundle '${bun.id}' that is already associated`)
   }
}

export async function discover_component(lib: Library, fpath: string) {
   let bundle = lib.bundle
   if (!bundle) {
      bundle = setup_library_bundle(lib)
   }
   if (bundle.components.has(fpath)) {
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
         bundle.components.set(fpath, desc)
         lib.log.info(`+ 🧩 component: ${desc.$id} ${desc.type ? `(${desc.type})` : ""}`)
         return true
      }
      else if (bundle.path !== make_normalized_dirname(fpath)) {
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

export async function discover_library_components(lib: Library, path: string, subdir: boolean = false) {

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
            if (await discover_library(lib.workspace, fpath, lib.installed) === Discovered.None) {
               await discover_library_components(lib, fpath, true)
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

export function collect_declarations_field(lib: Library, key: string, value: any) {
   for (const decl of lib.declarations.values()) {
      if (typeof decl[key] === typeof value) {
         if (Array.isArray(value)) value.push(...decl[key])
         else if (typeof value === "object") Object.assign(value, decl[key])
         else value = decl[key]
      }
   }
   return value
}

function make_library_bundle_manifest(lib: Library): BundleManifest {
   return {
      $id: makeNormalizedName(collect_declarations_field(lib, "$id", lib.name), NameStyle.OBJECT),
      type: "bundle",
      name: lib.name,
      icon: collect_declarations_field(lib, "icon", ""),
      title: collect_declarations_field(lib, "title", lib.name),
      tags: collect_declarations_field(lib, "tags", lib.descriptor?.tags),
      keywords: collect_declarations_field(lib, "keywords", lib.descriptor?.keywords),
      description: collect_declarations_field(lib, "description", lib.descriptor?.description),
      selectors: collect_declarations_field(lib, "selectors", undefined),
      data: {
         package: lib.get_id(),
         alias: collect_declarations_field(lib, "alias", lib.name),
         namespaces: collect_declarations_field(lib, "namespaces", []),
         dependencies: collect_declarations_field(lib, "dependencies", []),
         distribueds: collect_declarations_field(lib, "distribueds", {}),
      }
   }
}

enum Discovered {
   None,
   Ignored,
   Registered,
}

async function discover_library(ws: Workspace, location: string, installed: boolean) {
   const lib_path = make_canonical_path(ws.path, location)
   if (is_ignored_dir(ws, lib_path)) return Discovered.Ignored

   const package_path = lib_path + "/package.json"
   const has_package_manifest = file.exists(package_path)
   const has_bundle_manifest = file.exists(findConfigFile(lib_path, "bundle.manifest"))
   if (!has_package_manifest && !has_bundle_manifest) return Discovered.None

   const lib_not_exists = ws.libraries.reduce((r, lib) => r && lib.path !== lib_path, true)
   if (!lib_not_exists) return Discovered.Ignored

   const lib_desc = await readJsonFile<PackageDescriptor>(package_path)
   if (!lib_desc?.name) return Discovered.Ignored

   if (has_bundle_manifest || !installed) {

      const other = ws.get_library(lib_desc.name)
      if (other) {
         if (lib_path.includes(other.path)) {
            ws.log.info(`ignore library build at ${lib_path}`)
            return Discovered.Ignored
         }
         else {
            throw new Error(`library '${lib_desc.name}' declared multiple times\n - ${other.path}\n - ${lib_path}`)
         }
      }

      const lib = new Library(lib_desc.name, lib_path, lib_desc, ws, installed)
      ws.libraries.push(lib)
      ws.log.info(`+ 📚 library: ${installed ? "⏬" : "🐣"} ${lib.get_id()} (${make_relative_path(ws.path, location)})`)

      // Setup node search directory
      const lib_search_path = lib_path + "/node_modules"
      if (Fs.existsSync(lib_search_path)) {
         lib.search_directories.push(lib_search_path)
      }

      // Load library packager
      let packager: LibraryPackager = null
      if (has_bundle_manifest) {
         packager = new BundledLibraryPackager()
      } else {
         const declaration_config = await readSingletonConfigFile<DeclarationDescriptor>(lib_path, "declaration")
         const packager_ref = declaration_config && declaration_config.data?.packager
         if (packager_ref) {
            packager = await LoadLibraryPackager(packager_ref)
         }
         else {
            packager = new DefaultLibraryPackager()
         }
      }

      // Discover library with packager
      await packager.discover_library(lib)

      return Discovered.Registered
   }
   return Discovered.None
}

async function discover_workspace_libraries(ws: Workspace) {

   async function walk(dir: string) {
      if (await discover_library(ws, dir, false) === Discovered.None) {
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
}

function show_constants(ws: Workspace) {
   for (const name in ws.constants) {
      ws.log.info(`+ 🔖 ${name} = ${ws.constants[name]}`)
   }
}

export async function discover_workspace(ws: Workspace): Promise<Workspace> {
   let lockfile = null
   for (let path = ws.path; ;) {
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
      if (!lockfile) {
         lockfile = await read_lockfile(path)
      }
      const next_path = make_normalized_dirname(path)
      if (next_path === path) break
      path = next_path
   }
   if (!lockfile) {
      throw new Error(`Lock file not found for '${ws.name}'`)
   }

   ws.resolved_versions = lockfile.resolved_versions

   await discover_workspace_libraries(ws)
   for (const location of lockfile.installed_locations) {
      await discover_library(ws, location, true)
   }

   for (const bun of ws.bundles) {
      if (bun.source) {
         bun.manifest = create_bundle_manifest(bun.source, bun)
      }
   }

   show_constants(ws)
   return ws
}
