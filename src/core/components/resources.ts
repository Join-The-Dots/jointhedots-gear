import { URI } from "vscode-uri"
import { ResourcePart, ResourceProviderService, type IResourceNode, type IResourceProvider, type ResourcePath } from "../interfaces/resources/interface.ts"
import { acquireComponent } from "./manifold.ts"

function getResourcePathFromURI(uri: URI): ResourcePath {
   return uri.path.split("/")
}

async function getResourceProviderFromURI(uri: URI): Promise<IResourceProvider> {
   const comp = acquireComponent(uri.scheme)
   return ResourceProviderService.fetch(comp)
}

export async function loadResource(location: URI | string, what?: ResourcePart): Promise<IResourceNode> {
   const uri = typeof location === "string" ? URI.parse(location) : location
   const provider = await getResourceProviderFromURI(uri)
   const res = await provider.load([getResourcePathFromURI(uri)], what)
   return res[0]
}

export async function loadResourceData(location: URI | string): Promise<Blob> {
   const res = await loadResource(location, ResourcePart.Data)
   return res.data
}

export async function storeResourceData(location: URI | string, content: Blob): Promise<boolean> {
   const uri = typeof location === "string" ? URI.parse(location) : location
   const provider = await getResourceProviderFromURI(uri)
   return provider.store([{
      path: getResourcePathFromURI(uri),
      data: content,
   }])
}
