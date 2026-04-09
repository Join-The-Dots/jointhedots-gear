import type { DocumentationSchema, JSONSchema, ResourceEntry } from "../schema/schema.ts"
import type { ComponentEntry } from "./manifold.ts"
import { ServiceAccessor, type ServiceType } from "../services/service-accessor.ts"

//-------------------------------------------------------------
// Component model: distribuable unit providing services
//-------------------------------------------------------------

export type ComponentID = string

// Component publication
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

export type ComponentServiceID = string

// Component manifest
export type ComponentManifest<Data extends any = unknown> = {
   $id: string // Compoenent ID (into publication)
   type?: string // ID of component service to use (into publication)

   // Metadata
   title?: string
   icon?: string
   description?: string
   keywords?: string[] // Keywords helping for user searching (into publication)
   tags?: string[] // Tags for filtering helping (into publication)
   doc?: DocumentationSchema

   // Service Specifications
   specs?: Record<ComponentServiceID, any>

   // Service Interfaces
   apis?: Record<ComponentServiceID, ResourceEntry> // Resources providing specific services interfaces

   // Configuration
   data?: Data
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

//-------------------------------------------------------------
// Component controller: Component manifest entry "component"
//-------------------------------------------------------------

// Component manifest schema
export type ComponentSchema = {
   readonly name: ServiceType
   readonly title: string
   readonly icon: string
   readonly attributes: Record<string, JSONSchema>
}

export interface ComponentManifestIssue {
   level: "error" | "warn" | "info"
   message: string
   fix?(descriptor: ComponentManifest): Promise<ComponentManifest>
}

export interface ComponentChecking {
   fixed?: ComponentManifest
   issues?: ComponentManifestIssue[]
}

// Component service "component"
export interface ComponentController {

   // Component management
   createComponent(component: ComponentEntry, descriptor: ComponentManifest): Promise<void>
   updateComponent(component: ComponentEntry, descriptor: ComponentManifest): Promise<void>

   // Descriptor management
   checkDescriptor(descriptor: ComponentManifest): Promise<ComponentChecking>
}

export const ComponentControllerKey = ServiceAccessor.About<ComponentController, ComponentSchema>("component")
