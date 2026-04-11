import Fs from "node:fs"
import Fsp from "node:fs/promises"
import YAML from "yaml"
import { readJsonFile } from "../storage.ts"

export type PackageDepsInfo = {
   resolved_versions: Record<string, string>
   resolved_paths: Record<string, string>
}

export async function read_lockfile(dir: string): Promise<PackageDepsInfo | null> {
   const npm_path = dir + "/package-lock.json"
   if (Fs.existsSync(npm_path)) {
      return parse_npm_lockfile(await readJsonFile(npm_path))
   }
   const pnpm_path = dir + "/pnpm-lock.yaml"
   if (Fs.existsSync(pnpm_path)) {
      return parse_pnpm_lockfile(YAML.parse(await Fsp.readFile(pnpm_path, "utf-8")))
   }
   const yarn_path = dir + "/yarn.lock"
   if (Fs.existsSync(yarn_path)) {
      return parse_yarn_lockfile(await Fsp.readFile(yarn_path, "utf-8"))
   }
   return null
}

function parse_npm_lockfile(lock: any): PackageDepsInfo {
   const resolved_versions: Record<string, string> = {}
   const resolved_paths: Record<string, string> = {}
   for (const location in lock.packages) {
      if (!location) continue
      if (location.startsWith("node_modules/")) {
         let pkg = lock.packages[location]
         if (pkg.link) {
            pkg = lock.packages[pkg.resolved]
         }
         const name = location.replace(/^.*node_modules\//, "")
         resolved_paths[name] = location
         if (pkg?.version) {
            resolved_versions[name] = pkg.version
         }
      }
   }
   return { resolved_versions, resolved_paths }
}

function parse_pnpm_lockfile(lock: any): PackageDepsInfo {
   const resolved_versions: Record<string, string> = {}
   const resolved_paths: Record<string, string> = {}
   if (lock.packages) {
      for (const key in lock.packages) {
         const clean = key.startsWith("/") ? key.slice(1) : key
         const atIdx = clean.lastIndexOf("@")
         if (atIdx > 0) {
            const name = clean.slice(0, atIdx)
            const version = clean.slice(atIdx + 1).split("(")[0]
            if (name && version) {
               resolved_versions[name] = version
               resolved_paths[name] = "node_modules/" + name
            }
         }
      }
   }
   if (lock.importers) {
      for (const key in lock.importers) {
         if (key !== ".") resolved_paths[key] = key
      }
   }
   return { resolved_versions, resolved_paths }
}

function parse_yarn_lockfile(text: string): PackageDepsInfo {
   const resolved_versions: Record<string, string> = {}
   const resolved_paths: Record<string, string> = {}
   if (text.includes("__metadata:")) {
      const lock = YAML.parse(text)
      for (const key in lock) {
         if (key === "__metadata") continue
         if (lock[key]?.version) {
            const name = extract_package_name(key.split(",")[0].trim())
            if (name) {
               resolved_versions[name] = lock[key].version
               resolved_paths[name] = "node_modules/" + name
            }
         }
      }
   }
   else {
      parse_yarn_classic(text, resolved_versions, resolved_paths)
   }
   return { resolved_versions, resolved_paths }
}

function extract_package_name(entry: string): string | null {
   entry = entry.replace(/^"|"$/g, "")
   // @scope/name@version or name@version
   const at = entry.startsWith("@") ? entry.indexOf("@", 1) : entry.indexOf("@")
   return at > 0 ? entry.slice(0, at) : null
}

function parse_yarn_classic(text: string, resolved_versions: Record<string, string>, resolved_paths: Record<string, string>) {
   let current_name: string | null = null
   for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!line.startsWith(" ") && !line.startsWith("#") && trimmed.endsWith(":")) {
         current_name = extract_package_name(trimmed.slice(0, -1).split(",")[0].trim())
      }
      else if (current_name && trimmed.startsWith("version ")) {
         const version = trimmed.slice(8).replace(/^"|"$/g, "")
         resolved_versions[current_name] = version
         resolved_paths[current_name] = "node_modules/" + current_name
         current_name = null
      }
   }
}
