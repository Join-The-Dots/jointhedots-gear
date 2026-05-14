import { BuildTask } from "./task.ts"
import type { BuildTarget } from "../builders/target.ts"
import type { Library } from "../workspace.ts"
import { create_package_manifest } from "../helpers/create-manifests.ts"

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
      const pkg = create_package_manifest(library, library.master, version)
      const tx = this.target.edit()
      tx.commitFile("package.json", JSON.stringify(pkg, null, 2))
   }
}
