import Path from "node:path"
import fs from "node:fs"

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
