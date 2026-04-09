import { URI } from "vscode-uri"
import { type ComponentManifest, type ComponentPublication } from "./components.ts"
import { acquireComponent } from "./manifold.ts"
import type { ResourceEntry, ResourceImport } from "../schema/schema.ts"
import type { ComponentFilter } from "./provider.ts"

export function parseComponentURI(ref: string): URI {
   if (ref.startsWith("./")) {
      const base = URI.parse(window.location.href)
      const parts = base.path.split("/")
      parts[parts.length - 1] = ref.slice(2)
      return base.with({ path: parts.join("/"), query: "", fragment: "" })
   }
   else if (ref.startsWith("/")) {
      return URI.parse(window.location.href).with({ path: ref, query: "", fragment: "" })
   }
   else {
      return URI.parse(ref)
   }
}

export async function getComponentServicesList(manif: ComponentManifest): Promise<string[]> {
   const services = manif.apis ? Object.keys(manif.apis) : []
   if (manif.type) {
      const controller = await acquireComponent(manif.type)?.fetch()
      if (controller) {
         for (const key in controller?.apis) {
            if (key.startsWith("component.")) {
               const name = key.slice(10)
               if (!services.includes(name)) services.push(name)
            }
         }
      }
      else {
         throw new Error("Cannot create publiction properly")
      }
   }
   return services
}

export async function createComponentPublication(manif: ComponentManifest): Promise<ComponentPublication> {
   const { $id } = manif
   return {
      id: $id,
      type: manif.type,
      icon: manif.icon,
      title: manif.title || $id,
      description: manif.description || "",
      keywords: manif.keywords,
      tags: manif.tags,
      services: await getComponentServicesList(manif),
   }
}

export function parseResourceEntry(entry: ResourceEntry): ResourceImport {
   if (typeof entry === "string") {
      let [location, fragment] = entry.split("#", 2)

      // Make resource data
      const result: ResourceImport = { type: "module", location }
      if (fragment) {
         const [identifier, query] = fragment.split("?", 2)
         result.identifier = identifier
         if (query) {
            for (const kv of query.split("&")) {
               const [k, v] = kv.split("=")
               result[k] = v === undefined ? true : v
            }
         }
      }
      return result
   }
   return entry as ResourceImport
}
