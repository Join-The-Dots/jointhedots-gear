import Fs from "node:fs"
import Path from 'node:path'
import Url from "node:url"
import MIME from 'mime'
import postcss from 'postcss'
import * as sass from 'sass'
import { rolldown, watch, type Plugin, type RolldownBuild, type RolldownWatcher, type InputOptions, type OutputOptions, type RolldownOutput } from 'rolldown'
import nodePolyfills from 'rollup-plugin-polyfill-node'
import { ESModulesTask } from "./build-target.ts"
import { PackageRootDir } from "../utils/file.ts"

export interface RolldownBuildContext {
   build: RolldownBuild | RolldownWatcher | null
   inputOptions: InputOptions
   outputOptions: OutputOptions
   rebuild(): Promise<RolldownOutput>
   watch(): Promise<void>
   dispose(): Promise<void>
}

export async function create_rolldown_context(
   task: ESModulesTask,
   devmode: boolean,
): Promise<RolldownBuildContext> {
   const ws = task.target.workspace

   // Side effects script that provides Node.js globals (like Buffer) for browser environment
   const sideEffectsScript = Path.resolve(PackageRootDir, "./browser-modules/side-effects.js")

   const modules_mapping: ESModuleResolverOptions = {
      task,
      routeds: {
         "@mui/icons-material/": "@mui/icons-material/esm/"
      },
      replaceds: {
         // ESM shims for problematic CJS modules
         "asap": Path.resolve(PackageRootDir, "./browser-modules/asap.js"),
         "asap/raw": Path.resolve(PackageRootDir, "./browser-modules/asap-raw.js"),
         // Custom polyfills with exports missing from rollup-plugin-polyfill-node
         "util": Path.resolve(PackageRootDir, "./browser-modules/util.js"),
         "node:util": Path.resolve(PackageRootDir, "./browser-modules/util.js"),
         "child_process": Path.resolve(PackageRootDir, "./browser-modules/child_process.js"),
         "node:child_process": Path.resolve(PackageRootDir, "./browser-modules/child_process.js"),
         "crypto": Path.resolve(PackageRootDir, "./browser-modules/crypto.js"),
         "node:crypto": Path.resolve(PackageRootDir, "./browser-modules/crypto.js"),
      }
   }

   // Define constants
   const workspace_constants = Object.keys(ws.constants).reduce((prev, key) => {
      const name = `constants.${key}`
      prev[name] = JSON.stringify(ws.constants[key])
      task.log.info(`+ ${name} = ${prev[name]}`)
      return prev
   }, {} as Record<string, string>)

   const inputOptions: InputOptions = {
      input: task.entries,
      platform: "browser",
      logLevel: 'silent',
      treeshake: true,
      resolve: {
         mainFields: ['browser', 'module', 'main', 'index'],
      },
      transform: {
         jsx: "react-jsx",
         target: 'es2022',
         define: {
            'global': 'globalThis',
            "process.browser": "true",
            "process.env.NODE_ENV": JSON.stringify(devmode ? "development" : "production"),
            ...workspace_constants,
         },
         // Note: inject in rolldown uses a different format (module -> identifier mapping)
         // We'll handle side-effects via a plugin instead
      },
      moduleTypes: {
         '.jpg': 'asset',
         '.jpeg': 'asset',
         '.png': 'asset',
         '.gif': 'asset',
         '.eot': 'asset',
         '.ttf': 'asset',
         '.svg': 'asset',
         '.woff': 'asset',
         '.woff2': 'asset',
      },
      plugins: [
         ...task.plugins,
         ESModuleResolverPlugin(modules_mapping), // Must be before nodePolyfills to override specific modules
         nodePolyfills({ include: null }), // Transform all files, not just node_modules
         SideEffectsInjectionPlugin(sideEffectsScript),
         StyleSheetPlugin(task),
         StoragePlugin(task),
      ],
   }

   const outputOptions: OutputOptions = {
      // Don't set 'dir' - we don't want rolldown to write files to disk
      // All file output is handled by our StoragePlugin's generateBundle hook
      format: 'esm',
      sourcemap: devmode ? true : false,
      minify: devmode ? false : true,
      chunkFileNames: "chunk.[hash].js",
   }

   let currentBuild: RolldownBuild | RolldownWatcher | null = null

   const context: RolldownBuildContext = {
      build: null,
      inputOptions,
      outputOptions,
      async rebuild(): Promise<RolldownOutput> {
         const bundle = await rolldown(inputOptions)
         currentBuild = bundle
         context.build = bundle
         // Use generate() to get output in memory without writing to disk
         const result = await bundle.generate(outputOptions)
         await bundle.close()
         return result
      },
      async watch(): Promise<void> {
         // The generateBundle hook in StoragePlugin handles all file output
         // By not setting 'dir' in output options, rolldown won't write files to disk
         const watcher = watch({
            ...inputOptions,
            output: outputOptions,
         })
         currentBuild = watcher
         context.build = watcher
         
         watcher.on('event', async (event) => {
            if (event.code === 'BUNDLE_END') {
               task.log.info(`Build completed in ${event.duration}ms`)
               await event.result.close()
            } else if (event.code === 'ERROR') {
               task.log.error(`Build error: ${event.error.message}`)
            }
         })
      },
      async dispose(): Promise<void> {
         if (currentBuild) {
            if ('close' in currentBuild) {
               await currentBuild.close()
            }
            currentBuild = null
            context.build = null
         }
      }
   }

   return context
}

function copyAssets(task: ESModulesTask) {
   const tx = task.target.edit()

   function trimUrlValue(value: string) {
      var beginSlice: number, endSlice: number | undefined
      value = value.trim()
      beginSlice = value.charAt(0) === '\'' || value.charAt(0) === '"' ? 1 : 0
      endSlice = value.charAt(value.length - 1) === '\'' ||
         value.charAt(value.length - 1) === '"' ?
         -1 : undefined
      return value.slice(beginSlice, endSlice).trim()
   }

   function getCommonBaseDir(a: string, b: string) {
      var common: string[] = []
      const aParts = a.split(Path.sep)
      const bParts = b.split(Path.sep)
      for (var i = 0; i < aParts.length; i++) {
         if (bParts[i] === undefined || bParts[i] !== aParts[i]) {
            break
         }
         common.push(aParts[i])
      }
      return common.join(Path.sep)
   }

   function handleUrlDecl(decl: any, result: any) {
      decl.value = decl.value.replace(/url\((.*?)\)/g,
         function (fullMatch: string, urlMatch: string) {
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
            const assetFromAbs = Path.resolve(cssFromDirAbs, assetUrlParsed.pathname!)
            const assetBasename = Path.basename(assetUrlParsed.pathname!)
            const assetFromDirAbs = Path.dirname(assetFromAbs)
            const fromBaseDirAbs = getCommonBaseDir(assetFromDirAbs, cssFromDirAbs)
            const assetPathPart = Path.relative(fromBaseDirAbs, assetFromDirAbs)
            const newAssetFile = Path.join(assetPathPart, assetBasename)

            // Read the original file
            let contents: Buffer | null = null
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

   return function (css: any, result: any) {
      css.walkDecls(function (decl: any) {
         if (decl.value && decl.value.indexOf('url(') > -1) {
            handleUrlDecl(decl, result)
         }
      })
   }
}

/**
 * Plugin to handle SASS/SCSS files compilation with PostCSS processing
 */
export function StyleSheetPlugin(task: ESModulesTask): Plugin {
   return {
      name: 'stylesheet-plugin',
      async load(id) {
         if (!id.endsWith('.scss') && !id.endsWith('.sass') && !id.endsWith('.css')) {
            return null
         }

         let cssContent: string

         if (id.endsWith('.scss') || id.endsWith('.sass')) {
            // Compile SASS/SCSS to CSS
            const result = sass.compile(id, {
               style: 'expanded',
               sourceMap: false,
            })
            cssContent = result.css
         } else {
            // Read plain CSS
            cssContent = await Fs.promises.readFile(id, 'utf8')
         }

         // Process with PostCSS for asset handling
         const { css } = await postcss()
            .use(copyAssets(task))
            .process(cssContent, {
               from: id,
               to: `index.css`
            })

         // Return as a JS module that injects the style
         const escapedCss = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
         return {
            code: `
const style = document.createElement('style');
style.textContent = \`${escapedCss}\`;
document.head.appendChild(style);
`,
            moduleType: 'js',
         }
      }
   }
}

/**
 * Plugin to handle build lifecycle and output file storage
 */
export function StoragePlugin(task: ESModulesTask): Plugin {
   return {
      name: "dispatch-files",
      buildStart() {
         task.log.clear()
         task.log.info("Build started...")
      },
      generateBundle(_options, bundle) {
         const tx = task.target.edit()
         let fileCount = 0

         for (const fileName in bundle) {
            const chunk = bundle[fileName]
            
            if (chunk.type === 'chunk') {
               const content = chunk.code
               if (content.includes(`__require("`)) {
                  task.log.error(`Invalid '__require' detected in output chunk: ${fileName}`)
               }
               tx.commitFile(fileName, content)
               fileCount++
            } else if (chunk.type === 'asset') {
               const content = typeof chunk.source === 'string' 
                  ? chunk.source 
                  : chunk.source
               tx.commitFile(fileName, content)
               fileCount++
            }
         }

         task.target.store()
         task.log.info(`Build completed with ${fileCount} file(s)`)
      },
      renderError(error) {
         task.log.error(`Build failed: ${error?.message || 'Unknown error'}`)
      }
   }
}

export interface ESModuleResolverOptions {
   task: ESModulesTask
   routeds?: Record<string, string>
   replaceds?: Record<string, string>
}

/**
 * Plugin for custom module resolution with routing and replacement support
 */
export function ESModuleResolverPlugin(opts: ESModuleResolverOptions): Plugin {
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
      async resolveId(source, importer, options) {
         const { routeds = {}, replaceds = {}, task } = opts
         const workspaceRoot = task.target.workspace.path
         const resolveDir = importer ? Path.dirname(importer) : workspaceRoot

         // 0. Check for internal modules
         if (task.internals.has(source)) {
            return { id: `\0internal:${source}`, meta: { internal: true } }
         }

         // 1. Check for path routing (e.g., @mui/icons-material/ -> esm/)
         const customInfo = options?.custom?.['esm-resolver']
         if (customInfo !== "routed") {
            for (const mod_id in routeds) {
               if (source.includes(mod_id)) {
                  const esm_alt = source.replace(mod_id, routeds[mod_id])
                  const result = await this.resolve(esm_alt, importer, {
                     skipSelf: true,
                     custom: { 'esm-resolver': "routed" },
                  })
                  return result
               }
            }
         }

         // 2. Check for explicit replacements first
         if (replaceds[source]) {
            return { id: replaceds[source] }
         }

         // 3. Handle relative/absolute file paths (entry points and local imports)
         if (source.startsWith(".") || source.startsWith("/") || Path.isAbsolute(source)) {
            const resolved = resolveFilePath(source, resolveDir)
            if (resolved) {
               return { id: resolved }
            }
         }

         // Let rolldown handle the rest
         return null
      },
      load(id) {
         // Handle internal modules
         if (id.startsWith('\0internal:')) {
            const { task } = opts
            const workspaceRoot = task.target.workspace.path
            const internalId = id.slice('\0internal:'.length)
            const contents = task.internals.get(internalId)
            if (contents === undefined) {
               this.error(`Internal module not found: ${internalId}`)
            }
            return { code: contents!, moduleType: 'ts' }
         }
         return null
      }
   }
}

// Re-export types for build-target.ts
export type { Plugin as RolldownPlugin }

/**
 * Plugin to inject side-effects script at the beginning of entry points.
 * This provides Node.js globals (like Buffer) for browser environment.
 */
export function SideEffectsInjectionPlugin(sideEffectsScript: string): Plugin {
   return {
      name: 'side-effects-injection',
      transform(code, id) {
         // Only inject into entry points or the first module processed
         // We'll inject at the beginning of the bundle via intro option instead
         return null
      },
      intro() {
         // Inject the side effects script content at the beginning of every chunk
         try {
            const content = Fs.readFileSync(sideEffectsScript, 'utf8')
            return content
         } catch (e) {
            console.warn(`Could not read side-effects script: ${sideEffectsScript}`)
            return ''
         }
      }
   }
}
