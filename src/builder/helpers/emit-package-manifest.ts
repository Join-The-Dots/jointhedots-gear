import { BuildTask } from "./task.ts"
import type { BuildTarget } from "../build-target.ts"
import type { Bundle, Library, PackageDescriptor } from "../../workspace/workspace.ts"
import { create_export_map, create_package_manifest } from "../../workspace/helpers/create-manifests.ts"
import { console } from "node:inspector"

export class PackageManifestTask extends BuildTask {
   constructor(
      target: BuildTarget,
      readonly library: Library,
      readonly version: string,
   ) {
      super(target)
   }
   async execute() {
      const { library, version } = this
      const pkg = create_package_manifest(library, library.bundle, version)
      const tx = this.target.edit()
      tx.commitFile("package.json", JSON.stringify(pkg, null, 2))
   }
}
