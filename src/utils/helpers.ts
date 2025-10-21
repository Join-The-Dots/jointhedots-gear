import Fs from 'node:fs'
import Path from "node:path"
import Crypto from "node:crypto"
import { fileURLToPath } from 'url'

export const PackageRootDir = Path.resolve(fileURLToPath(import.meta.url), "../../..")

export type MapLike<T> = { [key: string]: T }

export function compute_hashID(identity: string): string {
    const hasher = Crypto.createHash("sha256")
    hasher.write(identity)
    return hasher.digest().toString("base64url")
}

export function make_filename(pattern: string) {
    return pattern.split(/[^a-zA-Z0-9]/).filter(x => x.length > 0).join("_")
}

export function get_data_at(path: string, data: any): any {
    try {
        for (const key of path.split("/")) {
            if (key) data = data[key]
        }
        return data
    }
    catch (e) {
        return undefined
    }
}

export function make_relative_path(baseDir: string, ...path: string[]) {
    const relpath = Path.relative(baseDir, Path.resolve(...path)).replace(/\\/g, "/")
    if (relpath.startsWith(".")) return relpath
    else return "./" + relpath
}
