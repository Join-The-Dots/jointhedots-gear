import Path from "node:path"
import Fs from "node:fs"
import { type CommandModule } from "yargs"
import { open_workspace } from "../workspace/workspace.ts"
import { makeComponentPublication, type BundleManifest, type ComponentPublication } from "../workspace/component.ts"
import { BundleSelector } from "../builder/build-app-base.ts"

export function command_install(): CommandModule<any, {
   ws?: string
   dist?: string
}> {
   return {
      command: 'install',
      describe: 'Install workspace bundles and emit a shelve manifest',
      builder: (yargs) => yargs
         .strict()
         .option("ws", {
            type: "string",
            default: ".",
            describe: "Workspace directory"
         })
         .option("dist", {
            type: "string",
            default: ".",
            describe: "Output directory"
         }),
      handler: async (argv) => {
         const ws = await open_workspace({
            workspace_path: argv.ws,
            devmode: false,
            ignored_directory: Path.resolve(argv.dist),
         })

         // Select all workspace bundles
         const selector = new BundleSelector(ws)
         for (const lib of ws.libraries) {
            selector.add(lib.master)
         }
         if (selector.missing.length > 0) {
            ws.log.warn(`Missing bundle dependencies: ${selector.missing.join(", ")}`)
         }

         // Build shelve manifest indexing all bundles
         const namespaces = new Set<string>()
         const components: ComponentPublication[] = []
         for (const bundle of selector) {
            const pub = makeComponentPublication(bundle.manifest)
            const nss = bundle.manifest.type === "bundle" && bundle.manifest.data?.["namespaces"]
            if (Array.isArray(nss)) {
               for (const ns of nss) {
                  namespaces.add(ns)
               }
            }
            components.push(pub)
         }

         const manifest: BundleManifest = {
            $id: ".",
            type: "bundle",
            data: {
               namespaces: Array.from(namespaces),
               components,
            }
         }

         // Write bundle.manifest.json to dist
         const distDir = Path.resolve(argv.dist)
         Fs.mkdirSync(distDir, { recursive: true })
         const manifestPath = Path.join(distDir, "bundle.manifest.json")
         Fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
         ws.log.success(`Shelve manifest written to ${manifestPath}`)
      }
   }
}