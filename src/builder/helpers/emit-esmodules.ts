import Fs from "node:fs"
import Path from 'node:path'
import Url from "node:url"
import MIME from 'mime'
import postcss from 'postcss'
import * as esbuild from 'esbuild'
import { sassPlugin } from 'esbuild-sass-plugin'
import { PackageRootDir, resolve_normalized_suffixed_path } from "../../utils/file.ts"
import type { Log } from "../../model/helpers/logger.ts"
import { Library } from "../../model/workspace.ts"
import { computeNameHashID } from "../../utils/normalized-name.ts"
import type { ResourceEntry } from "../../model/component.ts"
import type { IStorageTransaction } from "../../model/storage.ts"
import { BuildTask } from "./task.ts"

const VirtualOutDir = process.platform === 'win32' ? 'X:\\' : '/_/'

function getEsbuildLogLevel(mode: "normal" | "debug" | "verbose"): esbuild.LogLevel {
   switch (mode) {
      case "verbose":
         return "debug"
      case "debug":
         return "info"
      case "normal":
      default:
         return "silent"
   }
}

async function create_esbuild_context(
   task: ESModulesTask,
   devmode: boolean,
   onReady?: () => void
): Promise<esbuild.BuildContext> {
   const ws = task.target.workspace

   // Define modules mapping - using @jspm/core polyfills (same as Vite)
   const jspmPolyfills = Path.resolve(PackageRootDir, "node_modules/@jspm/core/nodelibs/browser")

   // Side effects script that provides Node.js globals (like Buffer) for browser environment
   const sideEffectsScript = Path.resolve(PackageRootDir, "./browser-modules/side-effects.js")

   // Helper to create both "module" and "node:module" entries
   function withNodePrefix(mappings: Record<string, string>): Record<string, string> {
      const result: Record<string, string> = {}
      for (const [key, value] of Object.entries(mappings)) {
         result[key] = value
         result[`node:${key}`] = value
      }
      return result
   }

   // Scan @jspm/core/nodelibs/browser and build mappings for all polyfill files
   function buildJspmMappings(dir: string, base = ''): Record<string, string> {
      const result: Record<string, string> = {}
      for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
         const rel = base ? `${base}/${entry.name}` : entry.name
         if (entry.isDirectory()) {
            Object.assign(result, buildJspmMappings(Path.join(dir, entry.name), rel))
         } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('chunk-')) {
            const mod = rel.slice(0, -3) // strip .js
            result[mod] = Path.join(dir, entry.name)
            result[`node:${mod}`] = Path.join(dir, entry.name)
         }
      }
      return result
   }

   const tsconfig = new TSConfig(task.rootPath, ws.path)

   const modules_mapping: ESModuleResolverOptions = {
      task,
      routeds: {
         // "@mui/icons-material/": "@mui/icons-material/esm/"
      },
      replaceds: task.polyfilled ? {
         // ESM shims for problematic CJS modules
         "asap": Path.resolve(PackageRootDir, "./browser-modules/asap.js"),
         "asap/raw": Path.resolve(PackageRootDir, "./browser-modules/asap-raw.js"),
         // Node.js polyfills - auto-discovered from @jspm/core/nodelibs/browser
         ...buildJspmMappings(jspmPolyfills),
         // readable-stream alias
         "readable-stream": `${jspmPolyfills}/stream.js`,
         // Custom browser module overrides (take precedence over jspm)
         ...withNodePrefix({
            "buffer": Path.resolve(PackageRootDir, "./browser-modules/buffer.js"),
            "process": Path.resolve(PackageRootDir, "./browser-modules/process.js"),
            "util": Path.resolve(PackageRootDir, "./browser-modules/util.js"),
            "worker_threads": Path.resolve(PackageRootDir, "./browser-modules/worker_threads.js"),
         }),
      } : {}
   }

   // Define constants
   const workspace_constants = Object.keys(ws.constants).reduce((prev, key) => {
      const name = `constants.${key}`
      prev[name] = JSON.stringify(ws.constants[key])
      return prev
   }, {})

   const options: esbuild.BuildOptions = {
      entryPoints: task.entries,
      outdir: VirtualOutDir,
      format: 'esm',
      target: 'es2022',
      platform: "browser",
      tsconfig: tsconfig.configFile ?? undefined,
      sourcemap: devmode ? "linked" : false,
      minify: devmode ? false : true,
      bundle: true,
      splitting: true,
      treeShaking: true,
      write: false,
      logLevel: getEsbuildLogLevel(ws.logger.mode),
      chunkNames: "chunk.[hash]",
      jsx: "automatic",
      jsxImportSource: "react",
      mainFields: ['browser', 'module', 'main', 'index'],
      inject: task.polyfilled ? [sideEffectsScript] : [],
      define: {
         //'globalThis': 'window',
         'global': 'globalThis',
         "process.browser": "true",
         "process.env.NODE_ENV": JSON.stringify(devmode ? "development" : "production"),
         ...workspace_constants,
      },
      plugins: [
         ESModuleResolverPlugin(modules_mapping, tsconfig),
         ...task.plugins,
         StyleSheetPlugin(task),
         StoragePlugin(task, onReady),
      ],
      loader: {
         '.jpg': 'file',
         '.jpeg': 'file',
         '.png': 'file',
         '.gif': 'file',
         '.eot': 'file',
         '.ttf': 'file',
         '.svg': 'file',
         '.woff': 'file',
         '.woff2': 'file',
      },
   }

   return esbuild.context(options)
}

function copyAssets(task: ESModulesTask) {
   const tx = task.target.edit()

   function trimUrlValue(value) {
      var beginSlice, endSlice
      value = value.trim()
      beginSlice = value.charAt(0) === '\'' || value.charAt(0) === '"' ? 1 : 0
      endSlice = value.charAt(value.length - 1) === '\'' ||
         value.charAt(value.length - 1) === '"' ?
         -1 : undefined
      return value.slice(beginSlice, endSlice).trim()
   }

   function getCommonBaseDir(a, b) {
      var common = []
      a = a.split(Path.sep)
      b = b.split(Path.sep)
      for (var i = 0; i < a.length; i++) {
         if (b[i] === undefined || b[i] !== a[i]) {
            break
         }
         common.push(a[i])
      }
      return common.join(Path.sep)
   }

   function handleUrlDecl(decl: any, result: any) {
      decl.value = decl.value.replace(/url\((.*?)\)/g,
         function (fullMatch, urlMatch) {
            urlMatch = trimUrlValue(urlMatch)

            // Ignore absolute urls, data URIs, or hashes
            if (urlMatch.indexOf('/') === 0 ||
               urlMatch.indexOf('data:') === 0 ||
               urlMatch.indexOf('#') === 0 ||
               /^[a-z]+:\/\//.test(urlMatch)) {
               return fullMatch
            }

            const cssFromDirAbs = Path.dirname(Path.resolve(result.opts.from))
            const assetUrlParsed = Url.parse(urlMatch)
            const assetFromAbs = Path.resolve(cssFromDirAbs, assetUrlParsed.pathname)
            const assetBasename = Path.basename(assetUrlParsed.pathname)
            const assetFromDirAbs = Path.dirname(assetFromAbs)
            const fromBaseDirAbs = getCommonBaseDir(assetFromDirAbs, cssFromDirAbs)
            const assetPathPart = Path.relative(fromBaseDirAbs, assetFromDirAbs)
            const newAssetFile = Path.join(assetPathPart, assetBasename)

            // Read the original file
            let contents = null
            try {
               contents = Fs.readFileSync(assetFromAbs)
            } catch (e) {
               result.warn('Can\'t read asset file "' + assetFromAbs + '". Ignoring.', { node: decl })
               contents = null
            }


            // Write new asset file into base dir
            let newFilename: string
            if (contents !== null) {
               newFilename = tx.commitContent(contents, MIME.getType(newAssetFile))
            }
            else {
               const urlBasename = assetBasename +
                  (assetUrlParsed.search ? assetUrlParsed.search : '') +
                  (assetUrlParsed.hash ? assetUrlParsed.hash : '')
               newFilename = Path.join(assetPathPart, urlBasename)
            }

            // Return updated url
            let newUrl = 'url("' + newFilename + '")'
            if (Path.sep === Path.win32.sep) {
               newUrl = newUrl.replace(/\\/g, '/')
            }
            return newUrl
         }
      )
   }

   return function (css, result) {
      css.walkDecls(function (decl) {
         if (decl.value && decl.value.indexOf('url(') > -1) {
            handleUrlDecl(decl, result)
         }
      })
   }
}

export function StyleSheetPlugin(task: ESModulesTask) {
   const workspacePath = task.target.workspace.path
   const useTailwind = hasTailwindConfig(workspacePath)
   if (useTailwind) {
      task.log.info(`+ 🎨 Tailwind CSS detected`)
   }

   return sassPlugin({
      type: 'style',
      async transform(source: string, _resolveDir: string, filePath: string) {
         const plugins: postcss.AcceptedPlugin[] = []
         if (useTailwind) {
            const tailwindcss = (await import('@tailwindcss/postcss')).default
            plugins.push(tailwindcss({ base: workspacePath }))
         }
         plugins.push(copyAssets(task))
         const { css } = await postcss(plugins)
            .process(source, {
               from: filePath,
               to: `index.css`
            })
         return css
      }
   })
}

/** Check if the workspace has a Tailwind CSS configuration */
function hasTailwindConfig(workspacePath: string): boolean {
   const configFiles = [
      'tailwind.config.js',
      'tailwind.config.ts',
      'tailwind.config.mjs',
      'tailwind.config.cjs',
   ]
   for (const file of configFiles) {
      if (Fs.existsSync(Path.join(workspacePath, file))) {
         return true
      }
   }
   // Tailwind v4: detect @tailwindcss/postcss in workspace dependencies
   try {
      const pkgPath = Path.join(workspacePath, 'package.json')
      if (Fs.existsSync(pkgPath)) {
         const pkg = JSON.parse(Fs.readFileSync(pkgPath, 'utf-8'))
         const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
         if (allDeps['tailwindcss'] || allDeps['@tailwindcss/postcss']) {
            return true
         }
      }
   } catch { }
   return false
}

export function StoragePlugin(task: ESModulesTask, onReady?: () => void): esbuild.Plugin {
   return {
      name: "dipatch-files",
      setup: (build) => {
         let buildStartTime: number = 0
         build.onStart(() => {
            task.log.clear()
            buildStartTime = Date.now()
         })
         build.onEnd(async (result) => {
            if (result.errors.length > 0) {
               task.log.error(`Build failed with ${result.errors.length} error(s)`)
            }
            for (const error of result.errors) {
               task.log.error(error)
            }
            for (const warning of result.warnings) {
               task.log.warn(warning)
            }
            if (result.outputFiles) {
               const storeStart = Date.now()
               const tx = task.target.edit()
               for (const file of result.outputFiles) {
                  if (file.path.startsWith(VirtualOutDir)) {
                     const path = file.path.slice(VirtualOutDir.length)
                     tx.commitFile(path, file.contents)
                     checkFileTranspilation(path, file)
                  }
                  else {
                     throw new Error(`Invalid output file: ${file.path}`)
                  }
               }
               task.target.store()

               const storeTime = (Date.now() - storeStart) / 1000
               const buildTime = (Date.now() - buildStartTime) / 1000
               task.log.info(`Store ES graph in ${result.outputFiles.length} file(s) (compile: ${buildTime.toFixed(2)}s, store: ${storeTime.toFixed(2)}s)`)
            }
            if (onReady) {
               onReady()
               onReady = null
            }
            return null
         })
         function checkFileTranspilation(path: string, file: esbuild.OutputFile) {
            const content = Buffer.from(file.contents).toString()
            if (content.includes(`__require(`)) {
               const matches = content.match(/__require\(["'][^"']+["']\)/g)
               if (matches) {
                  const unique = [...new Set(matches)]
                  task.log.warn(`Unmanaged require detected in '${path}': ${unique.join(", ")}`)
               }
            }
         }
      }
   }
}

export interface ESModuleResolverOptions {
   task: ESModulesTask
   routeds?: Record<string, string>
   replaceds?: Record<string, string>
}

/**
 * Extracts the package name from an import specifier.
 */
function getPackageName(path: string): string {
   const parts = path.split('/')
   return path.startsWith('@') && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]
}

/**
 * Reads `singleton` field from the package.json closest to a resolved path.
 */
function isSingletonPackage(resolvedPath: string, packageName: string): boolean {
   const norm = resolvedPath.replace(/\\/g, '/')
   const marker = `/node_modules/${packageName}/`
   const idx = norm.lastIndexOf(marker)
   if (idx === -1) return false
   try {
      const pkgJson = JSON.parse(Fs.readFileSync(resolvedPath.substring(0, idx + marker.length) + 'package.json', 'utf-8'))
      return pkgJson.singleton === true
   } catch { return false }
}

/**
 * Collects workspace libraries reachable from a root library (BFS).
 * Index 0 = most dominant.
 */
export function collectLibraryGraph(rootLib: Library): Library[] {
   const libs: Library[] = [rootLib]
   const ws = rootLib.workspace
   for (let i = 0; i < libs.length; i++) {
      const deps = { ...libs[i].descriptor.dependencies, ...libs[i].descriptor.devDependencies, ...libs[i].descriptor.peerDependencies }
      for (const id in deps) {
         const dep = ws.get_library(id)
         if (dep && !libs.includes(dep)) libs.push(dep)
      }
   }
   return libs
}

/**
 * Generic dependency deduplication plugin.
 *
 * For each npm package seen across multiple workspace libraries, forces resolution
 * from the dominant library (first in BFS order) to guarantee a single version.
 * Packages declaring `"singleton": true` in their package.json are always resolved
 * from the root node_modules.
 */
export function DependencyDeduplicationPlugin(libraries: Library[], rootNodeModules: string, log: Log): esbuild.Plugin {

   // Build dominance map: first library (BFS) that declares a dependency wins
   const dominantDir = new Map<string, string>()
   const refCount = new Map<string, number>()
   for (const lib of libraries) {
      const deps = { ...lib.descriptor.dependencies, ...lib.descriptor.devDependencies, ...lib.descriptor.peerDependencies }
      for (const name in deps) {
         if (!dominantDir.has(name)) dominantDir.set(name, lib.path)
         refCount.set(name, (refCount.get(name) || 0) + 1)
      }
   }
   // Only deduplicate packages referenced by 2+ libraries
   const shared = new Set<string>([...refCount].filter(([, c]) => c > 1).map(([n]) => n))
   if (shared.size) log.info(`[dedup] ${shared.size} shared deps across ${libraries.length} libraries`)

   // Caches
   const resolved = new Map<string, string>()          // specifier → path
   const singletonCache = new Map<string, boolean>()    // packageName → singleton?

   return {
      name: "dependency-deduplication",
      setup(build) {
         build.onResolve({ filter: /.*/ }, async (args) => {
            if (args.pluginData?.deduplicated) return null
            if (args.path.startsWith('.') || args.path.startsWith('/') || Path.isAbsolute(args.path)) return null

            const pkg = getPackageName(args.path)

            // Fast path: already resolved
            if (resolved.has(args.path)) return { path: resolved.get(args.path)!, namespace: 'file' }

            // Skip packages that are neither shared nor potentially singleton
            if (!shared.has(pkg) && singletonCache.get(pkg) === false) return null

            const pluginData = { ...args.pluginData, deduplicated: true }
            const resolveFrom = shared.has(pkg) ? dominantDir.get(pkg)! : args.resolveDir

            const result = await build.resolve(args.path, {
               kind: args.kind, resolveDir: resolveFrom, importer: args.importer, namespace: args.namespace, pluginData,
            })
            if (result.errors?.length) return null

            // Discover singleton status on first encounter
            if (!singletonCache.has(pkg)) {
               const is = isSingletonPackage(result.path, pkg)
               singletonCache.set(pkg, is)
               if (is) log.debug(`[dedup] singleton: ${pkg}`)
            }

            // Singleton → force root resolution
            if (singletonCache.get(pkg)) {
               const rootResult = await build.resolve(args.path, {
                  kind: args.kind, resolveDir: rootNodeModules, importer: args.importer, namespace: args.namespace, pluginData,
               })
               if (!rootResult.errors?.length) {
                  resolved.set(args.path, rootResult.path)
                  return rootResult
               }
            }

            // Shared (non-singleton) → dominant resolution already done above
            if (shared.has(pkg)) {
               resolved.set(args.path, result.path)
               return result
            }

            return null
         })
      }
   }
}

/**
 * Parses tsconfig.json compilerOptions (paths + baseUrl) and exposes resolved alias patterns.
 * Looks for tsconfig.json in libraryPath first, then workspacePath as fallback.
 */
export class TSConfig {
   readonly baseUrl: string | null = null
   readonly patterns: [string, string][] = []
   readonly configFile: string | null = null
   readonly configData: any = null

   constructor(libraryPath: string, workspacePath: string) {
      const tsconfigFile = [libraryPath, workspacePath]
         .filter(Boolean)
         .map(dir => Path.join(dir, 'tsconfig.json'))
         .find(f => Fs.existsSync(f))
      if (!tsconfigFile) return

      try {
         const raw = Fs.readFileSync(tsconfigFile, 'utf-8')
         const cleaned = raw.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1')
         const tsconfig = JSON.parse(cleaned)
         const opts = tsconfig.compilerOptions
         if (!opts?.paths) return

         this.configData = tsconfig
         this.configFile = tsconfigFile
         this.baseUrl = Path.resolve(Path.dirname(tsconfigFile), opts.baseUrl || '.')
         for (const [alias, targets] of Object.entries<string[]>(opts.paths)) {
            for (const target of targets) {
               const prefix = alias === '*' ? '' : alias.endsWith('/*') ? alias.slice(0, -2) : alias
               const targetPath = target.endsWith('/*') ? target.slice(0, -2) : target
               this.patterns.push([prefix, Path.resolve(this.baseUrl, targetPath)])
            }
         }
      } catch { }
   }

   get hasAliases(): boolean {
      return this.patterns.length > 0
   }

   /** Resolve an import path against tsconfig path aliases. Returns the resolved file path or null. */
   resolve(importPath: string, resolveFilePath: (importPath: string, baseDir: string) => string | null): string | null {
      for (const [prefix, dir] of this.patterns) {
         if (prefix === '') {
            // Wildcard "*" pattern: try resolving the full import path under the target dir
            const resolved = resolveFilePath('./' + importPath, dir)
            if (resolved) return resolved
         } else if (importPath === prefix || importPath.startsWith(prefix + '/')) {
            const rest = importPath.slice(prefix.length)
            const resolved = resolveFilePath('.' + rest, dir)
            if (resolved) return resolved
         }
      }
      return null
   }
}

export function ESModuleResolverPlugin(opts: ESModuleResolverOptions, tsconfigPaths?: TSConfig): esbuild.Plugin {

   const internalLoaders: Record<string, esbuild.Loader> = {
      ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx",
      ".json": "json", ".txt": "text", ".md": "text", ".css": "css",
   }

   return {
      name: 'esm-resolver',
      setup(build) {
         const { routeds = {}, replaceds = {}, task } = opts
         const workspaceRoot = task.target.workspace.path

         build.onResolve({ filter: /.*/ }, async (args) => {

            // 0. Check for internal modules
            if (task.internals.has(args.path)) {
               return { path: args.path, namespace: "internal" }
            }

            // 1. Check for path routing (e.g., @mui/icons-material/ -> esm/)
            if (args.with['esm-resolver'] !== "true") {
               for (const mod_id in routeds) {
                  if (args.path.includes(mod_id)) {
                     const esm_alt = args.path.replace(mod_id, routeds[mod_id])
                     const result = await build.resolve(esm_alt, {
                        kind: args.kind,
                        resolveDir: args.resolveDir,
                        importer: args.importer,
                        namespace: args.namespace,
                        with: { 'esm-resolver': "true" },
                     })
                     return result
                  }
               }
            }

            // 2. Check for explicit replacements first
            if (replaceds[args.path]) {
               return {
                  path: replaceds[args.path],
                  namespace: "file",
               }
            }

            // 3. Handle relative/absolute file paths (entry points and local imports)
            if (args.path.startsWith(".") || args.path.startsWith("/") || Path.isAbsolute(args.path)) {
               const baseDir = args.resolveDir || workspaceRoot
               const resolved = resolve_normalized_suffixed_path(baseDir, args.path)
               if (resolved) {
                  return { path: resolved, namespace: "file" }
               }
            }

            // 4. Resolve tsconfig path aliases (e.g. @app/* -> ./src/*)
            if (tsconfigPaths?.hasAliases) {
               const resolved = tsconfigPaths.resolve(args.path, (importPath, baseDir) => {
                  return resolve_normalized_suffixed_path(baseDir, importPath)
               })
               if (resolved) {
                  return { path: resolved, namespace: "file" }
               }
            }

         })

         // Loader for internal modules
         build.onLoad({ filter: /.*/, namespace: 'internal' }, (args) => {
            const contents = task.internals.get(args.path)
            if (contents === undefined) {
               return { errors: [{ text: `Internal module not found: ${args.path}` }] }
            }
            const ext = Path.extname(args.path) || ".ts"
            const loader = internalLoaders[ext] ?? "ts"
            return { contents, loader, resolveDir: workspaceRoot }
         })
      },
   }
}

export class ESModulesTask extends BuildTask {
   entries: { [url: string]: string } = {}
   imports: { [file: string]: string } = {}
   internals = new Map<string, string>()

   plugins: esbuild.Plugin[] = []
   context: esbuild.BuildContext = null
   transaction: IStorageTransaction = null
   polyfilled: boolean = true
   rootPath: string = null

   set_root(path: string) {
      this.rootPath = path
   }

   add_entry(name: string, path: string) {
      this.entries[name] = path
      this.imports[path] = name
   }
   add_entry_typescript(code: string, name?: string): string {
      const id = computeNameHashID(code)
      if (!name) name = id
      this.internals.set(id, code)
      this.add_entry(name, id)
      return name
   }
   add_resource_entry(resource: ResourceEntry, baseDir: string, library: Library): ResourceEntry {
      if (typeof resource === "string") {
         const parts = resource.split("#")
         const file = library.resolve_entry_path(parts[0], baseDir)
         if (file) {
            let named = this.imports[file]
            if (!named) {
               named = library.make_file_id("lambda", file)
               this.add_entry(named, file)
            }
            return `./${named}.js#${parts[1] || "default"}`
         }
         else {
            throw new Error(`${library.name}: Cannot resolve file: ${parts[0]}`)
         }
      }
      else {
         return resource
      }
   }
   async execute() {
      if (this.context) {
         const prev_ctx = this.context
         this.context = null
         await prev_ctx.dispose()
      }

      const { target } = this
      if (target.watch) {
         return new Promise<void>(async (resolve, reject) => {
            this.context = await create_esbuild_context(this, target.devmode, resolve)
            await this.context.watch()
         })
      }
      else {
         this.context = await create_esbuild_context(this, target.devmode)
         await this.context.rebuild()
         await this.context.dispose()
      }
   }
}
