import Fs from "node:fs"
import Fsp from "node:fs/promises"
import { readJsonFile } from "../storage.ts"
import { checkComponentManifest, type BundleManifest, type ComponentManifest } from "../component.ts"
import { makeNormalizedName, NameStyle } from "../../utils/normalized-name.ts"
import { create_bundle_manifest } from "./create-manifests.ts"
import { Bundle, Library, Workspace, type AppDescriptor, type DeclarationDescriptor, type PackageDescriptor } from "../workspace.ts"
import { file, make_canonical_path, make_normalized_dirname, make_normalized_path, make_relative_path } from "../../utils/file.ts"
import { findConfigFile, is_config_filename, readConfigFile, readSingletonConfigFile } from "./config-loader.ts"

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

function setup_library_bundle(lib: Library, bundle_desc?: any) {
   const ws = lib.workspace
   const manif = make_library_bundle_manifest(lib, bundle_desc)
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

async function discover_component(lib: Library, fpath: string) {
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

function make_library_bundle_manifest(lib: Library, file_desc?: Partial<BundleManifest>): BundleManifest {
   let $id = file_desc?.$id
   if ($id) {
      $id = makeNormalizedName($id, NameStyle.OBJECT)
      if ($id !== file_desc.$id) {
         lib.log.warn(`Bundle '${file_desc.$id}' is normalized into '${$id}'`)
      }
   }
   else {
      $id = makeNormalizedName(lib.name, NameStyle.OBJECT)
      lib.log.info(`Bundle '${$id}' named from library '${lib.name}'`)
   }

   const data: BundleManifest["data"] = {
      package: lib.get_id(),
      alias: collect_declarations_field(lib, "alias", lib.name),
      namespaces: collect_declarations_field(lib, "namespaces", []),
      dependencies: collect_declarations_field(lib, "dependencies", []),
      distribueds: collect_declarations_field(lib, "distribueds", {}),
   }

   if (file_desc?.data) {
      data.alias = file_desc.data.alias ?? data.alias
      if (file_desc.data.distribueds) {
         Object.assign(data.distribueds, file_desc.data.distribueds)
      }
      if (Array.isArray(file_desc.data.namespaces)) {
         data.namespaces.push(...file_desc.data.namespaces)
      }
      if (Array.isArray(file_desc.data.dependencies)) {
         data.dependencies.push(...file_desc.data.dependencies)
      }
   }

   const manifest: BundleManifest = {
      $id,
      type: file_desc?.type,
      name: file_desc?.name ?? lib.name,
      icon: file_desc?.icon,
      title: file_desc?.title,
      tags: file_desc?.tags,
      keywords: file_desc?.keywords,
      description: file_desc?.description ?? lib.descriptor?.description,
      selectors: file_desc?.selectors,
      data,
   }

   return manifest
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
   const manifest_path = findConfigFile(lib_path, "bundle.manifest")
   if (!file.exists(package_path) && !file.exists(manifest_path)) return Discovered.None

   const lib_not_exists = ws.libraries.reduce((r, lib) => r && lib.path !== lib_path, true)
   if (!lib_not_exists) return Discovered.Ignored

   const lib_desc = await readJsonFile<PackageDescriptor>(package_path)
   if (!lib_desc?.name) return Discovered.Ignored

   const manifest_desc = await readConfigFile<BundleManifest>(manifest_path)
   if (manifest_desc || !installed) {

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

      // Setup library infos from bundle manifest
      setup_library_bundle(lib, manifest_desc)

      // Analyze library deployment manifest (supports json/yaml/yml/toml, singleton)
      if (manifest_desc?.data?.components) {
         for (const pub of manifest_desc.data.components) {
            const fpath = lib_path + "/" + (pub.ref ?? pub.id)
            await discover_component(lib, fpath)
         }
      }

      // Setup node search directory
      const lib_search_path = lib_path + "/node_modules"
      if (Fs.existsSync(lib_search_path)) {
         lib.search_directories.push(lib_search_path)
      }

      // Collect library declaration
      await discover_library_components(lib, lib_path)

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
   let package_lock: any = null
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
      const package_lock_path = path + "/package-lock.json"
      if (!package_lock && Fs.existsSync(package_lock_path)) {
         package_lock = await readJsonFile(package_lock_path)
      }
      const next_path = make_normalized_dirname(path)
      if (next_path === path) break
      path = next_path
   }
   if (!package_lock) {
      throw new Error(`Package lock not found for '${ws.name}'`)
   }

   for (const location in package_lock.packages) {
      let pkg = package_lock.packages[location]
      if (location.startsWith("node_modules/")) {
         if (pkg.link) {
            pkg = package_lock.packages[pkg.resolved]
         }
         const name = location.replace(/^.*node_modules\//, "")
         ws.resolved_versions[name] = pkg.version
      }
   }

   await discover_workspace_libraries(ws)
   for (const location in package_lock.packages) {
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
