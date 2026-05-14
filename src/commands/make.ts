import Path from "node:path"
import { type CommandModule } from "yargs"
import { StorageFiles } from "../workspace/storage.ts"
import { type AppEntry, Library, open_workspace } from "../workspace/workspace.ts"
import { build_application } from "../workspace/builders/build-application.ts"
import { build_library } from "../workspace/builders/build-library.ts"
import { makeNormalizedName, NameStyle } from "../utils/normalized-name.ts"
import { resolvePackageVersion } from "../workspace/helpers/package-npm.ts"

type MakeOptions = {
   watch?: boolean
   pack?: boolean
   versioned?: string
   devmode?: boolean
   clean?: boolean
   dist?: string
   artifactDir?: string
}

export function command_make(): CommandModule<any, MakeOptions & {
   apps?: string
   libs?: string
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
         })
         .option("artifact-dir", {
            type: "string",
            describe: "Directory to write output artifacts (npm if package.json, zip otherwise)",
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

         let applications: AppEntry[] = []
         if (argv.apps) {
            for (const appname of argv.apps.split(",")) {
               const app = ws.get_application(appname)
               if (app) applications.push(app)
               else ws.log.error(`application not found: ${appname}`)
            }
         }

         const artifactDir = argv.artifactDir ? Path.resolve(argv.artifactDir) : undefined
         const pendings = []

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
               artifactDir,
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
               artifactDir,
            }, argv.pack ? Path.resolve(argv.dist) : null))
         }

         await Promise.all(pendings)
      }
   }
}
