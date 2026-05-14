import { type ComponentManifest, type ComponentPublication } from "@jointhedots/gear/core"

//-------------------------------------------------------------
// Component provider interfaces
//-------------------------------------------------------------

export interface IComponentPublisher {
   search_component_publications(filter: ComponentFilter): Promise<ComponentPublication[]>
   get_component_publication(component_id: string): Promise<ComponentPublication>
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
