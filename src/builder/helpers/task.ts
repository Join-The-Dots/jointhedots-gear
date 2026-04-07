import type { BuildTarget } from "../build-target.ts"

export abstract class BuildTask {
   constructor(readonly target: BuildTarget) { }
   get log() { return this.target.log }
   async init(): Promise<void> { }
   abstract execute(): Promise<void>
}
