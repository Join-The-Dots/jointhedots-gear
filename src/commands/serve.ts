import Path from "node:path"
import { type CommandModule } from "yargs"
import { StorageFiles } from "../workspace/storage.ts"
import { open_workspace, Workspace } from "../workspace/workspace.ts"
import { build_application } from "../builder/build-application.ts"
import { makeNormalizedName, NameStyle } from "../utils/normalized-name.ts"
import Express from "express"
import { resolvePackageVersion } from "../workspace/helpers/package-npm.ts"

export function command_serve(): CommandModule<any, {
   app?: string
   port?: number
   versioned?: string
   devmode?: boolean
   ws?: string
   dist?: string
}> {
   return {
      command: 'serve',
      describe: 'Server web application with continues build',
      builder: (yargs) => yargs
         .option("app", {
            type: "string",
            required: true,
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
         })
         const app = ws.get_application(argv.app)
         if (!app) throw new Error(`Application '${argv.app}' not exists.`)
         if (argv.devmode) ws.log.warn("Use devmode")

         let version = argv.versioned
         if (version === "*") {
            version = resolvePackageVersion(argv.ws ?? ".")
            ws.log.warn(`Use version: ${version}`)
         }

         const outputDir = Path.resolve(argv.dist, makeNormalizedName(argv.app, NameStyle.WEBC))
         const storage = new StorageFiles(ws.name, outputDir)
         const building = build_application({
            app,
            storage,
            version,
            devmode: argv.devmode,
            devserver: argv.port && `http://localhost:${argv.port}`,
         })

         if (argv.port) {
            await Promise.all([
               building,
               serve(ws, argv.port, storage)
            ])
         }
         else {
            await building
         }
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
      ws.log.success(`Server is running at http://localhost:${port}`)
   })
   return new Promise((resolve) => {
      process.on('SIGQUIT', () => resolve(null))
   })
}

