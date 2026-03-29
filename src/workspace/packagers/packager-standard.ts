import { type BundleManifest } from "../component.ts"
import { Bundle, Library } from "../workspace.ts"
import { readSingletonConfigFile } from "../helpers/config-loader.ts"
import { type LibraryPackager } from "../packager.ts"
import { discover_component, discover_library_components, setup_library_bundle } from "../helpers/discover-workspace.ts"

export class DefaultLibraryPackager implements LibraryPackager {
   async discover_library(lib: Library) {

      // Setup library infos from bundle manifest
      setup_library_bundle(lib)

      // Collect library declaration
      await discover_library_components(lib, lib.path)

      return lib.bundle
   }
}

export class BundledLibraryPackager implements LibraryPackager {
   async discover_library(lib: Library) {
      const { data: manif } = await readSingletonConfigFile<BundleManifest>(lib.path, "bundle.manifest")
      const ws = lib.workspace
      let bun = ws.get_bundle(manif.$id)
      if (!bun) {
         bun = new Bundle(manif, lib.path, lib.workspace, lib)
         lib.bundle = bun
         ws.bundles.push(bun)
         lib.log.info(`+ 📦 bundle: ${bun.id}`)
      }
      else if (bun.source != lib) {
         lib.log.warn(`Conflict between two prebuild library bundle`)
      }

      // Analyze library deployment manifest (supports json/yaml/yml/toml, singleton)
      if (manif?.data?.components) {
         for (const pub of manif.data.components) {
            const fpath = lib.path + "/" + (pub.ref ?? pub.id)
            await discover_component(lib, fpath)
         }
      }

      return bun
   }
}
