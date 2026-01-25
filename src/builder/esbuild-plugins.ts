import Fs from "node:fs"
import Path from 'node:path'
import Url from "node:url"
import MIME from 'mime'
import postcss from 'postcss'
import * as esbuild from 'esbuild'
import { sassPlugin } from 'esbuild-sass-plugin'
import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill"
import { ESModulesTask } from "./build-target.ts"
import { PackageRootDir } from "../utils/file.ts"

const VirtualOutDir = Path.normalize('X:/output/')

export async function create_esbuild_context(
   task: ESModulesTask,
   devmode: boolean,
): Promise<esbuild.BuildContext> {
   const ws = task.target.workspace

   // Define modules mapping
   const modules_mapping: ESModuleResolverOptions = {
      task,
      routeds: {
         "@mui/icons-material/": "@mui/icons-material/esm/"
      },
      replaceds: {
         "buffer": Path.resolve(PackageRootDir, "./browser-modules/buffer.js"),
         "process": Path.resolve(PackageRootDir, "./browser-modules/process.js"),
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
      define: {
         //'globalThis': 'window',
         "process.browser": "true",
         "process.env.NODE_ENV": JSON.stringify(devmode ? "development" : "production"),
         ...workspace_constants,
      },
      plugins: [
         ...task.plugins,
         ESModuleResolverPlugin2(modules_mapping),
         NodeModulesPolyfillPlugin(),
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
                  if (Buffer.from(file.contents).toString().includes(`__require("`)) {
                     task.log.error(`Invalid '__require' detected in output chunk: ${file.path}`)
                  }
                  if (file.path.startsWith(VirtualOutDir)) {
                     const path = file.path.slice(VirtualOutDir.length)
                     tx.commitFile(path, file.contents)
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
