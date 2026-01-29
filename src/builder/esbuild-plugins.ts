import Fs from "node:fs"
import Path from 'node:path'
import Url from "node:url"
import MIME from 'mime'
import postcss from 'postcss'
import * as esbuild from 'esbuild'
import { sassPlugin } from 'esbuild-sass-plugin'
import { ESModulesTask } from "./build-target.ts"
import { PackageRootDir } from "../utils/file.ts"

const VirtualOutDir = Path.normalize('X:/output/')

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
      replaceds: {
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
      }
   }

   // Define constants
   const workspace_constants = Object.keys(ws.constants).reduce((prev, key) => {
      const name = `constants.${key}`
      prev[name] = JSON.stringify(ws.constants[key])
      task.log.info(`+ ${name} = ${prev[name]}`)
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
      inject: [sideEffectsScript],
      define: {
         //'globalThis': 'window',
         'global': 'globalThis',
         "process.browser": "true",
         "process.env.NODE_ENV": JSON.stringify(devmode ? "development" : "production"),
         ...workspace_constants,
      },
      plugins: [
         ...task.plugins,
         ESModuleResolverPlugin2(modules_mapping),
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

/**
 * Plugin to fix CJS interop issues when a module exports a function directly
 * via `module.exports = fn` and then adds properties to that function.
 * 
 * The issue: When esbuild converts CJS `require()` to ESM imports, modules that
 * export a function directly with properties attached (like `module.exports = fn; fn.prop = x`)
 * may not work correctly because the ESM interop wraps things in unexpected ways.
 * 
 * This plugin converts such CJS modules to proper ESM by:
 * 1. Converting `require()` calls to ESM imports
 * 2. Wrapping the code to provide `module` and `exports`
 * 3. Exporting `module.exports` as the default export
 */
export function CJSInteropFixPlugin(): esbuild.Plugin {
   // List of known problematic CJS modules that export functions with properties
   // These modules need special handling for proper ESM interop
   const KNOWN_FUNCTION_EXPORT_MODULES = [
      /[\\/]asap[\\/].*\.js$/,      // asap package
      /[\\/]browser-raw\.js$/,       // asap's browser-raw.js specifically
   ]

   return {
      name: 'cjs-interop-fix',
      setup(build) {
         build.onLoad({ filter: /\.js$/, namespace: 'file' }, async (args) => {
            // Only process known problematic modules
            const isKnownModule = KNOWN_FUNCTION_EXPORT_MODULES.some(pattern => pattern.test(args.path))
            if (!isKnownModule) return null

            // Skip @jspm/core polyfills - they're already ESM
            if (args.path.includes('@jspm/core') || args.path.includes('@jspm\\core')) return null

            let contents: string
            try {
               contents = await Fs.promises.readFile(args.path, 'utf8')
            } catch {
               return null
            }

            // Skip if already ESM (has import/export at top level without module.exports)
            if (/^\s*(import|export)\s/m.test(contents) && !contents.includes('module.exports')) {
               return null
            }

            // Skip if it doesn't use module.exports at all
            if (!contents.includes('module.exports')) {
               return null
            }

            // Extract require statements and convert to imports
            const requires: { varName: string; modulePath: string; fullMatch: string }[] = []
            const requireRegex = /var\s+([\w$]+)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)\s*;?/g
            let match: RegExpExecArray | null

            while ((match = requireRegex.exec(contents)) !== null) {
               requires.push({
                  varName: match[1],
                  modulePath: match[2],
                  fullMatch: match[0]
               })
            }

            // Build the import statements
            const imports = requires.map((r, i) =>
               `import __cjs_import_${i}__ from "${r.modulePath}";`
            ).join('\n')

            // Build variable assignments from imports (handle default export unwrapping)
            const importAssignments = requires.map((r, i) =>
               `var ${r.varName} = __cjs_import_${i}__;`
            ).join('\n')

            // Remove require statements from content
            let transformedContent = contents
            for (const r of requires) {
               transformedContent = transformedContent.replace(r.fullMatch, `// ${r.fullMatch}`)
            }

            // Build the transformed module
            const transformed = `${imports}
var __cjs_exports__ = {};
var __cjs_module__ = { exports: __cjs_exports__ };
(function(module, exports) {
${importAssignments}
${transformedContent}
})(__cjs_module__, __cjs_exports__);
var __cjs_result__ = __cjs_module__.exports;
export default __cjs_result__;
`
            return {
               contents: transformed,
               loader: 'js',
               resolveDir: Path.dirname(args.path)
            }
         })
      }
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
         build.onStart(() => {
            task.log.clear()
            task.log.info("Build started...")
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
               const tx = task.target.edit()
               for (const file of result.outputFiles) {
                  if (file.path.startsWith(VirtualOutDir)) {
                     const path = file.path.slice(VirtualOutDir.length)
                     tx.commitFile(path, file.contents)
                     if (Buffer.from(file.contents).toString().includes(`__require("`)) {
                        task.log.warn(`Dangerous '__require' detected in output chunk: ${path}`)
                     }
                  }
                  else {
                     throw new Error(`Invalid output file: ${file.path}`)
                  }
               }
               task.target.store()
               task.log.info(`Build completed with ${result.outputFiles.length} file(s)`)
            }
            return null
         })
      }
   }
}

export interface ESModuleResolverOptions {
   task: ESModulesTask
   routeds?: Record<string, string>
   replaceds?: Record<string, string>
}

export function ESModuleResolverPlugin2(opts: ESModuleResolverOptions): esbuild.Plugin {

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
