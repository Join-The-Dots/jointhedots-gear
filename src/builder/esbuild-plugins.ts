import Fs from "node:fs"
import Path from 'node:path'
import Url from "node:url"
import MIME from 'mime'
import postcss from 'postcss'
import * as esbuild from 'esbuild'
import { sassPlugin } from 'esbuild-sass-plugin'
import { ESModulesTask } from "./build-target.ts"
import { PackageRootDir } from "../utils/file.ts"

const VirtualOutDir = Path.normalize('X:/')

export async function create_esbuild_context(
   task: ESModulesTask,
   devmode: boolean,
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

   const modules_mapping: ESModuleResolverOptions = {
      task,
      routeds: {
         // "@mui/icons-material/": "@mui/icons-material/esm/"
      },
      replaceds: task.polyfilled ? {
         // ESM shims for problematic CJS modules
         "asap": Path.resolve(PackageRootDir, "./browser-modules/asap.js"),
         "asap/raw": Path.resolve(PackageRootDir, "./browser-modules/asap-raw.js"),
         // Node.js polyfills
         ...withNodePrefix({
            "buffer": Path.resolve(PackageRootDir, "./browser-modules/buffer.js"),
            "process": Path.resolve(PackageRootDir, "./browser-modules/process.js"),
            "util": Path.resolve(PackageRootDir, "./browser-modules/util.js"),
            "worker_threads": Path.resolve(PackageRootDir, "./browser-modules/worker_threads.js"),
            "child_process": `${jspmPolyfills}/child_process.js`,
            "events": `${jspmPolyfills}/events.js`,
            "stream": `${jspmPolyfills}/stream.js`,
            "readable-stream": `${jspmPolyfills}/stream.js`,
            "path": `${jspmPolyfills}/path.js`,
            "os": `${jspmPolyfills}/os.js`,
            "crypto": `${jspmPolyfills}/crypto.js`,
            "fs": `${jspmPolyfills}/fs.js`,
            "assert": `${jspmPolyfills}/assert.js`,
            "url": `${jspmPolyfills}/url.js`,
            "querystring": `${jspmPolyfills}/querystring.js`,
            "string_decoder": `${jspmPolyfills}/string_decoder.js`,
            "punycode": `${jspmPolyfills}/punycode.js`,
            "http": `${jspmPolyfills}/http.js`,
            "https": `${jspmPolyfills}/https.js`,
            "zlib": `${jspmPolyfills}/zlib.js`,
            "constants": `${jspmPolyfills}/constants.js`,
            "timers": `${jspmPolyfills}/timers.js`,
            "console": `${jspmPolyfills}/console.js`,
            "vm": `${jspmPolyfills}/vm.js`,
            "domain": `${jspmPolyfills}/domain.js`,
            "tty": `${jspmPolyfills}/tty.js`,
            "net": `${jspmPolyfills}/net.js`,
            "dns": `${jspmPolyfills}/dns.js`,
            "dgram": `${jspmPolyfills}/dgram.js`,
            "cluster": `${jspmPolyfills}/cluster.js`,
            "module": `${jspmPolyfills}/module.js`,
            "readline": `${jspmPolyfills}/readline.js`,
            "repl": `${jspmPolyfills}/repl.js`,
            "tls": `${jspmPolyfills}/tls.js`,
            "perf_hooks": `${jspmPolyfills}/perf_hooks.js`,
            "async_hooks": `${jspmPolyfills}/async_hooks.js`,
         })
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
      sourcemap: devmode ? "linked" : false,
      minify: devmode ? false : true,
      bundle: true,
      splitting: true,
      treeShaking: true,
      write: false,
      logLevel: 'silent',
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
         ...task.plugins,
         ESModuleResolverPlugin(modules_mapping),
         StyleSheetPlugin(task),
         StoragePlugin(task),
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
   return sassPlugin({
      type: 'style',
      async transform(source: string, _resolveDir: string, filePath: string) {
         const { css } = await postcss()
            .use(copyAssets(task))
            .process(source, {
               from: filePath,
               to: `index.css`
            })
         return css
      }
   })
}

export function StoragePlugin(task: ESModulesTask): esbuild.Plugin {
   return {
      name: "dipatch-files",
      setup: (build) => {
         var buildStartTime: number = 0
         build.onStart(() => {
            task.log.clear()
            task.log.info("Build started...")
            buildStartTime = performance.now()
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
               const storeStart = performance.now()
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

               const storeTime = (performance.now() - storeStart) / 1000
               const buildTime = (performance.now() - buildStartTime) / 1000
               task.log.info(`Build completed with ${result.outputFiles.length} file(s) in ${buildTime.toFixed(2)}s (store: ${storeTime.toFixed(2)}s)`)
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

export function ESModuleResolverPlugin(opts: ESModuleResolverOptions): esbuild.Plugin {

   const internalLoaders: Record<string, esbuild.Loader> = {
      ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx",
      ".json": "json", ".txt": "text", ".md": "text", ".css": "css",
   }


   const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json']

   /** Resolve a file path with extension probing */
   function resolveFilePath(importPath: string, baseDir: string): string | null {
      const resolved = Path.resolve(baseDir, importPath)

      // Check if exact path exists
      if (Fs.existsSync(resolved) && Fs.statSync(resolved).isFile()) {
         return resolved
      }

      // Try with common extensions
      for (const ext of FILE_EXTENSIONS) {
         const withExt = resolved + ext
         if (Fs.existsSync(withExt)) return withExt
      }

      // Try index files in directory
      if (Fs.existsSync(resolved) && Fs.statSync(resolved).isDirectory()) {
         for (const ext of FILE_EXTENSIONS) {
            const indexPath = Path.join(resolved, `index${ext}`)
            if (Fs.existsSync(indexPath)) return indexPath
         }
      }

      return null
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
               const resolved = resolveFilePath(args.path, baseDir)
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
