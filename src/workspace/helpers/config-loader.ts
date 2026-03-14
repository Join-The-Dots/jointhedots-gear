import YAML from 'yaml'
import TOML from 'toml'
import Path from 'node:path'
import Fsp from "node:fs/promises"
import Fs from 'node:fs'

/** Supported config file extensions in precedence order */
export const config_extensions = [".json", ".yaml", ".yml", ".toml"] as const
export type ConfigExtension = typeof config_extensions[number]

/**
 * Check whether a filename matches a config base name (e.g. "component", "application")
 * in any supported format (json, yaml, yml, toml).
 * Matches exact names like `component.json` and dotted prefixes like `foo.component.yaml`.
 */
export function is_config_filename(fname: string, config_base: string): boolean {
   for (const ext of config_extensions) {
      const suffix = config_base + ext
      if (fname === suffix || (fname.endsWith(suffix) && fname.endsWith("." + suffix))) {
         return true
      }
   }
   return false
}

/**
 * Parse a config string based on its file extension.
 */
export function parseConfigContent(text: string, ext: ConfigExtension): any {
   switch (ext) {
      case ".json":
         return JSON.parse(text)
      case ".yaml":
      case ".yml":
         return YAML.parse(text)
      case ".toml":
         return TOML.parse(text)
      default:
         throw new Error(`Unsupported config extension: ${ext}`)
   }
}

/**
 * Read and parse a config file. The format is determined by its extension.
 * Returns `undefined` if the file doesn't exist or can't be parsed.
 */
export async function readConfigFile<T = any>(path: string): Promise<T | undefined> {
   try {
      const ext = Path.extname(path).toLowerCase() as ConfigExtension
      const text = (await Fsp.readFile(path)).toString()
      return parseConfigContent(text, ext) as T
   } catch (e) {
      return undefined
   }
}

/**
 * Read and parse a config file synchronously.
 * Returns `undefined` if the file doesn't exist or can't be parsed.
 */
export function readConfigFileSync<T = any>(path: string): T | undefined {
   try {
      const ext = Path.extname(path).toLowerCase() as ConfigExtension
      const text = Fs.readFileSync(path).toString()
      return parseConfigContent(text, ext) as T
   } catch (e) {
      return undefined
   }
}

/**
 * Find config files matching a base name (e.g. "bundle.component") in a directory.
 * Returns all matching paths across supported extensions.
 */
export function findConfigFile(dir: string, baseName: string, fnames?: string[]): string {
   const results: string[] = []
   for (const ext of config_extensions) {
      const fname = baseName + ext
      if (fnames) {
         if (fnames.includes(fname)) {
            results.push(`${dir}/${fname}`)
         }
      }
      else if (Fs.existsSync(`${dir}/${fname}`)) {
         results.push(`${dir}/${fname}`)
      }
   }
   if (results.length === 0) return undefined
   if (results.length > 1) {
      throw new Error(`Multiple config files found for '${baseName}': ${results.join(", ")}. Only one format is allowed.`)
   }
   return results[0]
}

/**
 * Read a singleton config file (exactly one format must exist).
 * Throws if multiple formats are found for the same base name.
 * Returns `undefined` if no matching file exists.
 */
export async function readSingletonConfigFile<T = any>(dir: string, baseName: string, fnames?: string[]): Promise<{ data: T, path: string } | undefined> {
   const path = findConfigFile(dir, baseName, fnames)
   const data = await readConfigFile<T>(path)
   return data !== undefined ? { data, path } : undefined
}
