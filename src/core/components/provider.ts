import { type ComponentManifest, type ComponentPublication } from "@jointhedots/gear/core"
import { URI } from "vscode-uri"

export type ContentType = string

//-------------------------------------------------------------
// Component provider interfaces
//-------------------------------------------------------------

export interface IResourceLoader {
   load_resource(uri: string): Promise<any>
}

export interface IComponentPublisher {
   search_component_publications(filter: ComponentFilter): Promise<ComponentPublication[]>
   get_component_publication(component_id: string): Promise<ComponentPublication>
}

export interface IComponentProvider extends IComponentPublisher {
   get_component_manifest(component_id: string): Promise<ComponentManifest>
   set_component_manifest(component_id: string, manifest: ComponentManifest): Promise<boolean>
   add_component(manifest: ComponentManifest): Promise<ComponentPublication>
   delete_component(component_id: string): Promise<boolean>
}

export interface IContentProvider {
   check_content(uri: URI): Promise<ContentType>
   load_content(uri: URI): Promise<Blob>
   store_content(uri: URI, content: Blob): Promise<boolean>
}

//-------------------------------------------------------------
// Component filter
//-------------------------------------------------------------

export type ComponentFilter = {
   query: string
   pattern: RegExp
   keywords: string[]
   tags: string[]
   types: string[]
   services: string[]
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

//-------------------------------------------------------------
// Component providers hub
//-------------------------------------------------------------

export class ComponentProviderHub implements IComponentProvider {
   constructor(readonly providers: IComponentProvider[] = []) {
   }
   add_provider(provider: IComponentProvider) {
      this.providers.push(provider)
   }
   async get_component_publication(id: string): Promise<ComponentPublication> {
      for (const provider of this.providers) {
         const found = await provider.get_component_publication(id)
         if (found) return found
      }
      return null
   }
   async search_component_publications(filter: ComponentFilter): Promise<ComponentPublication[]> {
      const result = []
      for (const provider of this.providers) {
         const founds = await provider.search_component_publications(filter)
         if (founds) result.push(...founds)
      }
      return result
   }
   async get_component_manifest(id: string): Promise<ComponentManifest> {
      for (const provider of this.providers) {
         const founds = await provider.get_component_manifest(id)
         if (founds) return founds
      }
      return null
   }
   async set_component_manifest(component_id: string, manifest: ComponentManifest): Promise<boolean> {
      for (const provider of this.providers) {
         const done = await provider.set_component_manifest(component_id, manifest)
         if (done) return true
      }
      return false
   }
   async add_component(manifest: ComponentManifest): Promise<ComponentPublication> {
      for (const provider of this.providers) {
         const done = await provider.add_component(manifest)
         if (done) return done
      }
      return null
   }
   async delete_component(component_id: string): Promise<boolean> {
      for (const provider of this.providers) {
         const done = await provider.delete_component(component_id)
         if (done) return true
      }
      return false
   }
}