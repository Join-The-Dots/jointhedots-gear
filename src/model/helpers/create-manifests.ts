import Path from "node:path"
import { makeComponentPublication, type BundleManifest, type ComponentPublication } from "../component.ts"
import type { Bundle, Library, PackageDescriptor } from "../workspace.ts"

export type ExportEntry = {
   id: string
   exported?: string
   basename: string // raw exported name without decoration
   filename: string // exported name with extension
   source: string // path to source file
}
export type ExportEntries = Record<string, ExportEntry>

function add_export_entry(exports: ExportEntries, lib: Library, key: string, value: string | { import?: string, require?: string, default?: string }, baseDir: string) {
   const basename = key.startsWith("./") ? key.slice(2) : key
   const filename = lib.make_file_id("export", basename)
   const source_ref = typeof value === "string" ? value : value?.import ?? value?.default ?? value?.require
   const entry = source_ref ? lib.resolve_entry_path(source_ref, baseDir) : null
   const id = `${lib.name}${basename === "." ? "" : "/" + basename}`
   exports[id] = {
      id,
      exported: key,
      basename: filename,
      filename: `${filename}.js`,
      source: entry,
   }
}

function create_export_map(lib: Library, bun: Bundle): ExportEntries {
   const exports: ExportEntries = {}

   if (bun) {
      for (const id in bun.distribueds) {
         const basename = lib.make_file_id("redist", id)
         const entry = lib.resolve_entry_path(id, lib.path)
         exports[id] = {
            id,
            basename: basename,
            filename: `${basename}.js`,
            source: entry,
         }
      }
   }
   for (const key in (lib.descriptor.exports || {})) {
      const exp = lib.descriptor.exports[key]
      add_export_entry(exports, lib, key, exp, lib.path)
   }

   for (const [decl_path, declaration] of lib.declarations) {
      if (!declaration.exports) continue
      const decl_base_dir = Path.dirname(decl_path)
      for (const key in declaration.exports) {
         const exp = declaration.exports[key]
         add_export_entry(exports, lib, key, exp, decl_base_dir)
      }
   }
   return exports
}

export function create_manifests(lib: Library, bun: Bundle, build_version?: string): {
   package: PackageDescriptor,
   bundle: BundleManifest,
   entries: ExportEntries
} {
   const entries = create_export_map(lib, bun)

   let bundle_manif: BundleManifest = null
   if (bun) {
      bundle_manif = bun.manifest

      const components: ComponentPublication[] = []
      for (const comp of bun.components.values()) {
         components.push(makeComponentPublication(comp))
      }

      bundle_manif.data = {
         baseline: bun.id + "-v0",
         components: components,
         exports: {},
      }
      for (const id in entries) {
         const exp = entries[id]
         bundle_manif.data.exports[id] = exp.filename
      }
   }

   // Add bundle package.json 
   const pkg_manif = {
      ...lib.descriptor,
      name: lib.name,
      version: build_version || lib.descriptor.version,
      type: "module",
      exports: undefined,
      scripts: undefined,
      private: undefined,
      devDependencies: undefined,
      optionalDependencies: undefined,
   } as PackageDescriptor

   for (const id in entries) {
      const exp = entries[id]
      if (exp.exported) {
         if (!pkg_manif.exports) pkg_manif.exports = {}
         pkg_manif.exports[exp.exported] = { import: `./${exp.filename}`, types: "./types.d.ts" }
      }
   }

   return { package: pkg_manif, bundle: bundle_manif, entries }
}
