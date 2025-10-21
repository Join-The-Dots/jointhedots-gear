import Fs from 'fs'
import * as Glob from 'glob'
import Os from 'os'
import Path from 'path'
import Ts from 'typescript'

const eol = Os.EOL
const indent = "    "
const DTSLEN = '.d.ts'.length

function normalizeFileName(filename: string) {
   return filename.replaceAll(Path.sep, "/")
}

function normalizeImport(moduleId: string) {
   if (moduleId === "index") {
      return ""
   }
   if (moduleId.endsWith("/index")) {
      moduleId = moduleId.slice(0, -6)
   }
   return `/${moduleId}`
}

function isDtsFilename(filename: string): boolean {
   return filename.slice(-DTSLEN) === '.d.ts'
}

function getError(diagnostics: Ts.Diagnostic[]) {
   let message = 'Declaration generation failed'
   diagnostics.forEach(function (diagnostic) {
      if (diagnostic.file) {
         const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
         message +=
            `\n${diagnostic.file.fileName}(${position.line + 1},${position.character + 1}): ` +
            `error TS${diagnostic.code}: ${diagnostic.messageText}`
      } else {
         message += `\nerror TS${diagnostic.code}: ${diagnostic.messageText}`
      }
   })

   const error = new Error(message)
   error.name = 'EmitterError'
   return error
}

function getFilenames(baseDir: string, files: string[]): string[] {
   return files.map(function (filename) {
      const resolvedFilename = Path.resolve(filename)
      if (resolvedFilename.indexOf(baseDir) === 0) {
         return resolvedFilename
      }

      return Path.resolve(baseDir, filename)
   })
}

function processTree(sourceFile: Ts.SourceFile, replacer: (node: Ts.Node) => string): string {
   let code = ''
   let cursorPosition = 0

   function skip(node: Ts.Node) {
      cursorPosition = node.end
   }

   function readThrough(node: Ts.Node) {
      code += sourceFile.text.slice(cursorPosition, node.pos)
      cursorPosition = node.pos
   }

   function visit(node: Ts.Node) {
      readThrough(node)

      const replacement = replacer(node)

      if (replacement != null) {
         code += replacement
         skip(node)
      }
      else {
         Ts.forEachChild(node, visit)
      }
   }

   visit(sourceFile)
   code += sourceFile.text.slice(cursorPosition)

   return code
}

function getTSConfig(fileName: string, compilerOptionsText: string): [string[], Ts.CompilerOptions] {
   const result = Ts.parseConfigFileTextToJson("tsconfig.json", compilerOptionsText)
   if (result.error) {
      throw getError([result.error])
   }
   const configObject = result.config
   configObject.include = undefined
   const configParseResult = Ts.parseJsonConfigFileContent(configObject, Ts.sys, fileName)
   if (configParseResult.errors && configParseResult.errors.length) {
      throw getError(configParseResult.errors)
   }

   return [
      configParseResult.fileNames,
      configParseResult.options
   ]
}

function isNodeKindImportType(value: Ts.Node): value is Ts.ImportTypeNode {
   return value && value.kind === Ts.SyntaxKind.ImportType
}

function isNodeKindImportDeclaration(value: Ts.Node): value is Ts.ImportDeclaration {
   return value && value.kind === Ts.SyntaxKind.ImportDeclaration
}

function isNodeKindExternalModuleReference(value: Ts.Node): value is Ts.ExternalModuleReference {
   return value && value.kind === Ts.SyntaxKind.ExternalModuleReference
}

function isNodeKindStringLiteral(value: Ts.Node): value is Ts.StringLiteral {
   return value && value.kind === Ts.SyntaxKind.StringLiteral
}

function isNodeKindExportDeclaration(value: Ts.Node): value is Ts.ExportDeclaration {
   return value && value.kind === Ts.SyntaxKind.ExportDeclaration
}


export default function generate(options: {
   baseDir?: string
   exclude?: string[]
   externs?: string[]
   types?: string[]
   includes?: string[]
   outDtsFile: string
   outDir?: string
   prefix?: string
   target?: Ts.ScriptTarget
   compilerOptions: string
}): Promise<void> {
   return new Promise<void>(function (resolve, reject) {
      const [files, compilerOptions] = getTSConfig(options.baseDir, options.compilerOptions)

      compilerOptions.declaration = true
      compilerOptions.target = compilerOptions.target || Ts.ScriptTarget.Latest // is this necessary?
      compilerOptions.moduleResolution = compilerOptions.moduleResolution || Ts.ModuleResolutionKind.Bundler
      compilerOptions.outDir = compilerOptions.outDir || options.outDir

      const baseDir = Path.resolve(options.baseDir)
      const outDir = compilerOptions.outDir
      const filenames = getFilenames(baseDir, files)
      const excludesMap: { [filename: string]: boolean } = {}

      options.exclude = ['node_modules/**/*']
      options.exclude && options.exclude.forEach(function (filename) {
         Glob.sync(filename, { cwd: baseDir }).forEach(function (globFileName) {
            excludesMap[Path.resolve(baseDir, globFileName)] = true
         })
      })

      const output = Fs.createWriteStream(options.outDtsFile, <any>{ mode: parseInt('644', 8) })

      output.on('close', () => { resolve(undefined) })
      output.on('error', reject)

      if (options.externs) {
         options.externs.forEach(function (path: string) {
            output.write(`/// <reference path="${path}" />` + eol)
         })
      }

      if (options.types) {
         options.types.forEach(function (type: string) {
            output.write(`/// <reference types="${type}" />` + eol)
         })
      }

      const host = Ts.createCompilerHost(compilerOptions)
      const program = Ts.createProgram(filenames, compilerOptions, host)

      // Filter source files
      const sourcesMap: { [shortname: string]: boolean } = {}
      const internalsMap: { [shortname: string]: boolean } = {}
      const internalsPrefixedMap: { [shortname: string]: boolean } = {}
      const normalizedBaseDir = normalizeFileName(Path.resolve(baseDir)) + "/"
      program.getSourceFiles().some(function (sourceFile) {
         if (sourceFile.fileName.indexOf(normalizedBaseDir) !== 0) return
         if (excludesMap[sourceFile.fileName]) return

         const shortName = sourceFile.fileName.slice(normalizedBaseDir.length)
         const shortNameNoExt = shortName.slice(0, -Path.extname(sourceFile.fileName).length)
         internalsMap[shortName] = true
         internalsMap[shortNameNoExt] = true
         internalsPrefixedMap[`${options.prefix}/${shortName}`] = true
         internalsPrefixedMap[`${options.prefix}/${shortNameNoExt}`] = true
         sourcesMap[sourceFile.fileName] = true
      })

      // Generate source files
      program.getSourceFiles().some(function (sourceFile) {
         if (!sourcesMap[sourceFile.fileName]) return

         // Source file is already a declaration file so should does not need to be pre-processed by the emitter
         if (isDtsFilename(sourceFile.fileName)) {
            writeDeclaration(sourceFile, false)
            return
         }

         const emitOutput = program.emit(sourceFile, writeFile)
         if (emitOutput.emitSkipped || emitOutput.diagnostics.length > 0) {
            reject(getError(
               emitOutput.diagnostics
                  .concat(program.getSemanticDiagnostics(sourceFile))
                  .concat(program.getSyntacticDiagnostics(sourceFile))
                  .concat(program.getDeclarationDiagnostics(sourceFile))
            ))

            return true
         }
      })

      function isExternalModule(moduleId: string): boolean {
         if (!internalsMap[moduleId]) {
            return true
         }
         return false
      }

      function writeFile(filename: string, data: string) {
         if (isDtsFilename(filename)) {
            const declFile = Ts.createSourceFile(filename, data, compilerOptions.target, true)
            writeDeclaration(declFile, true)
         }
      }

      function writeDeclaration(declarationFile: Ts.SourceFile, isOutput: boolean) {

         // resolving is important for dealting with relative outDirs
         const filename = Path.resolve(declarationFile.fileName)

         // use the outDir here, not the baseDir, because the declarationFiles are outputs of the build process
         const outputDir = (isOutput && Boolean(outDir)) ? Path.resolve(outDir) : baseDir
         const sourceModuleId = normalizeFileName(filename.slice(outputDir.length + 1, -DTSLEN))

         const moduleDeclId = normalizeImport(sourceModuleId)
         output.write(`declare module '${options.prefix}${moduleDeclId}' {${eol}${indent}`)

         function resolveModuleImport(moduleId: string): string {

            // Resolve module id
            let resolved: string
            if (moduleId.charAt(0) === '.') {
               resolved = normalizeFileName(Path.join(Path.dirname(sourceModuleId), moduleId))
            } else {
               resolved = moduleId
               if (isExternalModule(resolved)) return resolved
            }

            // Apply resolved prefix
            if (!internalsPrefixedMap[resolved]) {
               resolved = `${options.prefix}${normalizeImport(resolved)}`
            }
            return resolved
         }

         const content = processTree(declarationFile, function (node) {
            if (isNodeKindExternalModuleReference(node)) {
               const expression = node.expression as Ts.LiteralExpression
               const resolved: string = resolveModuleImport(expression.text)
               return ` require('${resolved}')`
            }
            else if (node.kind === Ts.SyntaxKind.DeclareKeyword) {
               return ''
            }
            else if (
               isNodeKindStringLiteral(node) && node.parent &&
               (isNodeKindExportDeclaration(node.parent) || isNodeKindImportDeclaration(node.parent) || isNodeKindImportType(node.parent?.parent))
            ) {
               const resolved: string = resolveModuleImport(node.text)
               if (resolved) {
                  return ` '${resolved}'`
               }
            }
         })

         const chunks = content.replaceAll("\r", "").split("\n").map(c => c.trimEnd())
         while (chunks.length > 0 && chunks[chunks.length - 1] === "") chunks.pop()
         output.write(chunks.join(eol + indent) + eol)
         output.write('}' + eol + eol)
      }

      output.end()
   })
}