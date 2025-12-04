import * as Glob from 'glob'
import Os from 'os'
import Path from 'path'
import Ts from 'typescript'
import { BuildTarget, BuildTask } from './build-target.js'
import { Library } from '../model/workspace.js'
import { file } from '../utils/file.js'

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

function getTSConfig(fileName: string, compilerOptions: Ts.CompilerOptions | string): [string[], Ts.CompilerOptions] {
   let configObject: any

   if (typeof compilerOptions === 'string') {
      const result = Ts.parseConfigFileTextToJson("tsconfig.json", compilerOptions)
      if (result.error) {
         throw getError([result.error])
      }
      configObject = result.config
      configObject.include = undefined
   } else {
      configObject = {
         compilerOptions: compilerOptions,
         include: undefined
      }
   }

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

class TypescriptProject {
   public readonly baseDir: string
   public readonly files: string[]
   public readonly compilerOptions: Ts.CompilerOptions
   public readonly host: Ts.CompilerHost
   public readonly program: Ts.Program
   public readonly filenames: string[]

   constructor(baseDir: string, compilerOptions: Ts.CompilerOptions | string, outDir?: string) {
      this.baseDir = Path.resolve(baseDir)

      const [files, resolvedCompilerOptions] = getTSConfig(baseDir, compilerOptions)

      resolvedCompilerOptions.declaration = true
      resolvedCompilerOptions.target = resolvedCompilerOptions.target || Ts.ScriptTarget.Latest
      resolvedCompilerOptions.moduleResolution = resolvedCompilerOptions.moduleResolution || Ts.ModuleResolutionKind.Bundler
      resolvedCompilerOptions.outDir = resolvedCompilerOptions.outDir || outDir

      this.files = files
      this.compilerOptions = resolvedCompilerOptions
      this.filenames = getFilenames(this.baseDir, files)
      this.host = Ts.createCompilerHost(resolvedCompilerOptions)
      this.program = Ts.createProgram(this.filenames, resolvedCompilerOptions, this.host)
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

export function createTypescriptProject(baseDir: string, compilerOptions: Ts.CompilerOptions | string, outDir?: string): TypescriptProject {
   return new TypescriptProject(baseDir, compilerOptions, outDir)
}

export function generateTypescriptDefinition(options: {
   project: TypescriptProject
   exclude?: string[]
   externs?: string[]
   types?: string[]
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
   const internalsMap: { [shortname: string]: boolean } = {}
   const internalsPrefixedMap: { [shortname: string]: boolean } = {}
   project.getSourceFiles().some(function (sourceFile) {
      if (sourceFile.fileName.indexOf(normalizedBaseDir) !== 0) return
      if (excludesMap[sourceFile.fileName]) return

      const shortName = sourceFile.fileName.slice(normalizedBaseDir.length)
      const shortNameNoExt = shortName.slice(0, -Path.extname(sourceFile.fileName).length)
      const strippedShortName = stripBaseUrlPrefix(shortName)
      const strippedShortNameNoExt = stripBaseUrlPrefix(shortNameNoExt)
      internalsMap[shortName] = true
      internalsMap[shortNameNoExt] = true
      internalsMap[strippedShortName] = true
      internalsMap[strippedShortNameNoExt] = true
      internalsPrefixedMap[`${options.prefix}/${shortName}`] = true
      internalsPrefixedMap[`${options.prefix}/${shortNameNoExt}`] = true
      internalsPrefixedMap[`${options.prefix}/${strippedShortName}`] = true
      internalsPrefixedMap[`${options.prefix}/${strippedShortNameNoExt}`] = true
      sourcesMap[sourceFile.fileName] = true
   })

   // Generate source files
   project.getSourceFiles().some(function (sourceFile) {
      if (!sourcesMap[sourceFile.fileName]) return

      // Source file is already a declaration file so should does not need to be pre-processed by the emitter
      if (isDtsFilename(sourceFile.fileName)) {
         writeDeclaration(sourceFile, false)
         return
      }

      const emitOutput = project.emit(sourceFile, writeFile)
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

   function writeFile(filename: string, data: string) {
      if (isDtsFilename(filename)) {
         const declFile = Ts.createSourceFile(filename, data, project.compilerOptions.target, true)
         writeDeclaration(declFile, true)
      }
   }

   function writeDeclaration(declarationFile: Ts.SourceFile, isOutput: boolean) {

      // resolving is important for dealting with relative outDirs
      const filename = Path.resolve(declarationFile.fileName)

      // use the outDir here, not the baseDir, because the declarationFiles are outputs of the build process
      const outputDir = (isOutput && Boolean(outDir)) ? Path.resolve(outDir) : baseDir
      const rawSourceModuleId = normalizeFileName(filename.slice(outputDir.length + 1, -DTSLEN))
      const sourceModuleId = stripBaseUrlPrefix(rawSourceModuleId)

      const moduleDeclId = normalizeImport(sourceModuleId)
      outputContent += `declare module '${options.prefix}${moduleDeclId}' {${eol}${indent}`

      function resolveModuleImport(moduleId: string): string {

         // Resolve module id
         let resolved: string
         if (moduleId.charAt(0) === '.') {
            resolved = normalizeFileName(Path.join(Path.dirname(rawSourceModuleId), moduleId))
            resolved = stripBaseUrlPrefix(resolved)
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

               // Check if resolved file is within our project (internal module)
               if (resolvedFileName.startsWith(normalizedBaseDir)) {
                  // Convert absolute path to relative module id
                  const ext = Path.extname(resolvedFileName)
                  resolved = resolvedFileName.slice(normalizedBaseDir.length, -ext.length)
                  // Strip baseUrl prefix from the resolved path
                  resolved = stripBaseUrlPrefix(resolved)
               } else {
                  // External module - return as-is
                  return moduleId
               }
            } else {
               resolved = moduleId
               if (isExternalModule(resolved)) return resolved
            }
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
      outputContent += chunks.join(eol + indent) + eol
      outputContent += '}' + eol + eol
   }

   return {
      dts: outputContent,
      diagnostics,
   }
}

export function printDiagnostics(diagnostics: Ts.Diagnostic[]) {
   if (diagnostics && diagnostics.length > 0) {
      for (const diagnostic of diagnostics) {
         const message = typeof diagnostic.messageText === 'string'
            ? diagnostic.messageText
            : diagnostic.messageText.messageText

         if (diagnostic.file && diagnostic.start !== undefined) {
            const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
            const fileName = diagnostic.file.fileName
            console.error(`${fileName}(${line + 1},${character + 1}): error TS${diagnostic.code}: ${message}`)
         } else {
            console.error(`error TS${diagnostic.code}: ${message}`)
         }
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

         const project = createTypescriptProject(lib.path, configText, storage.baseDir)

         const { dts, diagnostics } = await generateTypescriptDefinition({
            project,
            prefix: lib.name,
            exclude: ["node_modules/**/*"],
         })
         file.write.text(storage.baseDir + "/types.d.ts", dts)

         printDiagnostics(diagnostics)
      }
      catch (e) {
         console.error("! no 'type.d.ts' will be generated for the package:", e.message)
         console.error(e)
      }

   }
}
