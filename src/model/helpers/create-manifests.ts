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
   for (const key in lib.descriptor.exports) {
      const exp = lib.descriptor.exports[key]
      const basename = key.startsWith("./") ? key.slice(2) : key
      const filename = lib.make_file_id("export", basename)
      const entry = lib.resolve_entry_path(typeof exp === "string" ? exp : exp?.import, lib.path)
      const id = `${lib.name}${basename === "." ? "" : "/" + basename}`
      exports[id] = {
         id,
         exported: key,
         basename: filename,
         filename: `${filename}.js`,
         source: entry,
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
