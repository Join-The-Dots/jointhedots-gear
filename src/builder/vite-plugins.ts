import Fs from "node:fs"
import Path from 'node:path'
import { build, createServer, type InlineConfig, type Plugin, type ViteDevServer } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { ESModulesTask } from "./build-target.ts"
import { PackageRootDir } from "../utils/file.ts"

const VirtualOutDir = Path.normalize('X:/output/')

export interface ViteBuildResult {
   outputFiles: Array<{ path: string; contents: Uint8Array }>
}

export interface ViteContext {
   rebuild(): Promise<ViteBuildResult>
   watch(): Promise<void>
   dispose(): Promise<void>
   server?: ViteDevServer
}

export async function create_vite_context(
   task: ESModulesTask,
   devmode: boolean,
): Promise<ViteContext> {
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
      }
   }

   // Define constants
   const workspace_constants = Object.keys(ws.constants).reduce((prev, key) => {
      const name = `constants.${key}`
      prev[name] = JSON.stringify(ws.constants[key])
      task.log.info(`+ ${name} = ${prev[name]}`)
      return prev
   }, {} as Record<string, string>)

   // Convert entries to Vite input format
   const input: Record<string, string> = {}
   for (const [name, entryPath] of Object.entries(task.entries)) {
      input[name] = entryPath
   }

   const config: InlineConfig = {
      root: ws.path,
      mode: devmode ? 'development' : 'production',
      logLevel: 'silent',
      build: {
         outDir: VirtualOutDir,
         emptyOutDir: false,
         write: false,
         sourcemap: devmode ? true : false,
         minify: devmode ? false : 'esbuild',
         target: 'es2022',
         rollupOptions: {
            input,
            output: {
               format: 'es',
               entryFileNames: '[name].js',
               chunkFileNames: 'chunk.[hash].js',
               assetFileNames: '[name].[hash][extname]',
            },
            preserveEntrySignatures: 'strict',
         },
         modulePreload: false,
      },
      resolve: {
         alias: modules_mapping.replaceds,
         mainFields: ['browser', 'module', 'main', 'index'],
      },
      define: {
         'global': 'globalThis',
         "process.browser": "true",
         "process.env.NODE_ENV": JSON.stringify(devmode ? "development" : "production"),
         ...workspace_constants,
      },
      plugins: [
         // Use vite-plugin-node-polyfills for Node.js polyfills
         nodePolyfills({
            globals: {
               Buffer: true,
               global: true,
               process: true,
            },
            protocolImports: true,
         }),
         // Custom plugins from task
         ...task.plugins,
         // Internal module resolver
         ESModuleResolverPlugin(modules_mapping),
         // Storage plugin for output handling
         StoragePlugin(task),
         // Inject side effects into entry points
         SideEffectsInjectionPlugin(sideEffectsScript),
      ],
      css: {
         preprocessorOptions: {
            scss: {
               // SCSS options - Vite handles SCSS natively when sass is installed
            }
         }
      },
      esbuild: {
         jsx: 'automatic',
         jsxImportSource: 'react',
      },
      assetsInclude: ['**/*.jpg', '**/*.jpeg', '**/*.png', '**/*.gif', '**/*.eot', '**/*.ttf', '**/*.svg', '**/*.woff', '**/*.woff2'],
   }

   let server: ViteDevServer | undefined
   let outputFiles: Array<{ path: string; contents: Uint8Array }> = []

   return {
      async rebuild(): Promise<ViteBuildResult> {
         outputFiles = []
         const result = await build(config)

         // Handle both single and array outputs
         const outputs = Array.isArray(result) ? result : [result]

         for (const output of outputs) {
            if ('output' in output) {
               for (const chunk of output.output) {
                  const filePath = Path.join(VirtualOutDir, chunk.fileName)
                  let contents: Uint8Array

                  if (chunk.type === 'chunk') {
                     contents = new TextEncoder().encode(chunk.code)
                  } else if (chunk.type === 'asset') {
                     contents = typeof chunk.source === 'string'
                        ? new TextEncoder().encode(chunk.source)
                        : chunk.source
                  }

                  outputFiles.push({ path: filePath, contents })
               }
            }
         }

         return { outputFiles }
      },
      async watch(): Promise<void> {
         server = await createServer({
            ...config,
            server: {
               watch: {
                  // Watch options
               }
            }
         })

         // Set up file watcher to trigger rebuilds
         server.watcher.on('change', async () => {
            task.log.info("File changed, rebuilding...")
            await this.rebuild()
         })

         await server.listen()
      },
      async dispose(): Promise<void> {
         if (server) {
            await server.close()
            server = undefined
         }
      },
      get server() { return server }
   }
}

// Plugin to inject side effects (like Node.js globals) into the bundle
function SideEffectsInjectionPlugin(sideEffectsScript: string): Plugin {
   return {
      name: 'side-effects-injection',
      transform(code, id) {
         // Only inject into entry points
         if (this.getModuleInfo(id)?.isEntry) {
            const sideEffectsImport = `import "${sideEffectsScript}";\n`
            return {
               code: sideEffectsImport + code,
               map: null
            }
         }
         return null
      }
   }
}

export function StoragePlugin(task: ESModulesTask): Plugin {
   return {
      name: "storage-plugin",
      buildStart() {
         task.log.clear()
         task.log.info("Build started...")
      },
      generateBundle(options, bundle) {
         // Process output files in the bundle
         const tx = task.target.edit()
         let fileCount = 0

         for (const fileName in bundle) {
            const chunk = bundle[fileName]
            let contents: Uint8Array

            if (chunk.type === 'chunk') {
               const code = chunk.code
               if (code.includes(`__require("`)) {
                  task.log.error(`Invalid '__require' detected in output chunk: ${fileName}`)
               }
               contents = new TextEncoder().encode(code)
            } else if (chunk.type === 'asset') {
               contents = typeof chunk.source === 'string'
                  ? new TextEncoder().encode(chunk.source)
                  : chunk.source
            }

            tx.commitFile(fileName, contents!)
            fileCount++
         }

         task.target.store()
         task.log.info(`Build completed with ${fileCount} file(s)`)
      },
      buildEnd(error) {
         if (error) {
            task.log.error(`Build failed: ${error.message}`)
         }
      }
   }
}

export interface ESModuleResolverOptions {
   task: ESModulesTask
   routeds?: Record<string, string>
   replaceds?: Record<string, string>
}

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

         // 0. Check for internal modules
         if (task.internals.has(source)) {
            return { id: `\0internal:${source}`, moduleSideEffects: false }
         }

         // 1. Check for path routing (e.g., @mui/icons-material/ -> esm/)
         for (const mod_id in routeds) {
            if (source.includes(mod_id)) {
               const esm_alt = source.replace(mod_id, routeds[mod_id])
               const result = await this.resolve(esm_alt, importer, { skipSelf: true })
               return result
            }
         }

         // 2. Check for explicit replacements first
         if (replaceds[source]) {
            return { id: replaceds[source] }
         }

         // 3. Handle relative/absolute file paths (entry points and local imports)
         if (source.startsWith(".") || source.startsWith("/") || Path.isAbsolute(source)) {
            const baseDir = importer ? Path.dirname(importer) : workspaceRoot
            const resolved = resolveFilePath(source, baseDir)
            if (resolved) {
               return { id: resolved }
            }
         }

         return null
      },
      load(id) {
         // Handle internal modules
         if (id.startsWith('\0internal:')) {
            const internalId = id.slice('\0internal:'.length)
            const contents = opts.task.internals.get(internalId)
            if (contents === undefined) {
               this.error(`Internal module not found: ${internalId}`)
               return null
            }
            return { code: contents }
         }
         return null
      }
   }
}

// Re-export types for compatibility
export type { Plugin as VitePlugin }
