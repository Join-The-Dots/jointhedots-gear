import Fs from "node:fs"
import Path from "node:path"
import Process from "node:process"
import DotEnv from "dotenv"
import { readJsonFile } from "./storage.ts"
import { type BundleID, type BundleManifest, type ComponentManifest, type DistributedConfig } from "./component.ts"
import type { WebAppManifest } from "web-app-manifest"
import { computeNameHashID, makeNormalizedName, NameStyle } from "../utils/normalized-name.ts"
import { make_normalized_path } from "../utils/file.ts"
import { Logger, Log } from "./helpers/logger.ts"
import { discover_workspace } from "./helpers/discover-workspace.ts"
import { create_bundle_manifest } from "./helpers/create-manifests.ts"

export type FileID = string
export type ModuleID = string // Location of esm file: ./{module_path}
export type ExportID = string // Location of esm export: ./{module_path}#{export_name}

export type AssetsEntry = string | {
   from: string
   to: string
}

export type WebviewEntry = {
   title?: string
   entry: ModuleID
   favicon?: string
}

export type ComponentSelection = {
   selectors?: string[]
}

export interface AppDescriptorBase<Manifest = never> {
   type: string
   name: string
   icon?: string
   title?: string
   description?: string

   webviews?: Record<string, WebviewEntry>
   modules?: Record<string, ModuleID>
   assets?: AssetsEntry[]
   components?: ComponentSelection
   manifest?: Manifest
}

export type ChromeAppManifest = chrome.runtime.ManifestV3

export interface ComposableAppDescriptor extends AppDescriptorBase {
   type: "composable"
}

export interface ChromeAppDescriptor extends AppDescriptorBase<ChromeAppManifest> {
   type: "chrome"
}

export interface WebAppDescriptor extends AppDescriptorBase<WebAppManifest> {
   type: "web"
}

export type AppDescriptor = ChromeAppDescriptor | WebAppDescriptor | ComposableAppDescriptor

export type AppEntry = {
   descriptor: AppDescriptor
   library: Library
   baseDir: string
   path: string
}

export type DeclarationDescriptor = BundleManifest["data"] & {
   // List of tags used to define for what build options this desciptor shall be taken into account
   selectors?: string[]

   // Declare assets to integrate into package
   assets?: AssetsEntry[]

   // Declare exports that will be exposed in package
   exports?: {
      [path: string]: PackageExport
   }
}

export type PackageExport = string | {
   import?: string
   require?: string
   default?: string
   types?: string
}

export interface PackageDescriptor {
   // Package definition
   name: string
   version: string
   module?: string
   description?: string

   // Executable definition
   bin?: {
      [commandName: string]: string
   }
   scripts?: {
      [scriptName: string]: string
   }

   // Library definition
   main?: string
   types?: string
   exports?: {
      [path: string]: PackageExport
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

   [metadata: string]: any
}

export class WorkspaceItem {
   readonly log: Log
   constructor(
      readonly workspace: Workspace,
      loggerId: string,
   ) {
      this.log = workspace.logger.get(loggerId)
   }
}

// Une librairie represente des plans de construction avec un ensemble de code source 
export class Library extends WorkspaceItem {
   bundle: Bundle = null
   declarations = new Map<FileID, DeclarationDescriptor>()
   applications = new Map<FileID, AppDescriptor>()
   externals: Record<string, string> = {}
   search_directories: FileID[] = null
   constructor(
      readonly name: string,
      readonly path: FileID,
      readonly descriptor: PackageDescriptor,
      readonly workspace: Workspace,
      readonly installed: boolean,
   ) {
      super(workspace, `lib:${name}`)
      this.search_directories = workspace.search_directories.slice()
      Object.assign(this.externals, descriptor.peerDependencies, descriptor.dependencies)
   }
   get_id(): string {
      const { name, version } = this.descriptor
      return `${name}-${version}`
   }
   make_file_id(prefix: string, id: string): string {
      const devmode = true
      const base = devmode ? makeNormalizedName(id, NameStyle.OBJECT) : computeNameHashID(id)
      return base ? prefix + "." + base : prefix
   }
   resolve_entry_path(entryId: string, baseDir: string): string {
      const fpath = make_normalized_path(Path.resolve(baseDir, entryId))
      if (entryId.startsWith(".")) return fpath

      const parts = entryId.split("/")
      for (const search_path of this.search_directories) {
         if (Fs.existsSync(search_path + "/" + parts[0])) {
            return make_normalized_path(search_path + "/" + entryId)
         }
      }

      if (Fs.existsSync(fpath)) return fpath
      return null
   }

}

// Un bundle represente un ensemble construit exposant des composants et point d'entrée
export class Bundle extends WorkspaceItem {
   alias: string
   components = new Map<FileID, ComponentManifest>()
   distribueds: { [packageName: string]: string | DistributedConfig } = {}
   configured: boolean = false
   constructor(
      public manifest: BundleManifest,
      readonly path: string,
      readonly workspace: Workspace,
      readonly source: Library = null,
   ) {
      super(workspace, `bundle:${manifest.$id}`)
      this.configured = (source === null)
   }
   get id(): BundleID {
      return this.manifest.$id
   }
   get dependencies() {
      return this.manifest.data.dependencies
   }
   get exports() {
      return this.manifest.data.exports
   }
   resolve_export(ref: string): string {
      if (!this.manifest) {
         this.manifest = create_bundle_manifest(this.source, this)
         this.configured = true
      }
      return this.exports?.[ref]
   }
}

export type Constants = { [key: string]: string | number }

export type OpenWorkspaceOptions = {
   workspace_path: string
   devmode: boolean
   ignored_directory?: string
}

// Workspace est l'objet a travers lequel on connecte tous les elements
export class Workspace {
   bundles: Bundle[] = []
   libraries: Library[] = []
   constants: Constants = {}
   resolved_versions: Record<string, string> = {}
   search_directories: string[] = []
   ignored_directories = new Set<string>()
   readonly logger = new Logger()
   readonly log: Log
   constructor(
      readonly name: string,
      readonly version: string,
      readonly path: string,
      readonly devmode: boolean,
   ) {
      this.log = this.logger.get(`workspace:${name}`)
   }
   get_bundle(id: string): Bundle {
      for (const bundle of this.bundles) {
         if (bundle.id === id) return bundle
      }
      for (const bundle of this.bundles) {
         if (bundle.alias === id) return bundle
      }
      return null
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

export async function open_workspace(options: OpenWorkspaceOptions): Promise<Workspace> {
   const workspace_path = Path.resolve(options.workspace_path)
   const { devmode } = options
   const parsed_env = load_env_from_cwd_parents()
   const package_json = await readJsonFile(workspace_path + "/package.json")
   if (!package_json) throw new Error(`No 'package.json' found at workspace path: ${workspace_path}`)

   const ws = new Workspace(package_json.name, package_json.version, workspace_path, devmode)
   if (options.ignored_directory) {
      ws.ignored_directories.add(Path.resolve(options.ignored_directory).replace(/\\/g, "/"))
   }
   ws.constants = patch_constants_from_env(package_json.constants || {}, devmode, parsed_env)

   await discover_workspace(ws)

   return ws
}

function patch_constants_from_env(constants: Constants, devmode: boolean, parsedEnv: Record<string, string>): Constants {
   for (const key in constants) {
      if (devmode) {
         const dvalue = parsedEnv["DCONST_" + key]
         if (dvalue !== undefined) {
            constants[key] = dvalue
            continue
         }
      }
      {
         const value = parsedEnv["CONST_" + key]
         if (value !== undefined) {
            constants[key] = value
            continue
         }
      }
   }
   return constants
}

function load_env_from_cwd_parents(): Record<string, string> {
   let currentPath = Process.cwd()

   while (true) {
      const envPath = Path.join(currentPath, ".env")
      if (Fs.existsSync(envPath)) {
         const env = DotEnv.config({ path: envPath })
         return env.parsed || {}
      }

      const parentPath = Path.dirname(currentPath)
      if (parentPath === currentPath) break
      currentPath = parentPath
   }

   return {}
}

export function matchComponentSelection(components: ComponentSelection, selectors: string[]) {
   if (components?.selectors) {
      if (!selectors) selectors = ["default"]
      for (const selector of selectors) {
         if (components?.selectors.includes(selector)) return true
      }
      return false
   }
   else {
      return true
   }
}
