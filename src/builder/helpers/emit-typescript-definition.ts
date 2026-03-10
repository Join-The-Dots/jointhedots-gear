import Fs from 'fs'
import Os from 'os'
import Path from 'path'
import Ts from 'typescript'
import { execFileSync } from 'child_process'
import { BuildTask } from "./task.ts"
import { BuildTarget } from '../build-target.ts'
import { Library } from '../../model/workspace.ts'
import { file } from '../../utils/file.ts'
import { create_export_map, type ExportEntries } from '../../model/helpers/create-manifests.ts'

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
   public readonly compilerOptions: Ts.CompilerOptions
   public readonly dtsDir: string

   constructor(baseDir: string, tsconfig: string, outDir?: string) {
      this.baseDir = Path.resolve(baseDir)

      const { config, error } = Ts.parseConfigFileTextToJson("tsconfig.json", tsconfig)
      if (error) throw getError([error])

      const configParsed = Ts.parseJsonConfigFileContent(config, Ts.sys, baseDir)
      if (configParsed.errors?.length) throw getError(configParsed.errors)

      const compilerOptions = configParsed.options
      compilerOptions.outDir = compilerOptions.outDir || outDir
      this.compilerOptions = compilerOptions

      // Create a temp directory for tsgo to emit .d.ts into
      this.dtsDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'gear-dts-'))
   }

   /** Run tsgo to emit .d.ts files into dtsDir. Returns stderr output. */
   public emitWithTsgo(): string {
      const tsgoPath = Path.resolve('node_modules/.bin/tsgo')
      const args = [
         '-p', Path.join(this.baseDir, 'tsconfig.json'),
         '--declaration',
         '--emitDeclarationOnly',
         '--skipLibCheck',
         '--outDir', this.dtsDir,
      ]
      try {
         execFileSync(tsgoPath, args, {
            cwd: this.baseDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120_000,
            shell: true,
         })
         return ''
      } catch (e: any) {
         // tsgo may exit non-zero on type errors but still emit .d.ts files
         return e.stderr?.toString() || e.message || ''
      }
   }

   /** Recursively collect all .d.ts files emitted by tsgo */
   public getEmittedDtsFiles(): string[] {
      const results: string[] = []
      function walk(dir: string) {
         for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
            const full = Path.join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (isDtsFilename(entry.name)) results.push(full)
         }
      }
      if (Fs.existsSync(this.dtsDir)) walk(this.dtsDir)
      return results
   }

   /** Clean up temp directory */
   public cleanup() {
      try { Fs.rmSync(this.dtsDir, { recursive: true, force: true }) } catch { }
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
   exports: ExportEntries
   includes?: string[]
   prefix?: string
}): {
   dts: string,
} {
   const project = options.project

   const baseDir = project.baseDir
   const dtsDir = project.dtsDir

   function isExcludedPath(fileName: string): boolean {
      return fileName.includes('/node_modules/') || fileName.includes('\\node_modules\\')
   }

   // Compute baseUrl prefix to strip from module paths
   const normalizedBaseDir = normalizeFileName(Path.resolve(baseDir)) + "/"
   const normalizedDtsDir = normalizeFileName(Path.resolve(dtsDir)) + "/"
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

   const outputParts: string[] = []

   if (options.externs) {
      options.externs.forEach(function (path: string) {
         outputParts.push(`/// <reference path="${path}" />` + eol)
      })
   }

   if (options.types) {
      options.types.forEach(function (type: string) {
         outputParts.push(`/// <reference types="${type}" />` + eol)
      })
   }

   // Map source-relative paths to internal: module IDs for ALL emitted files
   const internalsMap: { [shortname: string]: string } = {}

   const dtsFiles = project.getEmittedDtsFiles()
   for (const dtsPath of dtsFiles) {
      const normalizedDts = normalizeFileName(Path.resolve(dtsPath))
      if (!normalizedDts.startsWith(normalizedDtsDir)) continue

      const relativeDts = normalizedDts.slice(normalizedDtsDir.length)
      const relativeSource = relativeDts.replace(/\.d\.ts$/, '')
      const strippedSource = stripBaseUrlPrefix(relativeSource)

      const moduleId = `${options.prefix}:${strippedSource}`
      internalsMap[relativeSource] = moduleId
      internalsMap[strippedSource] = moduleId
      if (strippedSource.endsWith('/index')) {
         internalsMap[strippedSource.slice(0, -6)] = moduleId
      }
   }

   // Build public export map: maps export entry ID to internal module ID
   const publicReexports: { id: string, internalId: string }[] = []

   if (options.exports) {
      for (const entry of Object.values(options.exports)) {
         const fileName = entry.source
         if (isExcludedPath(fileName)) continue

         const normalizedSource = normalizeFileName(Path.resolve(fileName))
         if (!normalizedSource.startsWith(normalizedBaseDir)) continue

         const shortName = normalizedSource.slice(normalizedBaseDir.length)
         const shortNameNoExt = shortName.replace(/\.(ts|tsx|js|jsx)$/, '')
         const strippedShortNameNoExt = stripBaseUrlPrefix(shortNameNoExt)

         const internalId =
            internalsMap[shortNameNoExt] ||
            internalsMap[strippedShortNameNoExt] ||
            internalsMap[shortName]

         if (internalId) {
            publicReexports.push({ id: entry.id, internalId })
         }
      }
   }

   // Unified module ID normalization
   function normalizeModuleId(moduleId: string): string {
      moduleId = moduleId.replace(/\.(d\.ts|ts|tsx|js|jsx)$/, '')
      moduleId = stripBaseUrlPrefix(moduleId)

      const remapped =
         internalsMap[moduleId] ||
         internalsMap[moduleId + "/index"] ||
         internalsMap[moduleId + "/index.ts"]

      return remapped || moduleId
   }

   function isExternalModule(moduleId: string): boolean {
      return !internalsMap[moduleId]
   }

   // Process each emitted .d.ts file as internal: module
   for (const dtsPath of dtsFiles) {
      const normalizedDts = normalizeFileName(Path.resolve(dtsPath))
      if (!normalizedDts.startsWith(normalizedDtsDir)) continue

      const relativeDts = normalizedDts.slice(normalizedDtsDir.length)
      const relativeSource = relativeDts.replace(/\.d\.ts$/, '')

      const data = Fs.readFileSync(dtsPath, 'utf-8')
      const declFile = Ts.createSourceFile(dtsPath, data, Ts.ScriptTarget.Latest, true)

      writeDeclaration(declFile, relativeSource)
   }

   // Emit public re-export modules
   for (const { id, internalId } of publicReexports) {
      outputParts.push(`declare module '${id}' {${eol}`)
      outputParts.push(`${indent}export * from '${internalId}';${eol}`)
      outputParts.push(`}${eol}${eol}`)
   }

   function writeDeclaration(declarationFile: Ts.SourceFile, rawSourceModuleId: string) {
      const moduleDeclId = normalizeModuleId(rawSourceModuleId)
      outputParts.push(`declare module '${moduleDeclId}' {${eol}${indent}`)

      function resolveModuleImport(moduleId: string): string {
         let resolved: string
         if (moduleId.charAt(0) === '.') {
            resolved = normalizeFileName(Path.join(Path.dirname(rawSourceModuleId), moduleId))
         } else {
            resolved = moduleId
            if (isExternalModule(resolved)) return resolved
         }

         return normalizeModuleId(resolved)
      }

      const content = processTree(declarationFile, function (node) {
         if (isNodeKindExternalModuleReference(node)) {
            const expression = node.expression as Ts.LiteralExpression
            const resolved: string = resolveModuleImport(expression.text)
            return ` require('${resolved}')`
         }
         else if (isNodeKindImportDeclaration(node) && !node.importClause) {
            return ''
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
      outputParts.push(chunks.join(eol + indent) + eol)
      outputParts.push('}' + eol + eol)
   }

   return {
      dts: outputParts.join(''),
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

         const stderr = project.emitWithTsgo()
         if (stderr) {
            this.log.warn(stderr)
         }

         const { dts } = generateTypescriptDefinition({
            project,
            prefix: lib.name,
            exclude: ["node_modules/**/*"],
            exports: create_export_map(lib, lib.bundle),
         })
         file.write.text(storage.getBaseDirFS() + "/types.d.ts", dts)

         project.cleanup()
      }
      catch (e) {
         this.log.error("no 'type.d.ts' will be generated for the package:" + e.message)
      }

   }
}
