import Fs from "node:fs"
import Os from "node:os"
import Path from "node:path"
import Ts from "typescript"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { BuildTask } from "./task.ts"
import { BuildTarget } from "../builders/target.ts"
import { Library } from "../workspace.ts"
import { file } from "../../utils/file.ts"
import { create_export_map, type ExportEntries } from "../helpers/create-manifests.ts"

const eol = Os.EOL
const indent = "    "
const DTSLEN = '.d.ts'.length
const EXT_RE = /\.(d\.ts|tsx?|jsx?|mjs|json)$/

function normalizeModuleId(id: string): string {
   return id.replace(EXT_RE, '').replace(/\/index$/, '')
}

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

function hasDefaultExport(sourceFile: Ts.SourceFile): boolean {
   return sourceFile.statements.some(stmt => {
      if (stmt.kind === Ts.SyntaxKind.ExportAssignment) return !(stmt as Ts.ExportAssignment).isExportEquals
      const mods = Ts.canHaveModifiers(stmt) ? Ts.getModifiers(stmt) : undefined
      if (mods?.some(m => m.kind === Ts.SyntaxKind.ExportKeyword) && mods?.some(m => m.kind === Ts.SyntaxKind.DefaultKeyword)) return true
      if (isNodeKindExportDeclaration(stmt) && stmt.exportClause && Ts.isNamedExports(stmt.exportClause)) {
         return stmt.exportClause.elements.some(e => e.name.text === 'default')
      }
      return false
   })
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
   public async emitWithTsgo() {
      const tsgoPath = Path.resolve('node_modules/.bin/tsgo')
      const args = [
         '-p', Path.join(this.baseDir, 'tsconfig.json'),
         '--declaration',
         '--emitDeclarationOnly',
         '--skipLibCheck',
         '--outDir', this.dtsDir,
      ]
      try {
         await promisify(execFile)(tsgoPath, args, {
            cwd: this.baseDir,
            timeout: 120_000,
            shell: true,
         })
      } catch (e: any) {
         // tsgo may exit non-zero on type errors but still emit .d.ts files
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
   prefix: string
}): {
   dts: string,
} {
   const { project, prefix } = options
   const baseDir = project.baseDir
   const normalizedBaseDir = normalizeFileName(Path.resolve(baseDir)) + "/"
   const normalizedDtsDir = normalizeFileName(Path.resolve(project.dtsDir)) + "/"
   const resolveCache = new Map<string, string>()
   const modulesWithDefault = new Set<string>()
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

   // Process each emitted .d.ts file as internal: module
   const dtsFiles = project.getEmittedDtsFiles()
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
   if (options.exports) {
      for (const entry of Object.values(options.exports)) {
         if (!entry.source) continue
         const internalId = resolveInternalModuleImport(entry.source)
         if (internalId.startsWith(prefix)) {
            outputParts.push(`declare module '${entry.id}' {${eol}`)
            outputParts.push(`${indent}export * from '${internalId}';${eol}`)
            if (modulesWithDefault.has(internalId)) {
               outputParts.push(`${indent}export { default } from '${internalId}';${eol}`)
            }
            outputParts.push(`}${eol}${eol}`)
         }
      }
   }

   function resolveInternalModuleImport(moduleId: string, importDir: string = ""): string {
      if (moduleId.charAt(0) === '.') {
         return prefix + normalizeModuleId(normalizeFileName(Path.join(importDir, moduleId)))
      }
      if (resolveCache.has(moduleId)) return resolveCache.get(moduleId)!
      const containingFile = Path.resolve(baseDir, importDir, '__resolve.ts')
      const result = Ts.resolveModuleName(moduleId, containingFile, project.compilerOptions, Ts.sys)
      if (result.resolvedModule && !result.resolvedModule.isExternalLibraryImport) {
         const resolved = normalizeFileName(result.resolvedModule.resolvedFileName)
         if (resolved.startsWith(normalizedBaseDir)) {
            const value = prefix + normalizeModuleId(resolved.slice(normalizedBaseDir.length))
            resolveCache.set(moduleId, value)
            return value
         }
      }
      // Not resolved as internal — keep the original module specifier
      resolveCache.set(moduleId, moduleId)
      return moduleId
   }

   function writeDeclaration(declarationFile: Ts.SourceFile, rawSourceModuleId: string) {
      const moduleDeclId = prefix + normalizeModuleId(rawSourceModuleId)
      const moduleDir = Path.dirname(rawSourceModuleId)
      if (hasDefaultExport(declarationFile)) modulesWithDefault.add(moduleDeclId)
      outputParts.push(`declare module '${moduleDeclId}' {${eol}${indent}`)

      const content = processTree(declarationFile, function (node) {
         if (isNodeKindExternalModuleReference(node)) {
            const expression = node.expression as Ts.LiteralExpression
            const resolved = resolveInternalModuleImport(expression.text, moduleDir)
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
            const resolved = resolveInternalModuleImport(node.text, moduleDir)
            if (resolved !== node.text) {
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

         await project.emitWithTsgo()

         const { dts } = generateTypescriptDefinition({
            project,
            prefix: lib.name + ":",
            exclude: ["node_modules/**/*"],
            exports: create_export_map(lib, lib.master),
         })
         file.write.text(storage.getBaseDirFS() + "/types.d.ts", dts)

         project.cleanup()
      }
      catch (e) {
         this.log.error("no 'type.d.ts' will be generated for the package:" + e.message)
      }

   }
}
