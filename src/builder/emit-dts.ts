import * as Glob from 'glob'
import Os from 'os'
import Path from 'path'
import Ts from 'typescript'
import { BuildTarget, BuildTask } from './build-target.js'
import { Library, type PackageExport } from '../model/workspace.js'
import { file } from '../utils/file.js'
import type { Log, Message } from '../model/helpers/logger.js'

const eol = Os.EOL
const indent = "    "
const DTSLEN = '.d.ts'.length

function normalizeFileName(filename: string) {
   return filename.replaceAll(Path.sep, "/")
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

function getTSConfig(baseDir: string, tsconfig: string): [string[], Ts.CompilerOptions] {
   const { config, error } = Ts.parseConfigFileTextToJson("tsconfig.json", tsconfig)
   if (error) throw getError([error])

   const configParsed = Ts.parseJsonConfigFileContent(config, Ts.sys, baseDir)
   if (configParsed.errors && configParsed.errors.length) {
      throw getError(configParsed.errors)
   }

   return [
      configParsed.fileNames,
      configParsed.options
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

class TypescriptProject {
   public readonly baseDir: string
   public readonly files: string[]
   public readonly compilerOptions: Ts.CompilerOptions
   public readonly host: Ts.CompilerHost
   public readonly program: Ts.Program
   public readonly filenames: string[]

   constructor(baseDir: string, tsconfig: string, outDir?: string) {
      this.baseDir = Path.resolve(baseDir)

      const [files, compilerOptions] = getTSConfig(baseDir, tsconfig)

      compilerOptions.declaration = true
      compilerOptions.emitDeclarationOnly = true
      compilerOptions.noEmit = false
      compilerOptions.target = compilerOptions.target || Ts.ScriptTarget.Latest
      compilerOptions.moduleResolution = compilerOptions.moduleResolution || Ts.ModuleResolutionKind.Bundler
      compilerOptions.outDir = compilerOptions.outDir || outDir

      this.files = files
      this.compilerOptions = compilerOptions
      this.filenames = getFilenames(this.baseDir, files)
      this.host = Ts.createCompilerHost(compilerOptions)
      this.program = Ts.createProgram(this.filenames, compilerOptions, this.host)
   }

   public getSourceFiles(): readonly Ts.SourceFile[] {
      return this.program.getSourceFiles()
   }

   public emit(sourceFile?: Ts.SourceFile, writeFile?: Ts.WriteFileCallback): Ts.EmitResult {
      return this.program.emit(sourceFile, writeFile)
   }

   public getSemanticDiagnostics(sourceFile?: Ts.SourceFile): readonly Ts.Diagnostic[] {
      return this.program.getSemanticDiagnostics(sourceFile)
   }

   public getSyntacticDiagnostics(sourceFile?: Ts.SourceFile): readonly Ts.Diagnostic[] {
      return this.program.getSyntacticDiagnostics(sourceFile)
   }

   public getDeclarationDiagnostics(sourceFile?: Ts.SourceFile): readonly Ts.Diagnostic[] {
      return this.program.getDeclarationDiagnostics(sourceFile)
   }
}

export function createTypescriptProject(baseDir: string, tsconfig: string, outDir?: string): TypescriptProject {
   return new TypescriptProject(baseDir, tsconfig, outDir)
}

export function generateTypescriptDefinition(options: {
   project: TypescriptProject
   exclude: string[]
   externs?: string[]
   types?: string[]
   exports: { [exportId: string]: PackageExport }
   includes?: string[]
   prefix?: string
}): {
   dts: string,
   diagnostics: Ts.Diagnostic[]
} {
   const project = options.project
   const diagnostics: Ts.Diagnostic[] = []

   const baseDir = project.baseDir
   const outDir = project.compilerOptions.outDir
   const excludesMap: { [filename: string]: boolean } = {}

   options.exclude = options.exclude || ['node_modules/**/*']
   options.exclude.forEach(function (filename) {
      Glob.sync(filename, { cwd: baseDir }).forEach(function (globFileName) {
         excludesMap[normalizeFileName(Path.resolve(baseDir, globFileName))] = true
      })
   })

   // Compute baseUrl prefix to strip from module paths
   const normalizedBaseDir = normalizeFileName(Path.resolve(baseDir)) + "/"
   let baseUrlPrefix = ''
   if (project.compilerOptions.baseUrl) {
      const absoluteBaseUrl = Path.resolve(baseDir, project.compilerOptions.baseUrl)
      const normalizedBaseUrl = normalizeFileName(absoluteBaseUrl)
      baseUrlPrefix = normalizedBaseUrl.slice(normalizedBaseDir.length)
      if (baseUrlPrefix && !baseUrlPrefix.endsWith('/')) {
         baseUrlPrefix += '/'
      }
   }

   function stripBaseUrlPrefix(modulePath: string): string {
      if (baseUrlPrefix && modulePath.startsWith(baseUrlPrefix)) {
         return modulePath.slice(baseUrlPrefix.length)
      }
      return modulePath
   }

   let outputContent = ''

   if (options.externs) {
      options.externs.forEach(function (path: string) {
         outputContent += `/// <reference path="${path}" />` + eol
      })
   }

   if (options.types) {
      options.types.forEach(function (type: string) {
         outputContent += `/// <reference types="${type}" />` + eol
      })
   }

   // Filter source files
   const sourcesMap: { [shortname: string]: boolean } = {}
   const internalsMap: { [shortname: string]: string } = {}
   project.getSourceFiles().some(function (sourceFile) {
      if (sourceFile.fileName.indexOf(normalizedBaseDir) !== 0) return
      if (excludesMap[sourceFile.fileName]) return

      const shortName = sourceFile.fileName.slice(normalizedBaseDir.length)
      const shortNameNoExt = shortName.slice(0, -Path.extname(sourceFile.fileName).length)
      const strippedShortName = stripBaseUrlPrefix(shortName)
      const strippedShortNameNoExt = stripBaseUrlPrefix(shortNameNoExt)

      let moduleId = `${options.prefix}/${strippedShortNameNoExt}`
      internalsMap[shortName] = moduleId
      internalsMap[shortNameNoExt] = moduleId
      internalsMap[strippedShortName] = moduleId
      internalsMap[strippedShortNameNoExt] = moduleId
      sourcesMap[sourceFile.fileName] = true
   })

   // Build reverse map from internal paths to export names
   // e.g., "src/Inputs" -> "./Inputs" means internal path "src/Inputs" exports as "prefix/Inputs"
   // Store as [internalPrefix, exportName] pairs for prefix matching
   if (options.exports) {
      for (const [exportPath, value] of Object.entries(options.exports)) {
         const exported = typeof value === 'string' ? value : (value.import || value.default || value.types || '')
         if (!exported) continue

         let exportId = exportPath.replace(/^\.\//, '').replace(/\/$/, '')
         if (exportId === '.') exportId = options.prefix
         else exportId = `${options.prefix}/${exportId}`

         // Normalize internal path: remove leading ./, strip extensions
         const internalPath = normalizeFileName(exported)
         let shortNameNoExt = internalPath.replace(/^\.\//, '').replace(/\.(ts|tsx|js|jsx)$/, '')
         if (shortNameNoExt.endsWith('/index')) shortNameNoExt = shortNameNoExt.slice(0, -6)
         const strippedShortNameNoExt = stripBaseUrlPrefix(shortNameNoExt)

         //this.log.info(shortNameNoExt, "->", exportId)
         //this.log.info(strippedShortNameNoExt, "->", exportId)

         internalsMap[shortNameNoExt] = exportId
         internalsMap[strippedShortNameNoExt] = exportId
      }
   }


   // Unified module ID normalization: strip extensions, baseUrl prefix, and remap to exports
   function normalizeModuleId(moduleId: string): string {

      // Strip .ts, .tsx, .js, .jsx, .d.ts extensions
      moduleId = moduleId.replace(/\.(d\.ts|ts|tsx|js|jsx)$/, '')

      // Strip baseUrl prefix
      moduleId = stripBaseUrlPrefix(moduleId)

      // Strip index suffix
      if (moduleId === "index") {
         return options.prefix
      }
      if (moduleId.endsWith("/index")) {
         moduleId = moduleId.slice(0, -6)
      }
      // Apply resolved prefix
      if (internalsMap[moduleId]) {
         moduleId = internalsMap[moduleId]
      }
      return moduleId
   }

   // Generate source files
   project.getSourceFiles().some(function (sourceFile) {
      if (!sourcesMap[sourceFile.fileName]) return

      // Source file is already a declaration file so should does not need to be pre-processed by the emitter
      if (isDtsFilename(sourceFile.fileName)) {
         writeDeclaration(sourceFile, sourceFile.fileName)
         return
      }

      const emitOutput = project.emit(sourceFile, (filename, data) => writeFile(filename, data, sourceFile.fileName))
      if (emitOutput.emitSkipped || emitOutput.diagnostics.length > 0) {
         diagnostics.push(...emitOutput.diagnostics)
         diagnostics.push(...project.getSemanticDiagnostics(sourceFile))
         diagnostics.push(...project.getSyntacticDiagnostics(sourceFile))
         diagnostics.push(...project.getDeclarationDiagnostics(sourceFile))
      }
   })

   function isExternalModule(moduleId: string): boolean {
      if (!internalsMap[moduleId]) {
         return true
      }
      return false
   }

   function writeFile(filename: string, data: string, sourceFilePath: string) {
      if (isDtsFilename(filename)) {
         const declFile = Ts.createSourceFile(filename, data, project.compilerOptions.target, true)
         writeDeclaration(declFile, sourceFilePath)
      }
   }

   function writeDeclaration(declarationFile: Ts.SourceFile, sourceFilePath: string) {

      // Compute rawSourceModuleId based on the source file path that produced the declaration
      const resolvedSourcePath = Path.resolve(sourceFilePath)
      const sourceExt = Path.extname(resolvedSourcePath)
      const rawSourceModuleId = normalizeFileName(resolvedSourcePath.slice(baseDir.length + 1, -sourceExt.length))

      // Normalize and remap the module ID
      const moduleDeclId = normalizeModuleId(rawSourceModuleId)
      outputContent += `declare module '${moduleDeclId}' {${eol}${indent}`

      function resolveModuleImport(moduleId: string): string {

         // Resolve module id
         let resolved: string
         if (moduleId.charAt(0) === '.') {
            resolved = normalizeFileName(Path.join(Path.dirname(rawSourceModuleId), moduleId))
         } else {
            // Try to resolve using TypeScript's module resolution (handles tsconfig paths)
            const resolveResult = Ts.resolveModuleName(
               moduleId,
               declarationFile.fileName,
               project.compilerOptions,
               project.host
            )

            if (resolveResult.resolvedModule) {
               const resolvedFileName = normalizeFileName(resolveResult.resolvedModule.resolvedFileName)
               if (excludesMap[resolvedFileName]) return moduleId

               // Check if resolved file is within our project (internal module)
               if (resolvedFileName.startsWith(normalizedBaseDir)) {
                  // Convert absolute path to relative module id
                  resolved = resolvedFileName.slice(normalizedBaseDir.length)
               } else {
                  // External module - return as-is
                  return moduleId
               }
            } else {
               resolved = moduleId
               if (isExternalModule(resolved)) return resolved
            }
         }

         // Normalize: strip extensions, baseUrl prefix, and remap to exports
         return normalizeModuleId(resolved)
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
      outputContent += chunks.join(eol + indent) + eol
      outputContent += '}' + eol + eol
   }

   return {
      dts: outputContent,
      diagnostics,
   }
}

export function logDiagnostics(log: Log, diagnostics: Ts.Diagnostic[]) {
   if (diagnostics && diagnostics.length > 0) {
      for (const diagnostic of diagnostics) {
         const text = typeof diagnostic.messageText === 'string'
            ? diagnostic.messageText
            : diagnostic.messageText.messageText

         const message: Message = {
            id: `TS${diagnostic.code}`,
            text,
            detail: diagnostic,
         }

         if (diagnostic.file && diagnostic.start !== undefined) {
            const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
            message.location = {
               file: diagnostic.file.fileName,
               line: line + 1,
               column: character,
               length: diagnostic.length ?? 0,
            }
         }

         log.put('error', message)
      }
   }
}

export class TypescriptDefinitionTask extends BuildTask {

   constructor(
      target: BuildTarget,
      readonly library: Library,
   ) {
      super(target)
   }
   async execute() {
      const lib = this.library
      const { storage } = this.target
      try {
         const configText =
            file.read.text(Path.join(lib.path, "./tsconfig.json"))
            || file.read.text("./tsconfig.json")

         const project = createTypescriptProject(lib.path, configText, storage.getBaseDirFS())

         const { dts, diagnostics } = generateTypescriptDefinition({
            project,
            prefix: lib.name,
            exclude: ["node_modules/**/*"],
            exports: lib.descriptor.exports || {},
         })
         file.write.text(storage.getBaseDirFS() + "/types.d.ts", dts)

         logDiagnostics(this.log, diagnostics)
      }
      catch (e) {
         this.log.error("no 'type.d.ts' will be generated for the package:" + e.message)
      }

   }
}
