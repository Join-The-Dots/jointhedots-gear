import Path from 'node:path'
import { CommandModule } from "yargs"
import { publish_aws_s3 } from '../publish/publish_aws_s3.js'
import { open_workspace } from "../model/workspace.js"

export function command_publish(): CommandModule<any, {
   app?: string
   bucket?: string
   region?: string
   dist?: string
}> {
   return {
      command: 'publish',
      describe: 'publish resources to AWS S3',
      builder: (yargs) => yargs
         .option("app", {
            type: "string",
            required: true,
         })
         .option("bucket", {
            type: "string",
            required: true,
         })
         .option("region", {
            type: "string",
            default: "eu-north-1",
         })
         .option("dist", {
            type: "string",
            default: "./dist",
         }),
      handler: async (argv) => {
         const outputDir = Path.resolve(argv.dist)
         const ws = await open_workspace(".", false)
         await publish_aws_s3(argv.app, ws, argv.bucket, argv.region, outputDir)
      }
   }
}
