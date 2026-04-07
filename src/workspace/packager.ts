import type { Bundle, Library } from "./workspace.ts"
import ChildProcess from "child_process"

export interface LibraryPackager {
   discover_library(lib: Library): Promise<Bundle>
}

function parseSpecifier(specifier: string): { importPath: string, packageName: string, exportName?: string } {
   let raw = specifier.startsWith("npm:") ? specifier.slice(4) : specifier
   let exportName: string | undefined
   const hashIndex = raw.indexOf("#")
   if (hashIndex >= 0) {
      exportName = raw.slice(hashIndex + 1)
      raw = raw.slice(0, hashIndex)
   }
   let packageName: string
   if (raw.startsWith("@")) {
      const parts = raw.split("/")
      packageName = parts.slice(0, 2).join("/")
   } else {
      packageName = raw.split("/")[0]
   }
   return { importPath: raw, packageName, exportName }
}

const validPackageName = /^(@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*$/

function resolveExport(mod: any, exportName?: string): LibraryPackager {
   if (exportName) {
      if (!(exportName in mod)) {
         throw new Error(`Export '${exportName}' not found in module`)
      }
      return mod[exportName]
   }
   return mod.default ?? mod
}

export async function LoadLibraryPackager(specifier: string): Promise<LibraryPackager> {
   const { importPath, packageName, exportName } = parseSpecifier(specifier)
   try {
      const mod = await import(importPath)
      return resolveExport(mod, exportName)
   } catch {
      if (!validPackageName.test(packageName)) {
         throw new Error(`Invalid package name: ${packageName}`)
      }
      ChildProcess.execSync(`npm install ${packageName}`, { stdio: "inherit" })
      const mod = await import(importPath)
      return resolveExport(mod, exportName)
   }
}
