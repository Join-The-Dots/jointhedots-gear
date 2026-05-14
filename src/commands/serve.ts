import Path from "node:path"
import process from "node:process"
import { type CommandModule } from "yargs"
import { StorageFiles } from "../workspace/storage.ts"
import { open_workspace, Workspace } from "../workspace/workspace.ts"
import { create_application_monolith_target } from "../workspace/builders/build-application.ts"
import { makeNormalizedName, NameStyle } from "../utils/normalized-name.ts"
import Express from "express"
import { resolvePackageVersion } from "../workspace/helpers/package-npm.ts"

export function command_serve(): CommandModule<Record<string, unknown>, {
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
         let buildReady = false

         const serving = argv.port
            ? serve(ws, argv.port, storage, () => buildReady)
            : null

         storage.clean()
         const target = create_application_monolith_target({
            app,
            storage,
            version,
            devmode: argv.devmode,
            devserver: argv.port && `http://localhost:${argv.port}`,
            watch: !!argv.port,
            clean: false,
         })
         target.on((event) => {
            if (event.type === "ready") {
               buildReady = true
            }
         })
         const building = target.build()

         if (serving) {
            await Promise.all([building, serving])
         }
         else {
            await building
         }
      }
   }
}

function serve(ws: Workspace, port: number, storage: StorageFiles, isReady: () => boolean) {
   const app = Express()
   app.use((_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader('Access-Control-Allow-Methods', '*')
      res.setHeader("Access-Control-Allow-Headers", "*")
      next()
   })
   app.get('/esbuild', storage.on_changes.route())
   app.get('/_build_ready', (_req, res) => {
      res.setHeader("Cache-Control", "no-store")
      res.json({ ready: isReady() })
   })
   app.get('/{*path}', (req, res, next) => {
      const isHtmlRequest = req.path === '/' || req.path.endsWith('.html')
      if (!isReady() && isHtmlRequest) {
         res.setHeader("Cache-Control", "no-store")
         res.type("html").send(createBuildStubHtml())
         return
      }
      next()
   }, storage.route())
   app.listen(port, () => {
      ws.log.success(`Server is running at http://localhost:${port}`)
   })
   return new Promise<void>((resolve) => {
      (process as unknown as NodeJS.Process).on('SIGQUIT', () => resolve())
   })
}

function createBuildStubHtml(): string {
   return `<!DOCTYPE html>
<html>
   <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1.0">
      <title>Building...</title>
      <style>
         :root { color-scheme: light dark; }
         html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
         body { display: grid; place-items: center; }
         .panel { padding: 20px 24px; border: 1px solid #8884; border-radius: 10px; }
      </style>
   </head>
   <body>
      <div class="panel">Application is building. This page will reload when ready.</div>
      <script>
         const check = async () => {
            try {
               const r = await fetch('/_build_ready', { cache: 'no-store' })
               if (r.ok) {
                  const state = await r.json()
                  if (state.ready) {
                     location.reload()
                     return
                  }
               }
            } catch { }
            setTimeout(check, 500)
         }
         check()
      </script>
   </body>
</html>`
}

