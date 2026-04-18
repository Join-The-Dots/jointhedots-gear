import Path from "node:path"
import fs from "node:fs"
import Fsp from "node:fs/promises"
import { type PackageDescriptor } from "../workspace.ts"

export type PackageVisitor = (name: string, pkg: PackageDescriptor, pkg_dir: string) => boolean | void

export async function traverse_node_modules_package(
   dir: string,
   seen: Set<string>,
   visitor: PackageVisitor,
): Promise<void> {
   const real = await Fsp.realpath(dir).catch(() => dir)
   if (seen.has(real)) return
   seen.add(real)

   const node_modules = Path.join(dir, "node_modules")
   if (!fs.existsSync(node_modules)) return

   const entries = await Fsp.readdir(node_modules, { withFileTypes: true })
   for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const names: [string, string][] = []
      if (entry.name.startsWith("@")) {
         const scoped = Path.join(node_modules, entry.name)
         const children = await Fsp.readdir(scoped, { withFileTypes: true })
         for (const child of children) {
            names.push([entry.name + "/" + child.name, Path.join(scoped, child.name)])
         }
      } else {
         names.push([entry.name, Path.join(node_modules, entry.name)])
      }
      for (const [name, pkg_dir] of names) {
         const pkg_json = Path.join(pkg_dir, "package.json")
         if (!fs.existsSync(pkg_json)) continue
         const raw = await Fsp.readFile(pkg_json, "utf-8")
         const pkg: PackageDescriptor = JSON.parse(raw)
         if (visitor(name, pkg, pkg_dir) === false) continue
         await traverse_node_modules_package(pkg_dir, seen, visitor)
      }
   }
}

export function resolvePackageVersion(startDir: string): string | undefined {
   let currentDir = Path.resolve(startDir)
   while (true) {
      const packagePath = Path.join(currentDir, "package.json")
      if (fs.existsSync(packagePath)) {
         const raw = fs.readFileSync(packagePath, "utf8")
         const version = JSON.parse(raw)?.version
         if (version && version !== "0.0.0") {
            return version
         }
      }

      const parentDir = Path.dirname(currentDir)
      if (parentDir === currentDir) break
      currentDir = parentDir
   }

   return undefined
}
