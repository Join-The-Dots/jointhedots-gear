import Path from "node:path"
import Fs from "node:fs"
import { fileURLToPath } from "node:url"

export const PackageRootDir = Path.resolve(fileURLToPath(import.meta.url), "../../..")

export const file = {
  exists(path: string): boolean {
    return Fs.existsSync(path) && Fs.lstatSync(path).isFile()
  },
  copy: {
    toFile(src: string, dest: string): string {
      dest = Path.resolve(dest)
      directory.make(Path.dirname(dest))
      Fs.copyFileSync(src, dest)
      return dest
    },
    toDir(src: string, dest: string) {
      dest = Path.resolve(dest, Path.basename(src))
      directory.make(Path.dirname(dest))
      Fs.copyFileSync(src, dest)
      return dest
    }
  },
  move: {
    toFile(src: string, dest: string) {
      dest = Path.resolve(dest)
      directory.make(Path.dirname(dest))
      Fs.copyFileSync(src, dest)
      Fs.unlinkSync(src)
      return dest
    },
    toDir(src: string, dest: string) {
      dest = Path.resolve(dest, Path.basename(src))
      directory.make(Path.dirname(dest))
      Fs.copyFileSync(src, dest)
      Fs.unlinkSync(src)
      return dest
    },
  },
  read: {
    json(path: string) {
      try { return JSON.parse(Fs.readFileSync(path).toString()) }
      catch (e) { return undefined }
    },
    text(path: string) {
      try { return Fs.readFileSync(path).toString() }
      catch (e) { return undefined }
    }
  },
  write: {
    json(path: string, data: any) {
      directory.make(Path.dirname(path))
      Fs.writeFileSync(path, JSON.stringify(data, null, 2))
    },
    text(path: string, data: string) {
      directory.make(Path.dirname(path))
      Fs.writeFileSync(path, Array.isArray(data) ? data.join("\n") : data.toString())
    }
  },
  find: {
    upperDir(base: string, subpath: string) {
      let previous, current = Path.resolve(base)
      do {
        previous = current
        if (Fs.existsSync(Path.join(current, subpath))) return current
        current = Path.dirname(current)
      } while (current != previous)
    }
  },
  remove(path: string) {
    if (Fs.existsSync(path)) {
      Fs.unlinkSync(path)
    }
  },
}

export const directory = {
  exists(path: string): boolean {
    return Fs.existsSync(path) && Fs.lstatSync(path).isDirectory()
  },
  filenames(path: string, recursive?: Boolean): string[] {
    try {
      if (recursive) {

        function* walkSync(dir: string) {
          const files = Fs.readdirSync(dir)

          for (const file of files) {
            const pathToFile = Path.join(dir, file)
            const isDirectory = Fs.statSync(pathToFile).isDirectory()
            if (isDirectory) {
              yield* walkSync(pathToFile)
            } else {
              yield pathToFile
            }
          }
        }

        var _Result = []
        for (const file of walkSync(path)) {
          _Result.push(Path.relative(path, file))
        }
        return _Result
      }
      else return Fs.readdirSync(path) || []
    }
    catch (e) { return [] }
  },
  copy(src: string, dest: string, filter?: (name: string, path: string, stats: Fs.Stats) => boolean) {
    if (directory.exists(src)) {
      for (const name of Fs.readdirSync(src)) {
        const path = Path.join(src, name)
        const stats = Fs.lstatSync(path)
        const destination = Path.join(dest, name)
        if (stats.isDirectory()) {
          directory.copy(path, destination, filter)
        }
        else if (!filter || filter(name, path, stats)) {
          file.copy.toFile(path, destination)
        }
      }
    }
  },
  make(path: string) {
    if (path && !Fs.existsSync(path)) {
      Fs.mkdirSync(path, { recursive: true })
    }
  },
  remove(path: string, onlyInner?: boolean) {
    if (Fs.existsSync(path) && Fs.lstatSync(path).isDirectory()) {
      Fs.readdirSync(path).forEach(function (entry) {
        var entry_path = Path.join(path, entry)
        if (Fs.lstatSync(entry_path).isDirectory()) {
          directory.remove(entry_path)
        }
        else {
          try { file.remove(entry_path) }
          catch (e) { return }
        }
      })
      if (!onlyInner) {
        Fs.rmdirSync(path)
      }
    }
  },
  clean(path: string) {
    if (directory.exists(path)) {
      directory.remove(path, true)
    }
    else {
      directory.make(path)
    }
  },
}

export function make_relative_path(baseDir: string, ...path: string[]): string {
  const relpath = Path.relative(baseDir, Path.resolve(...path)).replace(/\\/g, "/")
  if (relpath.startsWith(".")) return relpath
  else return "./" + relpath
}

export function make_normalized_path(baseDir: string, ...path: string[]): string {
  return Path.resolve(baseDir, ...path).replace(/\\/g, "/")
}

export function make_normalized_dirname(baseDir: string, ...path: string[]): string {
  return Path.dirname(Path.resolve(baseDir, ...path)).replace(/\\/g, "/")
}

export function make_canonical_path(baseDir: string, ...path: string[]): string {
  let targetPath = Path.resolve(baseDir, ...path)
  try {
    const stats = Fs.lstatSync(targetPath)
    if (stats.isSymbolicLink()) {
      targetPath = Fs.readlinkSync(targetPath)
    }
  }
  catch (err) { }
  return make_normalized_path(targetPath)
}

const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json']

/** Resolve a file path with extension probing */
export function resolve_normalized_suffixed_path(baseDir: string, path: string, exts = FILE_EXTENSIONS): string | null {
  const resolved = make_normalized_path(baseDir, path)

  // Check if exact path exists
  if (Fs.existsSync(resolved) && Fs.statSync(resolved).isFile()) {
    return resolved
  }

  // Try with common extensions
  for (const ext of exts) {
    const withExt = resolved + ext
    if (Fs.existsSync(withExt)) return withExt
  }

  // Try index files in directory
  if (Fs.existsSync(resolved) && Fs.statSync(resolved).isDirectory()) {
    for (const ext of exts) {
      const indexPath = make_normalized_path(resolved, `index${ext}`)
      if (Fs.existsSync(indexPath)) return indexPath
    }
  }

  return null
}
