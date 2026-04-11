import Path from "node:path"
import { makeComponentPublication, type BundleManifest, type ComponentPublication } from "../component.ts"
import type { Bundle, Library, PackageDescriptor } from "../workspace.ts"
import { resolve_normalized_suffixed_path } from "../../utils/file.ts"
import { getNormalizedKeys } from "../../utils/normalized-name.ts"

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
   const entry = source_ref ? resolve_normalized_suffixed_path(lib.resolve_entry_path(source_ref, baseDir), ".") : null
   const id = `${lib.name}${basename === "." ? "" : "/" + basename}`
   exports[id] = {
      id,
      exported: key,
      basename: filename,
      filename: `${filename}.js`,
      source: entry,
   }
}

export function create_export_map(lib: Library, bun: Bundle): ExportEntries {
   const exports: ExportEntries = {}

   if (bun) {
      for (const id in bun.distribueds) {
         const basename = bun.make_file_id("redist", id)
         const entry = bun.resolve_entry_path(id, lib.path)
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

export function create_bundle_manifest(lib: Library, bun: Bundle): BundleManifest {
   if (!bun) return null
   const entries = create_export_map(lib, bun)
   const bundle_manif = bun.manifest

   const namespaces = new Set<string>()
   const components: ComponentPublication[] = []
   for (const comp of bun.components.values()) {
      const ns = getNormalizedKeys(comp.$id)[0]
      if (ns) namespaces.add(ns)
      components.push(makeComponentPublication(comp))
   }

   bundle_manif.data = {
      baseline: bun.id + "-v0",
      components: components,
      namespaces: Array.from(namespaces),
      exports: {},
   }
   for (const id in entries) {
      const exp = entries[id]
      bundle_manif.data.exports[id] = exp.filename
   }
   return bundle_manif
}

export function create_package_manifest(lib: Library, bun: Bundle, build_version?: string): PackageDescriptor {
   const entries = create_export_map(lib, bun)

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

   if (pkg_manif.dependencies) {
      const resolved = lib.deps.resolved_versions
      for (const dep in pkg_manif.dependencies) {
         if (pkg_manif.dependencies[dep] === "*") {
            const dep_resolved = resolved[dep]
            if (dep_resolved) {
               const [major, minor] = dep_resolved.split(".")
               pkg_manif.dependencies[dep] = `^${major}.${minor}.0`
            }
            else {
               lib.log.warn(`Library dependency '${dep}' is versioned as * but not updatable to locked version`)
            }
         }
      }
   }

   for (const id in entries) {
      const exp = entries[id]
      if (exp.exported) {
         if (!pkg_manif.exports) pkg_manif.exports = {}
         pkg_manif.exports[exp.exported] = {
            import: `./${exp.filename}`,
            types: "./types.d.ts",
         }
      }
   }

   return pkg_manif
}
