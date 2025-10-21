import Path from 'node:path'
import Fs from 'node:fs'
import { CommandModule } from "yargs"
import { StorageFiles } from "../model/storage.js"
import { AppEntry, Library, open_workspace } from "../model/workspace.js"
import { build_application } from "../builder/build-application.js"
import { build_library, make_libname } from "../builder/build-library.js"

export function command_make(): CommandModule<any, {
   watch?: boolean
   pack?: boolean
   versioned?: string
   devmode?: boolean
   apps?: string
   libs?: string
   dist?: string
}> {
   return {
      command: 'make',
      describe: 'Make distribuable artifacts',
      builder: (yargs) => yargs
         .option("apps", {
            type: "string",
            default: "",
            describe: "List of applications to make, ex: lib1,lib2,..."
         })
         .option("libs", {
            type: "string",
            default: "",
            describe: "List of libraries to make, ex: lib1,lib2,..."
         })
         .option("watch", {
            type: "boolean",
            describe: "Watch and rebuild on files change",
            default: false,
         })
         .option("devmode", {
            type: "boolean",
            default: false,
         })
         .option("pack", {
            type: "boolean",
            describe: "Ask to create tarball delivery"
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
         if (argv.devmode) console.log("> Use devmode")

         let version = argv.versioned
         if (version === "*") {
            version = JSON.parse(Fs.readFileSync("package.json").toString())?.version
            console.log(`> Use version: ${version}`)
         }

         let libraries: Library[] = []
         if (argv.libs === "*") {
            libraries = ws.libraries
         }
         else if (argv.libs) {
            for (const libname of argv.libs.split(",")) {
               const lib = ws.get_library(libname)
               if (lib) libraries.push(lib)
               else console.error(`> library not found: ${libname}`)
            }
         }

         let applications: AppEntry[] = []
         if (argv.apps) {
            for (const appname of argv.apps.split(",")) {
               const app = ws.get_application(appname)
               if (app) applications.push(app)
               else console.error(`> application not found: ${appname}`)
            }
         }

         const pendings = []
         for (const app of applications) {
            const { name } = app.descriptor
            const outputDir = Path.resolve(argv.dist, make_libname(name))
            const storage = new StorageFiles(name, outputDir)
            pendings.push(build_application({
               app,
               storage,
               version: version,
               devmode: argv.devmode,
               watch: argv.watch,
            }))
         }
         for (const lib of libraries) {
            const outputDir = Path.resolve(argv.dist, make_libname(lib.name))
            const storage = new StorageFiles(lib.name, outputDir)
            pendings.push(build_library({
               library: lib,
               storage,
               version: version,
               devmode: argv.devmode,
               watch: argv.watch,
            }, argv.pack ? Path.resolve(argv.dist) : null))
         }
         await Promise.all(pendings)
      }
   }
}
