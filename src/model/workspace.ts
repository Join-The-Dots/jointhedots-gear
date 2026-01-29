import Fs from "node:fs"
import Fsp from "node:fs/promises"
import Path from "node:path"
import Process from "node:process"
import { readJsonFile } from "./storage.ts"
import { type BundleID, type BundleManifest, type ComponentManifest } from "./component.ts"
import { topologicalSort } from "../utils/graph-ordering.ts"
import type { WebAppManifest } from "web-app-manifest"
import DotEnv from "dotenv"
import { computeNameHashID, makeNormalizedName, NameStyle } from "../utils/normalized-name.ts"
import { make_relative_path } from "../utils/file.ts"
import { Logger, Log } from "./helpers/logger.ts"
import { discover_workspace } from "./helpers/discover-workspace.ts"
import { create_manifests } from "./helpers/create-manifests.ts"

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

export type DeclarationDescriptor = {
   selectors?: string[]
   assets?: AssetsEntry[]
}

export type PackageExport = string | {
   import?: string
   require?: string
   default?: string
   types?: string
}

export type PackageBundleDescriptor = {
   // Bundle id (unique in system, is also a private components namespace)
   id: string
   // Bundle alias (name that can help to connect it to library name)
   alias?: string
   // Bundle library/package origin
   package?: string
   // Bundle namespace (allow to enrich an public components namespace)
   namespaces?: string[]
   // Bundle dependencies
   dependencies?: string[]
   // Package distribued by this bundle (force dependents bundle to use these package distribuable instead of bundling them)
   // > Used for shared library, ex: react, react-dom / or huge one, ex: @material/mui, ...
   distribueds?: string[] | {
      [packageName: string]: string | DistributedConfig
   }
}

/** Configuration for a distributed package */
export interface DistributedConfig {
   /** Version specifier (e.g., "*", "^18.0.0") */
   version?: string
   /** Interop type: 'esm' | 'cjs-default' | 'cjs-named' */
   interop?: 'esm' | 'cjs-default' | 'cjs-named'
   /** List of named exports to re-export (required for cjs-named interop) */
   exports?: string[]
}

export interface PackageDescriptor {
   // Package definition
   name: string
   version: string
   module?: string
   description?: string
   
   // Specific to this tool
   componentsContainer?: boolean

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
   components = new Map<FileID, ComponentManifest>()
   externals: Record<string, string> = {}
   search_directories: FileID[] = null
   constructor(
      readonly name: string,
      readonly path: FileID,
      readonly descriptor: PackageDescriptor,
      readonly workspace: Workspace,
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
      const fpath = make_relative_path(Process.cwd(), Path.resolve(baseDir, entryId))
      if (entryId.startsWith(".")) return fpath

      const parts = entryId.split("/")
      for (const search_path of this.search_directories) {
         if (Fs.existsSync(search_path + "/" + parts[0])) {
            return make_relative_path(Process.cwd(), search_path + "/" + entryId)
         }
      }

      if (Fs.existsSync(fpath)) return fpath
      return null
   }

}

// Un bundle represente un ensemble construit exposant des composants et point d'entrée
export class Bundle extends WorkspaceItem {
   id: BundleID
   alias: string
   manifest: BundleManifest // The bundle is a component with subcomponents
   components = new Map<FileID, ComponentManifest>()
   distribueds: { [packageName: string]: string | DistributedConfig } = {}
   namespaces: string[] = []
   dependencies: BundleID[] = []
   source?: Library = null
   constructor(
      readonly descriptor: PackageBundleDescriptor,
      readonly workspace: Workspace,
   ) {
      super(workspace, `bundle:${descriptor.id}`)
      Object.assign(this, descriptor)
   }
   resolve_export(ref: string): string {
      if (!this.manifest) {
         const manifs = create_manifests(this.source, this)
         this.manifest = manifs.bundle
      }
      return this.manifest.exports?.[ref]
   }
}

export type Constants = { [key: string]: string | number }

// Workspace est l'objet a travers lequel on connecte tous les elements
export class Workspace {
   bundles: Bundle[] = []
   libraries: Library[] = []
   constants: Constants = {}
   search_directories: string[] = []
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

export async function open_workspace(workspace_path: string, devmode: boolean): Promise<Workspace> {
   workspace_path = Path.resolve(workspace_path)
   const package_json = await readJsonFile(workspace_path + "/package.json")
   if (!package_json) throw new Error(`No 'package.json' found at workspace path: ${workspace_path}`)

   const ws = new Workspace(package_json.name, package_json.version, workspace_path, devmode)
   ws.constants = patch_constants_from_env(package_json.constants || {}, devmode)

   await discover_workspace(ws)

   return ws
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
