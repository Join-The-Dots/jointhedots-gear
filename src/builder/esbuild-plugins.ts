import Fs from "node:fs"
import Path from 'node:path'
import Url from "node:url"
import postcss from 'postcss'
import { sassPlugin } from 'esbuild-sass-plugin'
import { IStorageStream } from "../model/workspace.js"
import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill"
import { StorageFiles } from "../model/storage.js"
import * as esbuild from 'esbuild'
import MIME from 'mime'
import { MapLike, PackageRootDir } from "../utils/helpers.js"
import { BuildTarget } from "./build-target.js"

export async function create_esbuild_context(
   target: BuildTarget,
   storage: StorageFiles,
   outdir: string,
   devmode: boolean,
   plugins: esbuild.Plugin[] = [],
): Promise<esbuild.BuildContext> {
   const ws = target.workspace

   // Define modules mapping
   const modules_mapping = {
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
      console.log(`+ ${name} = ${prev[name]}`)
      return prev
   }, {})

   const options: esbuild.BuildOptions = {
      entryPoints: target.esmodules.entries,
      outdir,
      format: 'esm',
      target: 'es2022',
      platform: "browser",
      sourcemap: devmode ? "linked" : false,
      minify: devmode ? false : true,
      bundle: true,
      splitting: true,
      treeShaking: true,
      write: false,
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
         ...plugins,
         ESModuleResolverPlugin(modules_mapping),
         NodeModulesPolyfillPlugin(),
         StyleSheetPlugin(storage),
         StoragePlugin(storage),
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

function copyAssets(storage: IStorageStream) {

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
            break;
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
               newFilename = storage.commitContent(contents, MIME.getType(newAssetFile))
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

export function StyleSheetPlugin(storage: IStorageStream) {
   return sassPlugin({
      type: 'style',
      async transform(source: string, _resolveDir: string, filePath: string) {
         const { css } = await postcss()
            .use(copyAssets(storage))
            .process(source, {
               from: filePath,
               to: `index.css`
            })
         return css
      }
   })
}

export function StoragePlugin(storage: StorageFiles): esbuild.Plugin {
   return {
      name: "dipatch-files",
      setup: (build) => {
         build.onEnd((result) => {
            const { outputFiles } = result
            if (outputFiles) {
               const files = new Map<string, esbuild.OutputFile>()
               const changes = { added: [] as string[], updated: [] as string[], }
               for (const file of outputFiles) {
                  const prev = storage.files.get(file.path)
                  let changed = prev ? prev.hash !== file.hash : true
                  if (changed) {
                     if (!prev) changes.added.push(Path.basename(file.path))
                     else changes.updated.push(Path.basename(file.path))
                     Fs.writeFileSync(file.path, file.contents)
                  }
                  files.set(file.path, file)
               }
               const removed = storage.files.size - files.size - changes.added.length
               if (removed !== 0 || changes.added.length !== 0 || changes.updated.length !== 0) {
                  console.log(`[output] ${storage.name}: update ${changes.added.length + changes.updated.length} files(s)`)
                  storage.files = files
                  storage.on_changes.sendEventsToAll("change", changes)
               }
               else {
                  console.log(`[output] ${storage.name}: no changes`)
               }
            }
            return null
         })
      }
   }
}

export function ESModuleResolverPlugin(opts: {
   routeds: MapLike<string>
   replaceds: MapLike<string>
}) {
   const { routeds, replaceds } = opts
   return {
      name: 'esm-resolver',
      setup(build) {
         const filter = /.*/
         build.onResolve({ filter }, async (args) => {
            try {
               for (const mod_id in routeds) {
                  if (args.path.includes(mod_id) && args.with['esm-resolver'] !== "true") {
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
               if (replaceds[args.path]) {
                  return {
                     path: replaceds[args.path],
                     namespace: "file",
                  }
               }
            } catch (e) {
            }
         })
      },
   }
}
