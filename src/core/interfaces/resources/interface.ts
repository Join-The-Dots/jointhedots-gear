

import { ServiceAccessor } from "../../services/service-accessor.ts"

export enum ResourcePart {
   None = 0,
   Data = 1 << 0,
   Subkeys = 1 << 1,
   Metadata = 1 << 2,
   All = Data | Subkeys | Metadata,
}

export interface IResourceNode {
   readonly type: string       // Resource type
   readonly path: ResourcePath // Access keys to manage the resource
   readonly provider: IResourceProvider

   // Metadata
   readonly time?: number      // Unix Epoch timestamp in milliseconds (Date.now())
   readonly ordinal?: number   // Number used to order resources in their context resource
   readonly tags?: string[]    // Tags used to filter resources
   readonly attributes?: Record<string, string> // Generic attributes 

   // Content
   readonly subkeys?: ResourceKey[]  // Sub resources that provide detailled informations for this resource
   readonly data?: Blob              // Resource data
}

export interface IResourceProvider {
   load(paths: ResourcePath[], what?: ResourcePart): Promise<IResourceNode[]>
   store(updates: ResourceUpdate[]): Promise<boolean>
   select(selector: ResourceSelector): Promise<ResourcePath[]>
   suscribe(opts: ResourceSubscribeOpts): Promise<ResourceUnsuscribe>
}

export type ResourceKey = string

export type ResourcePath = ResourceKey[]

export type ResourceSelector = {
   keys?: ResourcePath[] // keys of cells to return
   paths?: ResourcePath[] // keys of cells path/** where we search
   tags?: string[] // tags of cells where we search
   limit?: number
}

export type ResourceUpdate = {
   path: ResourcePath   // Urn in the memory bank, note: support pattern like 'mycluster/myparent/log_{ordinal}'
   signature?: string   // Provided to check for content change
   attributes?: Record<string, string>
   tags?: string[]      // Tags used to filter resources
   time?: number        // Unix Epoch timestamp in milliseconds (Date.now())
   ordinal?: number | "first" | "last" // Used to define ordering of attached cells
   subkeys?: "reset"    // Reset subkeys
   data?: Blob          // Content to apply
}

export type ResourceSubscribeOpts = {
   receiver: (changeset: ResourceChange[]) => void
   path?: string
   since_date?: number
   batch_size?: number
}

export type ResourceChange = {
   operation: "create" | "delete" | "update"
   path: ResourcePath
   time: number
}

export type ResourceUnsuscribe = () => void

export const ResourceProviderService = ServiceAccessor.About<IResourceProvider, void>("resources")
