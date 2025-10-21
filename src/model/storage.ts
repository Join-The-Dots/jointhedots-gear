import * as esbuild from 'esbuild'
import Fsp from "node:fs/promises"
import Fs from 'node:fs'
import Crypto from 'node:crypto'
import Path from 'node:path'
import MIME from 'mime'
import { IStorageStream } from './workspace'

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
   return "CID." + hash + ext
}

export class StorageFiles implements IStorageStream {
   files = new Map<string, esbuild.OutputFile>()
   on_changes = new SourceEventEmitter()
   baseDir: string = ""
   constructor(public name: string, baseDir: string) {
      this.baseDir = Path.resolve(baseDir)
   }
   begin(cleanup: boolean) {
      if (cleanup) removeDirectory(this.baseDir)
   }
   commitContent(contentData: Uint8Array | string, contentType?: string): string {
      const key = createContentKey(contentData, contentType)
      this.commitFile(key, contentData, contentType)
      return key
   }
   commitFile(key: string, contentData: Uint8Array | string, contentType?: string) {
      const fpath = Path.join(this.baseDir, key)
      Fs.mkdirSync(Path.dirname(fpath), { recursive: true })
      Fs.writeFileSync(fpath, contentData)
   }
   end() {
   }
   route(): (req, res) => void {
      return (req, res) => {
         const fpath = Path.resolve(Path.join(this.baseDir, req.path))
         const file = this.files.get(fpath)
         res.setHeader("Content-Type", MIME.getType(req.path))
         if (file) {
            res.send(Buffer.from(file.contents))
         }
         else {
            res.sendFile(fpath, (err) => { if (err) res.status(404).send(err.message) })
         }
      }
   }
}

export function copyToStorageStream(storage: IStorageStream, key: string, path: string, contentType?: string) {
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
