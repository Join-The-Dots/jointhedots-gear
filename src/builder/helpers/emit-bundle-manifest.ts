import { makeComponentPublication, type ComponentPublication } from "../../workspace/component.ts"
import type { Bundle } from "../../workspace/workspace.ts"
import { BuildTarget } from "../build-target.ts"
import { BuildTask } from "./task.ts"
import MIME from 'mime'

export class BundleManifestTask extends BuildTask {
   constructor(readonly target: BuildTarget, readonly bundle: Bundle) {
      super(target)
   }
   async execute() {
      const { target, bundle } = this
      const { manifest } = bundle
      const tx = this.target.edit()

      // Emit static components manifest
      const components: ComponentPublication[] = []
      for (const manif of target.components.values()) {
         const pub = makeComponentPublication(manif)
         pub.ref = await tx.commitContent(JSON.stringify(manif, null, 2), MIME.getType(".json"))
         components.push(pub)
      }
      manifest.data.components = components

      // Emit bundle manifest
      await tx.commitFile(`bundle.manifest.json`, JSON.stringify(manifest, null, 2))
   }
}
