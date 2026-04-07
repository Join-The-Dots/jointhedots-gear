import Fs from "node:fs"
import Path from "node:path"
import * as AWS from "@aws-sdk/client-s3"
import MIME from "mime"
import { StorageFiles } from "../workspace/storage.ts"
import { build_application } from "../builder/build-application.ts"
import { Workspace } from "../workspace/workspace.ts"

export type WebFile = {
   key: string
   media: string
   data: string | Buffer
}

export async function publish_aws_s3(
   appname: string,
   ws: Workspace,
   bucket: string,
   region: string,
   outputDir: string
) {
   const storage = new StorageFiles(ws.name, outputDir)
   const app = ws.get_application(appname)
   if (!app) throw new Error(`Application '${appname}' not exists`)

   console.time("build")
   await build_application({
      app,
      storage,
      version: "aws_s3",
      devmode: false,
   })
   console.timeEnd("build")

   console.time("load-files")
   const files: WebFile[] = []
   await collectFilesFromDirectory(outputDir, "", files)
   console.timeEnd("load-files")
   console.log(files.reduce((acc, x) => acc + x.data.length, 0) / (1034 * 1024), "Mi")
   console.log(files.length, "files")

   console.time("upload-aws-s3")
   const s3 = new AWS.S3({ region: region })
   await emitFilesToAmzS3(s3, bucket, files)
   console.time("upload-aws-s3")
}

async function collectFilesFromDirectory(path: string, key: string, files: WebFile[]) {
   for (const fname of Fs.readdirSync(path)) {
      const fpath = Path.join(path, fname)
      const fkey = key ? `${key}/${fname}` : fname
      const fstat = Fs.statSync(fpath)
      if (fstat.isFile()) {
         files.push({
            key: fkey,
            data: Fs.readFileSync(fpath),
            media: MIME.getType(fpath) as string,
         })
      }
      else if (fstat.isDirectory()) {
         await collectFilesFromDirectory(fpath, fkey, files)
      }
   }
}

async function emitFilesToAmzS3(s3: AWS.S3, bucketS3: string, files: WebFile[]) {

   const heads = await Promise.all(files.map((item) => {
      return s3.headObject({
         Bucket: bucketS3,
         Key: item.key,
      }).then(res => res.Metadata, err => null)
   }))

   await Promise.all(files.map(async (item, i) => {
      const head = heads[i]
      await s3.putObject({
         Bucket: bucketS3,
         ACL: "public-read",
         Key: item.key,
         ContentType: item.media,
         Body: item.data,
      })
   }))
}
