import { type BundleManifest } from "../../core/mod-node.ts"
import { Bundle, Library } from "../workspace.ts"
import { type LibraryPackager } from "../packager.ts"
import { discover_library_definitions } from "../helpers/discover-workspace.ts"
import { makeNormalizedName, NameStyle } from "../../utils/normalized-name.ts"

export class DefaultLibraryPackager implements LibraryPackager {
   async discover_library(lib: Library) {

      // Setup library infos from bundle manifest
      setup_library_bundle(lib)

      // Collect library declaration
      await discover_library_definitions(lib, lib.path)

      return lib.master
   }
}
export function setup_library_bundle(lib: Library) {
   const ws = lib.workspace
   const manif = make_library_bundle_manifest(lib)
   let bun = lib.get_bundle(manif.$id)
   if (!bun) {
      bun = new Bundle(manif, lib.path, lib, lib)
      lib.master = bun
      lib.shelve.push(bun)
      lib.log.info(`+ 📦 bundle: ${bun.id} 🐣`)
      return bun
   }
   else {
      throw new Error(`Library '${lib.get_id()}' is associate to a bundle '${bun.id}' that is already associated`)
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

function make_library_bundle_manifest(lib: Library): BundleManifest {
   return {
      $id: makeNormalizedName(collect_declarations_field(lib, "$id", lib.name), NameStyle.OBJECT),
      type: "bundle",
      icon: collect_declarations_field(lib, "icon", ""),
      title: collect_declarations_field(lib, "title", lib.name),
      tags: collect_declarations_field(lib, "tags", lib.descriptor?.tags),
      keywords: collect_declarations_field(lib, "keywords", lib.descriptor?.keywords),
      description: collect_declarations_field(lib, "description", lib.descriptor?.description),
      selectors: collect_declarations_field(lib, "selectors", undefined),
      data: {
         name: lib.name,
         package: lib.get_id(),
         alias: collect_declarations_field(lib, "alias", lib.name),
         namespaces: collect_declarations_field(lib, "namespaces", []),
         dependencies: collect_declarations_field(lib, "dependencies", []),
         distribueds: collect_declarations_field(lib, "distribueds", {}),
      }
   }
}
