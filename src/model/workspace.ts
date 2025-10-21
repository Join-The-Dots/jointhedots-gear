import Fs from "node:fs"
import Fsp from "node:fs/promises"
import Path from "node:path"
import { readJsonFile } from "./storage.js"
import { checkComponentManifest, ComponentCatalogsDescriptor, ComponentManifest } from "./component.js"
import { MapLike } from "../utils/helpers.js"
import { WebAppManifest } from "web-app-manifest"
import DotEnv from "dotenv"

const debug_trace = false

export interface IStorageStream {
   begin(cleanup: boolean)
   commitContent(contentData: Uint8Array | string, contentType?: string): string
   commitFile(key: string, contentData: Uint8Array | string, contentType?: string)
   end()
}

export type ModuleID = string // Location of esm file: ./{module_path}
export type ExportID = ModuleID // Location of esm export: ./{module_path}#{export_name}

export type FileID = string

export type AssetsEntry = string | {
   from: string
   to: string
}

export type WebviewEntry = {
   title?: string
   entry: ModuleID
   favicon?: string
}

export interface AppDescriptorBase<Manifest = never> {
   type: string
   name: string
   icon?: string
   title?: string
   description?: string

   webviews?: MapLike<WebviewEntry>
   modules?: MapLike<ModuleID>
   assets?: AssetsEntry[]
   components?: {
      selectors?: string[]
   }
   manifest?: Manifest
}

export type ChromeAppManifest = chrome.runtime.ManifestV3

export interface ChromeAppDescriptor extends AppDescriptorBase<ChromeAppManifest> {
   type: "chrome"
}

export interface WebAppDescriptor extends AppDescriptorBase<WebAppManifest> {
   type: "web"
}

export type AppDescriptor = ChromeAppDescriptor | WebAppDescriptor

export type AppEntry = {
   descriptor: AppDescriptor
   library: Library
   baseDir: string
   path: string
}

export type DeclarationDescriptor = {
   selectors?: string[]
   assets?: AssetsEntry[]
}

export interface PackageDescriptor {
   name: string
   version: string
   module?: string
   main?: string
   types?: string
   componentsContainer?: boolean
   exports?: {
      [path: string]: string | {
         import?: string
         require?: string
         default?: string
         types?: string
      }
   }
   dependencies?: {
      [packageName: string]: string
   }
   devDependencies?: {
      [packageName: string]: string
   }
   peerDependencies?: {
      [packageName: string]: string
   }
   optionalDependencies?: {
      [packageName: string]: string
   }
   bundledDependencies?: string[]
   bin?: {
      [commandName: string]: string
   }
   scripts?: {
      [scriptName: string]: string
   }
   description?: string
   [metadata: string]: any
}

export class Library {
   declarations = new Map<FileID, DeclarationDescriptor>()
   applications = new Map<FileID, AppDescriptor>()
   components = new Map<FileID, ComponentManifest>()
   externals: MapLike<string> = {}
   search_directories: FileID[] = null
   constructor(
      readonly name: string,
      readonly path: FileID,
      readonly descriptor: PackageDescriptor,
      readonly workspace: Workspace,
   ) {
      this.search_directories = workspace.search_directories.slice()
      Object.assign(this.externals, descriptor.peerDependencies, descriptor.dependencies)
   }
}

export type Constants = { [key: string]: string | number }

export class Workspace {
   libraries: Library[] = []
   constants: Constants = {}
   search_directories: string[] = []
   constructor(
      readonly name: string,
      readonly version: string,
      readonly path: string,
      readonly devmode: boolean,
   ) {
   }
   get_library(name: string): Library {
      for (const lib of this.libraries) {
         if (lib.name === name) return lib
      }
      return null
   }
   get_application(name: string): AppEntry {
      for (const lib of this.libraries) {
         for (const [path, desc] of lib.applications) {
            if (desc.name === name) {
               return {
                  descriptor: desc,
                  library: lib,
                  baseDir: Path.dirname(path),
                  path,
               }
            }
         }
      }
      return null
   }
}


const exclude_dirs = ["node_modules"]

async function discover_component(lib: Library, fpath: string) {
   try {
      const data = await Fsp.readFile(fpath)
      const desc = JSON.parse(data.toString()) as ComponentManifest
      const err = checkComponentManifest(desc, fpath)
      if (err) throw err
      lib.components.set(fpath, desc)
      console.log(`+ component '${lib.name}': ${desc.$id}`)
   }
   catch (e) {
      console.log(`! invalid component at ${fpath}: ${e?.message}`)
   }
}

async function discover_declaration(lib: Library, fpath: string) {
   try {
      const data = await Fsp.readFile(fpath)
      const desc = JSON.parse(data.toString()) as DeclarationDescriptor
      lib.declarations.set(fpath, desc)
      console.log(`+ declaration '${lib.name}': ${Path.relative(lib.path, fpath)}`)
   }
   catch (e) {
      console.log(`! invalid declaration at ${fpath}: ${e?.message}`)
   }
}

async function discover_application(lib: Library, fpath: string) {
   try {
      const data = await Fsp.readFile(fpath)
      const desc = JSON.parse(data.toString()) as AppDescriptor
      lib.applications.set(fpath, desc)
      console.log(`+ application '${lib.name}': ${Path.relative(lib.path, fpath)}`)
   }
   catch (e) {
      console.log(`! invalid declaration at ${fpath}: ${e?.message}`)
   }
}

async function discover_library_components(lib: Library, path: string) {
   const comp_dir_name = "component.json"
   const comp_file_ext = ".component.json"

   // Collect declaration files from library directory
   for (const fname of await Fsp.readdir(path)) {
      const fpath = `${path}/${fname}`
      const fstat = await Fsp.stat(fpath)
      if (fstat.isDirectory()) {
         if (!exclude_dirs.includes(fname)) {
            await discover_library_components(lib, fpath)
         }
      }
      else if (fstat.isFile()) {
         const is_component = fname === comp_dir_name || fname.endsWith(comp_file_ext)
         if (is_component) {
            await discover_component(lib, fpath)
         }
         else if (fname === "application.json") {
            await discover_application(lib, fpath)
         }
         else if (fname === "declaration.json") {
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

function resolve_canonical_path(targetPath: string): string {
   targetPath = Path.resolve(targetPath)
   try {
      const stats = Fs.lstatSync(targetPath)
      if (stats.isSymbolicLink()) {
         return Path.resolve(Fs.readlinkSync(targetPath))
      }
   }
   catch (err) { }
   return targetPath
}

async function discover_library(ws: Workspace, location: string) {
   const lib_path = resolve_canonical_path(location)
   const lib_not_exists = ws.libraries.reduce((r, lib) => r && lib.path !== lib_path, true)
   if (lib_not_exists) {
      const lib_desc = await readJsonFile(Path.join(lib_path, "/package.json"))
      if (lib_desc?.componentsContainer) {
         const other = ws.get_library(lib_desc.name)
         if (other) {
            throw new Error(`library '${lib_desc.name}' declared multiple times\n - ${other.path}\n - ${lib_path}`)
         }

         const lib = new Library(lib_desc.name, lib_path, lib_desc, ws)
         ws.libraries.push(lib)

         const lib_search_path = lib_path + "/node_modules"
         if (Fs.existsSync(lib_search_path)) {
            lib.search_directories.push(lib_search_path)
         }

         await discover_library_components(lib, Path.resolve(lib_path))
      }

   }
}

function patch_constants_from_env(constants: Constants, devmode: boolean): Constants {
   const env = DotEnv.config()
   for (const key in constants) {
      if (devmode) {
         const dvalue = env.parsed["DCONST_" + key]
         if (dvalue !== undefined) {
            constants[key] = dvalue
            continue
         }
      }
      {
         const value = env.parsed["CONST_" + key]
         if (value !== undefined) {
            constants[key] = value
            continue
         }
      }
   }
   return constants
}

export async function open_workspace(workspace_path: string, devmode: boolean): Promise<Workspace> {
   const package_json = await readJsonFile(workspace_path + "/package.json")
   const ws = new Workspace(package_json.name, package_json.version, workspace_path, devmode)
   ws.constants = patch_constants_from_env(package_json.constants || {}, devmode)

   let package_lock: any = null
   for (let path = Path.resolve(ws.path); ;) {
      const search_path = path + "/node_modules"
      if (Fs.existsSync(search_path) && Fs.existsSync(path + "/package.json")) {
         ws.search_directories.push(search_path)
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

   for (const location in package_lock.packages) {
      await discover_library(ws, location)
   }

   return ws
}

export function matchComponentSelection(options: AppDescriptor["components"], selectors: string[]) {
   if (options?.selectors) {
      if (!selectors) selectors = ["default"]
      for (const selector of selectors) {
         if (options?.selectors.includes(selector)) return true
      }
      return false
   }
   else {
      return true
   }
}
