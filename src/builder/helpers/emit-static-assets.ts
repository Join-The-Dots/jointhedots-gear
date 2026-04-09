import Path from "node:path"
import MIME from "mime"
import { type AssetsEntry, Library } from "../../workspace/workspace.ts"
import { copyToStorageStream } from "../../workspace/storage.ts"
import { BuildTask } from "./task.ts"

export type AssetMapping = {
   from: string
   to: string
}

export class AssetsTask extends BuildTask {
   assets: AssetMapping[] = []
   statics: Record<string, string> = {}
   add_entry(entry: AssetsEntry, baseDir: string, library: Library) {
      let asset: AssetMapping = null

      if (typeof entry === "string") {
         const from = library.resolve_entry_path(entry, baseDir)
         if (!from) throw new Error(`In '${baseDir}', cannot found asset from: '${entry}'`)
         asset = { from, to: Path.basename(entry) }
      }
      else {
         const from = library.resolve_entry_path(entry.from, baseDir)
         if (!from) throw new Error(`In '${baseDir}', cannot found asset from: '${entry.from}'`)
         asset = { from, to: entry.to }
      }

      this.log.info(`+ 📎 assets '${library.name}': ${asset.from} -> ${asset.to}`)
      this.assets.push(asset)
   }
   add_static_text(name: string, data: string) {
      this.statics[name] = data
   }
   add_static_json(name: string, data: any) {
      this.statics[name] = JSON.stringify(data, null, 2)
   }
   async execute(): Promise<any> {
      const tx = this.target.edit()
      for (const key in this.statics) {
         tx.commitFile(key, this.statics[key], MIME.getType(key))
      }
      for (const asset of this.assets) {
         if (typeof asset === "string") {
            copyToStorageStream(tx, asset, asset)
         }
         else {
            copyToStorageStream(tx, asset.to, asset.from)
         }
      }
   }
}
