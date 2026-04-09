import Fsp from "node:fs/promises"
import Fs from "node:fs"
import Crypto from "node:crypto"
import Path from "node:path"
import MIME from "mime"
import { directory } from "../utils/file.ts"

export type StorageChanges = { added: string[], updated: string[], changed: boolean }

export interface IStorageTransaction {
   commitContent(contentData: Uint8Array | string, contentType?: string): string
   commitFile(key: string, contentData: Uint8Array | string, contentType?: string)
   accept(): Promise<StorageChanges>
}

export interface IStorageZone {
   clean()
   edit(scratch?: boolean): IStorageTransaction // scratch: means that transaction will be considered as patch on a empty zone 
   branch(path: string): IStorageZone
   getBaseDirFS(): string
}

export class SourceEventEmitter {
   clients: any[] = []
   sendEventsToAll(type: string, data: any) {
      this.clients.forEach(client =>
         client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
      )
   }
   route(): (req, res) => void {
      return (req, res) => {
         res.setHeader('Content-Type', 'text/event-stream')
         res.setHeader('Cache-Control', 'no-cache')
         res.setHeader('Connection', 'keep-alive')
         res.write('retry: 10000\n\n')
         this.clients.push({ id: Date.now(), res })
         req.on('close', () => {
            this.clients = this.clients.filter(client => client.res !== res)
         })
      }
   }
}

export function createContentCID(data: Uint8Array | string): string {
   return Crypto.createHash('sha256').update(data).digest('base64url')
}

export function createContentKey(contentData: Uint8Array | string, contentType?: string): string {
   const hash = createContentCID(contentData)
   const ext = contentType ? "." + MIME.getExtension(contentType) : ""
   return "cid." + hash + ext
}

export type FileCache = Map<string, string> // path -> hash

export class StorageTransaction implements IStorageTransaction {
   private pending = new Map<string, { data: Uint8Array | string, hash: string }>()
   constructor(private baseDir: string, private scratch: boolean, private root: StorageFiles) {
   }
   commitContent(contentData: Uint8Array | string, contentType?: string): string {
      const key = createContentKey(contentData, contentType)
      this.commitFile(key, contentData, contentType)
      return key
   }
   commitFile(key: string, contentData: Uint8Array | string, contentType?: string) {
      const fpath = Path.join(this.baseDir, key)
      const hash = createContentCID(contentData)
      this.pending.set(fpath, { data: contentData, hash })
   }
   async accept(): Promise<StorageChanges> {
      const { root, scratch, baseDir } = this
      await Fsp.mkdir(baseDir, { recursive: true })

      const changes: StorageChanges = { added: [], updated: [], changed: false }
      const pending_writes = [...this.pending].filter(([fpath, { hash }]) => root.cache.get(fpath) !== hash)

      const write_channel = async () => {
         const item = pending_writes.pop()
         if (!item) return

         const [fpath, { data, hash }] = item
         const changelist = root.cache.has(fpath) ? changes.updated : changes.added
         changelist.push(Path.basename(fpath))
         root.cache.set(fpath, hash)

         await Fsp.mkdir(Path.dirname(fpath), { recursive: true })
         await Fsp.writeFile(fpath, data)

         if (pending_writes.length > 0) {
            return write_channel()
         }
      }
      await Promise.all(Array.from({ length: Math.min(100, pending_writes.length) }, () => write_channel()))
      this.pending.clear()
      if (changes.updated.length > 0 || changes.added.length > 0) {
         root.on_changes.sendEventsToAll("change", changes)
      }
      return changes
   }
}

export class SubStorageFiles implements IStorageZone {
   constructor(readonly root: StorageFiles, readonly baseDir: string) {
      directory.make(baseDir)
   }
   getBaseDirFS() {
      return this.baseDir
   }
   clean() {
      directory.clean(this.baseDir)
   }
   edit(scratch?: boolean): IStorageTransaction {
      return new StorageTransaction(this.baseDir, scratch, this.root)
   }
   branch(path: string): IStorageZone {
      return new SubStorageFiles(this.root, Path.join(this.baseDir, path))
   }
}

export class StorageFiles implements IStorageZone {
   cache: FileCache = new Map()
   on_changes = new SourceEventEmitter()
   constructor(public name: string, readonly baseDir: string) {
      directory.make(baseDir)
   }
   getBaseDirFS() {
      return this.baseDir
   }
   clean() {
      directory.clean(this.baseDir)
   }
   edit(scratch?: boolean): IStorageTransaction {
      return new StorageTransaction(this.baseDir, scratch, this)
   }
   branch(path: string): IStorageZone {
      return new SubStorageFiles(this, Path.resolve(this.baseDir, path))
   }
   route(): (req, res) => void {
      return (req, res) => {
         const fpath = Path.resolve(Path.join(this.baseDir, req.path))
         res.setHeader("Content-Type", MIME.getType(req.path))
         res.sendFile(fpath, (err) => { if (err) res.status(404).send(err.message) })
      }
   }
}

export function copyToStorageStream(storage: IStorageTransaction, key: string, path: string, contentType?: string) {
   const fstat = Fs.statSync(path)
   if (fstat.isFile()) {
      storage.commitFile(key, Fs.readFileSync(path), contentType || MIME.getType(path))
   }
   else if (fstat.isDirectory()) {
      for (const fname of Fs.readdirSync(path)) {
         const fpath = Path.join(path, fname)
         const fkey = key ? `${key}/${fname}` : fname
         copyToStorageStream(storage, fkey, fpath, contentType)
      }
   }
}

export function removeFile(path: string) {
   if (Fs.existsSync(path)) {
      Fs.unlinkSync(path)
   }
}

export function removeDirectory(path: string) {
   if (Fs.existsSync(path) && Fs.lstatSync(path).isDirectory()) {
      Fs.readdirSync(path).forEach(function (entry) {
         var entry_path = Path.join(path, entry)
         if (Fs.lstatSync(entry_path).isDirectory()) {
            removeDirectory(entry_path)
         }
         else {
            try { removeFile(entry_path) }
            catch (e) { return }
         }
      })
      Fs.rmdirSync(path)
   }
}

export async function readJsonFile<T = any>(path: string): Promise<T> {
   try {
      return JSON.parse((await Fsp.readFile(path)).toString())
   } catch (e) {
      return undefined
   }
}
