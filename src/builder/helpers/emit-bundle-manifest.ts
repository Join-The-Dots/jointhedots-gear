import { makeComponentPublication, type BundleManifest, type ComponentPublication } from "../../workspace/component.ts"
import { Library, type AppDescriptor, type Bundle } from "../../workspace/workspace.ts"
import { BuildTarget } from "../build-target.ts"
import { BuildTask } from "./task.ts"
import MIME from "mime"

export abstract class BaseManifestTask extends BuildTask {
   async write_manifest(manifest: BundleManifest) {
      const tx = this.target.edit()
      const pubs: ComponentPublication[] = []
      for (const manif of this.target.components.values()) {
         const pub = makeComponentPublication(manif)
         pub.ref = await tx.commitContent(JSON.stringify(manif, null, 2), MIME.getType(".json"))
         pubs.push(pub)
      }
      manifest.data.components = pubs
      await tx.commitFile(`bundle.manifest.json`, JSON.stringify(manifest, null, 2))
   }
}

export class BundleManifestTask extends BaseManifestTask {
   constructor(readonly target: BuildTarget, readonly bundle: Bundle) {
      super(target)
   }
   async execute() {
      const { bundle } = this
      await this.write_manifest(bundle.manifest)
   }
}

export class ApplicationManifestTask extends BaseManifestTask {
   constructor(
      readonly target: BuildTarget,
      readonly app: AppDescriptor,
   ) {
      super(target)
   }
   async execute() {
      const { target, app } = this
      await this.write_manifest({
         $id: target.name,
         name: app.name,
         icon: app.icon,
         title: app.title,
         description: app.description,
         data: {},
      })
   }
}
