import Path from "node:path"
import { type CommandModule } from "yargs"
import { StorageFiles } from "../workspace/storage.ts"
import { type Bundle, open_workspace, type Workspace } from "../workspace/workspace.ts"
import { build_app_composable_plugin } from "../workspace/builders/build-app-plugin.ts"
import { resolvePackageVersion } from "../workspace/helpers/package-npm.ts"
import Express from "express"

export function command_compose(): CommandModule<any, {
   bundles?: string
   port?: number
   versioned?: string
   devmode?: boolean
   ws?: string
   dist?: string
}> {
   return {
      command: 'compose',
      describe: 'Build and serve bundles as a rack of plugins in a shelve directory',
      builder: (yargs) => yargs
         .option("bundles", {
            type: "string",
            alias: "buns",
            default: "*",
            describe: "List of bundles to compose, ex: bun1,bun2,... (default: all)"
         })
         .option("devmode", {
            type: "boolean",
            default: false,
         })
         .option("port", {
            type: "number",
            default: 3000,
         })
         .option("versioned", {
            type: "string",
            default: "*",
            describe: "Version applied to delivered package (use * for root package version)"
         })
         .option("ws", {
            type: "string",
            default: ".",
            describe: "Workspace directory"
         })
         .option("dist", {
            type: "string",
            default: "./dist",
         }),
      handler: async (argv) => {
         const ws = await open_workspace({
            workspace_path: argv.ws,
            devmode: argv.devmode,
            ignored_directory: Path.resolve(argv.dist),
         })
         if (argv.devmode) ws.log.warn("Use devmode")

         let version = argv.versioned
         if (version === "*") {
            version = resolvePackageVersion(argv.ws ?? ".")
            ws.log.warn(`Use version: ${version}`)
         }

         const bundles: Bundle[] = []
         if (argv.bundles === "*") {
            for (const lib of ws.libraries) {
               if (lib.master) bundles.push(lib.master)
            }
         }
         else {
            for (const name of argv.bundles.split(",")) {
               const bundle = ws.get_bundle(name)
               if (bundle) bundles.push(bundle)
               else ws.log.error(`Bundle not found: ${name}`)
            }
         }

         if (bundles.length === 0) {
            ws.log.error("No bundles found to compose")
            return
         }

         const shelve = new StorageFiles("shelve", Path.resolve(argv.dist, "shelve"))
         const pendings = bundles.map(bundle =>
            build_app_composable_plugin({
               bundle,
               shelve,
               version,
               devmode: argv.devmode,
               watch: true,
               clean: !argv.devmode,
            })
         )

         await Promise.all([
            ...pendings,
            serve(ws, argv.port, shelve),
         ])
      }
   }
}

async function serve(ws: Workspace, port: number, storage: StorageFiles) {
   const app = Express()
   app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader('Access-Control-Allow-Methods', '*')
      res.setHeader("Access-Control-Allow-Headers", "*")
      next()
   })
   app.get('/esbuild', storage.on_changes.route())
   app.get('/{*path}', storage.route())
   app.listen(port, () => {
      ws.log.success(`Shelve server is running at http://localhost:${port}`)
   })
   return new Promise((resolve) => {
      process.on('SIGQUIT', () => resolve(null))
   })
}
