import { isNormalizedName, makeNormalizedName, NameStyle } from "../utils/normalized-name.ts"

export type JSONSchema = any

export type ResourceEntry<ResourceInterface = any> = ResourceLink<ResourceInterface> | {
   type: ResourceLink<ResourceFactory<ResourceInterface>>
   data?: any
}

export type ResourceFactory<ResourceInterface = any> = (data: any) => Promise<ResourceInterface>

export type ResourceLink<ResourceInterface = any> = string

export type ComponentID = string
export type BundleID = ComponentID

export type ComponentSpec = {
   "view"?: {
      properties: Record<string, JSONSchema>
   }
   "component"?: {
      services: string[]
      attributes: Record<string, JSONSchema>
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
   specs?: Record<string, ComponentSpec>
   data?: any // Reserved to component derived from a driver component
   resources?: Record<string, ResourceEntry> // Resources catalog with undefined interface
   services?: Record<string, ResourceEntry> // Resources providing specific services interfaces
}

export type BundleManifest = ComponentManifest & {
   type: "bundle"
   baseline: string
   namespaces?: string[]
   dependencies?: BundleID[]
   exports: { [id: string]: string }
   components: { [id: ComponentID]: ComponentPublication }
   catalogs: { [id: ComponentCatalogID]: string }
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
      return new Error(`Component shall have '$id' at: ${path}`)
   }
   if (!isNormalizedName(manif.$id)) {
      return new Error(`Component have invalid '$id=${manif.$id}' suggest '${makeNormalizedName(manif.$id, NameStyle.OBJECT)}' at: ${path}`)
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
