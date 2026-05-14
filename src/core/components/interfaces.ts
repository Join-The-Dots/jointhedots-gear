import { z } from "zod"
import type { ComponentEntry } from "./manifold.ts"

export type InterfaceImport = {
   type: string
   location?: string
   identifier?: string
} & {
   [attribute: string]: any
}

export type InterfaceLink = z.infer<typeof InterfaceLinkSchema>

export type InterfaceReference = InterfaceLink | InterfaceImport

export const InterfaceLinkSchema = z.string().describe(``)

const interface_loaders: Record<string, IInterfaceLoader> = {}

export interface IInterfaceLoader {
   readonly type: string
   load_interface(entry: InterfaceImport, component: ComponentEntry): Promise<any>
}

export function addInterfaceLoader(provider: IInterfaceLoader) {
   interface_loaders[provider.type] = provider
}

export async function loadInterface(ref: InterfaceReference, component: ComponentEntry) {
   const entry = parseInterfaceImport(ref)
   const loader = interface_loaders[entry.type]
   if (!loader) {
      throw new Error(`No interface loader for '${entry.type}' interop: ${JSON.stringify(entry)}`)
   }
   return loader.load_interface(entry, component)
}

export function parseInterfaceImport(ref: InterfaceReference): InterfaceImport {
   if (typeof ref === "string") {
      let [base, fragment] = ref.split("#", 2)
      let [type, location] = base.split("!", 2)
      ref = { type, location }
      if (fragment) {
         const [identifier, query] = fragment.split("?", 2)
         ref.identifier = identifier
         if (query) {
            for (const kv of query.split("&")) {
               const [k, v] = kv.split("=")
               ref[k] = v === undefined ? true : v
            }
         }
      }
   }
   if (typeof ref.type !== "string" || typeof ref.location !== "string") {
      throw new Error("Invalid interface reference: " + JSON.stringify(ref))
   }
   return ref
}
