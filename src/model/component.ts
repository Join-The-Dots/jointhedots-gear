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

export type ComponentManifest<Data extends any = unknown> = {
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
   data?: Data // Reserved to component derived from a driver component
   resources?: Record<string, ResourceEntry> // Resources catalog with undefined interface
   services?: Record<string, ResourceEntry> // Resources providing specific services interfaces
}

/** Configuration for a distributed package */
export interface DistributedConfig {
   /** Version specifier (e.g., "*", "^18.0.0") */
   version?: string
   /** Interop type: 'esm' | 'cjs-default' | 'cjs-named' */
   interop?: 'esm' | 'cjs-default' | 'cjs-named'
   /** List of named exports to re-export (required for cjs-named interop) */
   exports?: string[]
}

export type BundleManifest = ComponentManifest<{
   // Bundle alias (name that can help to connect it to library name)
   alias?: string
   // Bundle library/package origin
   package?: string
   // Bundle baseline (major version)
   baseline?: string

   // Bundle namespace (allow to enrich an public components namespace)
   namespaces?: string[]
   // Bundle dependencies
   dependencies?: string[]

   // Package redistribued by this bundle (force dependents bundle to use these package distribuable instead of bundling them)
   // > Used for shared library, ex: react, react-dom / or huge one, ex: @material/mui, ...
   distribueds?: {
      [packageName: string]: string | DistributedConfig
   }

   // Bundle exports content
   exports?: { [id: string]: string }

   // Bundle components catalog
   components?: ComponentPublication[]
}>

export interface ComponentPublication {

   // Identity
   id: ComponentID // Component id
   ref?: string // Component manifest reference
   type?: string // Component manifest type

   // Presentation
   title: string
   icon?: string
   description?: string

   // Features
   services?: string[]
   keywords?: string[]
   tags?: string[]
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
   return {
      id: manif.$id,
      type: manif.type,
      icon: manif.icon,
      title: manif.title || manif.name || manif.$id,
      services: manif.services ? Object.keys(manif.services) : [],
      description: manif.description || "",
      keywords: manif.keywords,
      tags: manif.tags,
   }
}
