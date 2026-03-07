import Path from 'node:path'
import { type CommandModule } from "yargs"
import { StorageFiles } from "../model/storage.ts"
import { type AppEntry, Bundle, Library, open_workspace } from "../model/workspace.ts"
import { build_application } from "../builder/build-application.ts"
import { build_app_composable_bundle } from "../builder/build-app-bundle.ts"
import { build_library } from "../builder/build-library.ts"
import { makeNormalizedName, NameStyle } from '../utils/normalized-name.js'
import { resolvePackageVersion } from "../model/helpers/package-npm.ts"

type MakeOptions = {
   watch?: boolean
   pack?: boolean
   versioned?: string
   devmode?: boolean
   clean?: boolean
   dist?: string
}

export function command_make(): CommandModule<any, MakeOptions & {
   apps?: string
   libs?: string
   bundles?: string
   ws?: string
}> {
   return {
      command: 'make',
      describe: 'Make distribuable artifacts',
      builder: (yargs) => yargs
         .strict()
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
         .option("bundles", {
            type: "string",
            alias: "buns",
            default: "",
            describe: "List of bundles to make, ex: lib1,lib2,..."
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
         .option("clean", {
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

         let libraries: Library[] = []
         if (argv.libs === "*") {
            libraries = ws.libraries
         }
         else if (argv.libs) {
            for (const libname of argv.libs.split(",")) {
               const lib = ws.get_library(libname)
               if (lib) libraries.push(lib)
               else ws.log.error(`library not found: ${libname}`)
            }
         }

         const bundles: Bundle[] = []
         if (argv.bundles === "*") {
            for (const bundle of ws.bundles) {
               bundles.push(bundle)
            }
         }
         else if (argv.bundles) {
            for (const name of argv.bundles.split(",")) {
               const bundle = ws.get_bundle(name)
               if (bundle) bundles.push(bundle) 
               else ws.log.error(`Bundle not found: ${name}`)
            }
         }

         let applications: AppEntry[] = []
         if (argv.apps) {
            for (const appname of argv.apps.split(",")) {
               const app = ws.get_application(appname)
               if (app) applications.push(app)
               else ws.log.error(`application not found: ${appname}`)
            }
         }

         const pendings = []

         if (bundles.length > 0) {
            const shelve = new StorageFiles("shelve", Path.resolve(argv.dist, "shelve"))
            for (const bundle of bundles) {
               pendings.push(build_app_composable_bundle({
                  bundle,
                  shelve,
                  version: version,
                  devmode: argv.devmode,
                  watch: argv.watch,
                  clean: argv.clean || !argv.devmode,
               }))
            }
         }

         for (const app of applications) {
            const { name } = app.descriptor
            const outputDir = Path.resolve(argv.dist, makeNormalizedName(name, NameStyle.WEBC))
            const storage = new StorageFiles(name, outputDir)
            pendings.push(build_application({
               app,
               storage,
               version: version,
               devmode: argv.devmode,
               watch: argv.watch,
               clean: argv.clean || !argv.devmode,
            }))
         }

         for (const lib of libraries) {
            const outputDir = Path.resolve(argv.dist, makeNormalizedName(lib.name, NameStyle.WEBC))
            const storage = new StorageFiles(lib.name, outputDir)
            pendings.push(build_library({
               library: lib,
               storage,
               version: version,
               devmode: argv.devmode,
               watch: argv.watch,
               clean: argv.clean || !argv.devmode,
            }, argv.pack ? Path.resolve(argv.dist) : null))
         }

         await Promise.all(pendings)
      }
   }
}
