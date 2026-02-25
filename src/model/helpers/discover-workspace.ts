import Fs from "node:fs"
import Fsp from "node:fs/promises"
import { readJsonFile } from "../storage.ts"
import { checkComponentManifest, type BundleManifest, type ComponentManifest } from "../component.ts"
import { makeNormalizedName, NameStyle } from "../../utils/normalized-name.ts"
import { create_manifests } from "./create-manifests.ts"
import { Bundle, Library, Workspace, type AppDescriptor, type DeclarationDescriptor, type PackageDescriptor } from "../workspace.ts"
import { make_canonical_path, make_normalized_dirname, make_normalized_path, make_relative_path } from "../../utils/file.ts"
import { is_config_filename, readConfigFile, readSingletonConfigFile } from "./config-loader.ts"

const exclude_dirs = ["node_modules"]

function setup_library_bundle(lib: Library, bundle_desc?: any) {
   const manif = make_library_bundle_manifest(lib, bundle_desc)
   const ws = lib.workspace
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
            await discover_library_components(lib, fpath, true)
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

   // Analyze library deployment manifest (supports json/yaml/yml/toml, singleton)
   const manifest_result = await readSingletonConfigFile<BundleManifest>(path, "bundle.manifest", fnames)
   if (manifest_result) {
      const manifest = manifest_result.data
      for (const pub of manifest.data.components) {
         const fpath = path + "/" + (pub.ref ?? pub.id)
         await discover_component(lib, fpath)
      }
   }
}

function make_library_bundle_manifest(lib: Library, file_desc?: Partial<BundleManifest>): BundleManifest {
   let $id = file_desc?.$id
   if ($id) {
      $id  = makeNormalizedName($id, NameStyle.OBJECT)
      if ($id  !== file_desc.$id) {
         lib.log.warn(`Bundle '${file_desc.$id}' is normalized into '${$id}'`)
      }
   }
   else {
      $id = makeNormalizedName(lib.name, NameStyle.OBJECT)
      lib.log.info(`Bundle '${$id}' named from library '${lib.name}'`)
   }

   const data: BundleManifest["data"] = {
      alias: lib.name,
      package: lib.get_id(),
      namespaces: [],
      dependencies: [],
      redistribueds: {},
   }

   if (file_desc?.data) {
      data.alias = file_desc.data.alias ?? data.alias
      if (file_desc.data.redistribueds) {
         const distribueds = file_desc.data.redistribueds
         if (Array.isArray(distribueds)) distribueds.forEach(dist => data.redistribueds[dist] = "*")
         else Object.assign(data.redistribueds, distribueds)
      }
      if (file_desc.data.namespaces) {
         data.namespaces = file_desc.data.namespaces
      }
      if (file_desc.data.dependencies) {
         data.dependencies = file_desc.data.dependencies
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

async function discover_library(ws: Workspace, location: string) {
   const lib_path = make_canonical_path(ws.path, location)
   const lib_not_exists = ws.libraries.reduce((r, lib) => r && lib.path !== lib_path, true)
   if (lib_not_exists) {
      const lib_desc = await readJsonFile(lib_path + "/package.json") as PackageDescriptor
      const bundle_result = await readSingletonConfigFile(lib_path, "bundle.component")
      const bundle_desc = bundle_result?.data
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
            setup_library_bundle(lib, bundle_desc)
         }

         const lib_search_path = lib_path + "/node_modules"
         if (Fs.existsSync(lib_search_path)) {
            lib.search_directories.push(lib_search_path)
         }

         await discover_library_components(lib, lib_path)
      }

   }
}

async function discover_workspace_libraries(ws: Workspace) {

   async function walk(dir: string) {
      await discover_library(ws, dir)
      for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
         if (entry.name === "node_modules") continue
         const fullPath = dir + "/" + entry.name
         if (entry.isDirectory()) {
            await walk(fullPath)
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

   show_constants(ws)
   return ws
}
