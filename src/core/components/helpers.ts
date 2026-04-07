import { URI } from 'vscode-uri'
import { type ComponentFilter, type ComponentManifest, type ComponentPublication } from './components.ts'
import { acquireComponent } from './manifold.ts'
import type { ResourceEntry, ResourceImport } from '../schema/schema.ts'

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

export function createComponentFilter(filter?: Partial<ComponentFilter>): ComponentFilter {
   const result: ComponentFilter = {
      query: filter?.query || "",
      pattern: filter?.pattern || null,
      tags: filter?.tags || [],
      keywords: filter?.keywords || [],
      services: filter?.services || [],
      types: filter?.types || [],
   }
   if (result.query.length > 0) {
      for (const kw of result.query.split(/\s/)) {
         if (kw.length > 0 && !result.keywords.includes(kw)) {
            result.keywords.push(kw)
         }
      }
   }
   if (result.keywords.length > 0) {
      result.pattern = new RegExp(`(${result.keywords.join(").*(")})`)
   }
   return result
}

export function matchComponentFilter(pub: ComponentPublication, filter?: Partial<ComponentFilter>): boolean {
   function match_text(text: string, pattern: RegExp): boolean {
      if (!pattern) {
         return true
      }
      if (text) {
         return !pattern || pattern.test(text)
      }
      return false
   }
   function match_item_in_list(target: string, expecteds: string[]): boolean {
      if (expecteds.length === 0) {
         return true
      }
      if (target && expecteds.includes(target)) {
         return true
      }
      return false
   }
   function match_list_in_list(targets: string[], expecteds: string[]): boolean {
      if (expecteds.length === 0) {
         return true
      }
      if (targets) {
         for (const target of targets) {
            if (expecteds.includes(target)) return true
         }
      }
      return false
   }
   if (!match_text(pub.title || pub.id, filter.pattern) && !match_text(pub.description, filter.pattern)) return false
   if (!match_list_in_list(pub.services, filter.services)) return false
   if (!match_list_in_list(pub.keywords, filter.keywords)) return false
   if (!match_list_in_list(pub.tags, filter.tags)) return false
   if (!match_item_in_list(pub.type, filter.types)) return false
   return true
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
