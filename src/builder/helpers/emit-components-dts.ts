import { join } from "node:path"
import { makeComponentPublication, type ComponentManifest, type ComponentPublication } from "../../workspace/component.ts"
import type { Bundle } from "../../workspace/workspace.ts"
import { BuildTarget } from "../build-target.ts"
import { BuildTask } from "./task.ts"
import MIME from "mime"

export class ComponentsDtsTask extends BuildTask {
   constructor(readonly target: BuildTarget, readonly bundle: Bundle) {
      super(target)
   }
   async execute() {
      const { target, bundle } = this
      const tx = this.target.edit()
      const chunks = []

      // Emit static components manifest
      for (const manif of target.components.values()) {
         chunks.push("\n")
         generate_component_apis(manif, chunks)
         chunks.push("\n")
      }

      // Emit bundle manifest
      const dts = chunks.join("")
      await tx.commitFile(`components.d.ts`, dts)
      //console.log(dts)
   }
}

function generate_component_apis(manif: ComponentManifest, chunks: string[]) {
   for (const service in manif.apis) {
      const generator = components_dts_generators[service]
      if (generator) {
         generator(manif, chunks)
      }
   }
}

function generate_view_react(manif: ComponentManifest, chunks: string[]) {
   const props = manif.specs?.view?.properties
   chunks.push(`declare module 'view.react:${manif.$id}' {\n`)
   chunks.push(`  import type { ReactComponentType, ReactComponentDescriptor } from "@jointhedots/core/interfaces/react"\n`)
   if (props && Object.keys(props).length > 0) {
      chunks.push(`  export type Props = {\n`)
      for (const key of Object.keys(props)) {
         chunks.push(`    ${key}?: any\n`)
      }
      chunks.push(`  }\n`)
      chunks.push(`  export type Component = ReactComponentType<Props>\n`)
   } else {
      chunks.push(`  export type Component = ReactComponentType\n`)
   }
   chunks.push(`  export type Descriptor = ReactComponentDescriptor\n`)
   chunks.push(`}\n`)
}

function generate_commands(manif: ComponentManifest, chunks: string[]) {
   chunks.push(`declare module 'commands:${manif.$id}' {\n`)
   chunks.push(`  import type { CommandsService, Cmdlet } from "@jointhedots/core/interfaces/commands"\n`)
   chunks.push(`  export type Service = CommandsService\n`)
   chunks.push(`}\n`)
}

type ComponentDTSGenerator = (manif: ComponentManifest, chunks: string[]) => void

const components_dts_generators: Record<string, ComponentDTSGenerator> = {
   "view.react": generate_view_react,
   "commands": generate_commands,
}