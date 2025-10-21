import { MapLike } from "../utils/helpers"

export type JSONSchema = any

export type ResourceEntry<ResourceInterface = any> = ResourceLink<ResourceInterface> | {
   type: ResourceLink<ResourceFactory<ResourceInterface>>
   data?: any
}

export type ResourceFactory<ResourceInterface = any> = (data: any) => Promise<ResourceInterface>

export type ResourceLink<ResourceInterface = any> = string

export type ComponentID = string

export type ComponentSpec = {
   "view"?: {
      properties: MapLike<JSONSchema>
   }
   "component"?: {
      services: string[]
      attributes: MapLike<JSONSchema>
   }
   [customSpec: string]: any
}

export type ComponentManifest = {
   $id: string
   type?: string
   name?: string
   icon?: string
   title?: string
   tags?: string[]
   keywords?: string[]
   description?: string
   selectors?: string[]
   specs?: MapLike<ComponentSpec>
   resources?: MapLike<ResourceEntry> // Resources catalog with undefined interface
   services?: MapLike<ResourceEntry> // Resources providing specific services interfaces
}

export interface ComponentPublication {
   component_id: ComponentID
   type?: string
   icon: string
   title: string
   services?: string[]
   description?: string
   keywords?: string[]
   tags?: string[]
}

export type ComponentCatalogID = string // Identifier of catalog

export type ComponentCatalogsDescriptor = {
   name: string
   baseline: string
   components: { [id: ComponentID]: string }
   catalogs: { [id: ComponentCatalogID]: string }
}

export function checkComponentManifest(manif: ComponentManifest, path: string): Error {
   if (typeof manif.$id !== "string") {
      return new Error(`Component descriptor shall have '$id' at: ${path}`)
   }
   if (!isValidComponentName(manif.$id)) {
      return new Error(`Component descriptor have invalid '$id' -> '${manif.$id}' at: ${path}`)
   }
   return null
}

export function makeComponentPublication(manif: ComponentManifest): ComponentPublication {
   const id = manif.$id
   return {
      component_id: id,
      type: manif.type,
      icon: manif.icon,
      title: manif.title || manif.name || id,
      services: manif.services ? Object.keys(manif.services) : [],
      description: manif.description || "",
      keywords: manif.keywords,
      tags: manif.tags,
   }
}

const check_name_regex = /^(?![xX][mM][lL])[a-z](([.0-9_a-z\-]*-[.0-9_a-z\-]*)|([.0-9_a-z:]*:[.0-9_a-z:]*))$/

export function isValidComponentName(name) {
   return check_name_regex.test(name)
}
