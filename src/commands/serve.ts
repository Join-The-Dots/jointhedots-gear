import Path from 'node:path'
import Fs from 'node:fs'
import { CommandModule } from "yargs"
import { StorageFiles } from "../model/storage.js"
import { open_workspace } from "../model/workspace.js"
import { build_application } from "../builder/build-application.js"
import { make_libname } from "../builder/build-library.js"

export function command_serve(): CommandModule<any, {
   app?: string
   port?: number
   versioned?: string
   devmode?: boolean
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
         .option("dist", {
            type: "string",
            default: "./dist",
         }),
      handler: async (argv) => {
         const ws = await open_workspace(".", argv.devmode)
         const app = ws.get_application(argv.app)
         if (!app) throw new Error(`Application '${argv.app}' not exists`)
         if (argv.devmode) console.log("> Use devmode")

         let version = argv.versioned
         if (version === "*") {
            version = JSON.parse(Fs.readFileSync("package.json").toString())?.version
            console.log(`> Use version: ${version}`)
         }

         const outputDir = Path.resolve(argv.dist, make_libname(argv.app))
         const storage = new StorageFiles(ws.name, outputDir)
         await build_application({
            app,
            storage,
            version,
            devmode: argv.devmode,
            port: argv.port,
         })
      }
   }
}
