import Path from "node:path"
import FS from "node:fs"
import ChildProcess from "node:child_process"
import { BuildTask } from "./task.ts"
import type { BuildTarget } from "../builders/target.ts"

export class ArtifactNpmTask extends BuildTask {
   constructor(target: BuildTarget, readonly outputDir: string) {
      super(target)
   }
   async execute() {
      const sourceDir = this.target.storage.getBaseDirFS()
      FS.mkdirSync(this.outputDir, { recursive: true })
      this.log.info(`📦 npm pack → ${this.outputDir}`)
      ChildProcess.execSync("npm pack --pack-destination " + JSON.stringify(this.outputDir), { cwd: sourceDir })
   }
}

export class ArtifactZipTask extends BuildTask {
   constructor(target: BuildTarget, readonly outputDir: string, readonly name: string) {
      super(target)
   }
   async execute() {
      const sourceDir = this.target.storage.getBaseDirFS()
      FS.mkdirSync(this.outputDir, { recursive: true })
      const outPath = Path.join(this.outputDir, `${this.name}.zip`)
      this.log.info(`📦 zip → ${outPath}`)
      const parent = Path.dirname(sourceDir)
      const base = Path.basename(sourceDir)
      if (process.platform === 'win32') {
         ChildProcess.execSync(
            `powershell -NoProfile -Command "Compress-Archive -Path '${base}\\*' -DestinationPath '${outPath}' -Force"`,
            { cwd: parent }
         )
      } else {
         ChildProcess.execSync(`zip -r ${JSON.stringify(outPath)} ${JSON.stringify(base)}`, { cwd: parent })
      }
   }
}
