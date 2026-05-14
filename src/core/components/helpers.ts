import { type ComponentManifest, type ComponentPublication, type IComponentProvider } from "./components.ts"
import { acquireComponent, ComponentEntry } from "./manifold.ts"
import type { ComponentFilter } from "./publisher.ts"
import { isNormalizedName, makeNormalizedName, NameStyle } from "../../utils/normalized-name.ts"

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
      title: manif.title || manif.$id,
      services: manif.apis ? Object.keys(manif.apis) : [],
      description: manif.description || "",
      keywords: manif.keywords,
      tags: manif.tags,
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
   async load_component(component: ComponentEntry): Promise<boolean> {
      for (const provider of this.providers) {
         if (await provider.load_component(component)) return true
      }
      return false
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
