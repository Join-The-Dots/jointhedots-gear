import { URI, Utils } from "vscode-uri"
import { type ComponentFilter, type ComponentManifest, type ComponentPublication, ComponentControllerKey, type IContentProvider, type IResourceLoader, type IComponentProvider } from "./components.ts"
import { Log, queryLogInfos, queryLogObjects, type QueryLogResult } from "../logging/mod.ts"
import { parseResourceEntry } from "./helpers.ts"

export type ComponentErrorManifest = ComponentManifest & {
   type: "<error>"
   message: string
   stack?: string
}

export type ComponentServiceGetter<Service = any> = (entry: ComponentEntry) => Service

// Component registry entry
export class ComponentEntry<Instance extends Object = any> {
   protected __instance__?: Instance = undefined
   manifest?: ComponentManifest = undefined
   constructor(
      readonly id: string,
   ) {
   }
   get title(): string {
      return this.id
   }
   get namespace(): string {
      const sep = this.id.indexOf(":")
      switch (sep) {
         case -1:
            return "std"
         case 0:
            return ""
         default:
            return this.id.slice(0, sep)
      }
   }
   get valid(): boolean {
      return this.manifest !== undefined && this.manifest.type !== "<error>"
   }
   get loaded(): boolean {
      return this.manifest !== undefined
   }
   get installed(): boolean {
      return this.__instance__ !== undefined
   }
   get instance(): Instance {
      return this.__instance__
   }
   set instance(value: Instance) {
      this.__instance__ = value
      if (value instanceof Object) {
         ComponentsRegistry.datamap.set(value, this)
      }
      else if (value !== null) {
         this.__instance__ = null
         throw new Error(`Component instance shall be an object`)
      }
   }
   get<Manifest extends ComponentManifest = ComponentManifest>(): Manifest {
      if (this.manifest === undefined) {
         throw new Error(`Cannot get manifest of not loaded module`)
      }
      return this.manifest as Manifest
   }
   set<Manifest extends ComponentManifest = ComponentManifest>(manifest: Manifest) {
      this.manifest = manifest
      return this
   }
   fetch<Manifest extends ComponentManifest = ComponentManifest>(): Promise<Manifest> {
      let loading = ComponentsRegistry.loadings.get(this)
      if (loading) return loading

      if (this.manifest === undefined) {
         loading = ComponentsRegistry.components_provider.get_component_manifest(this.id).then(async (manifest) => {
            if (manifest) {
               if (manifest.type) {
                  await acquireComponent(manifest.type).fetch()
               }
               this.manifest = manifest
            }
            else throw new Error(`Component '${this.id}' not found`)
            return this.manifest
         }).catch((e) => {
            Log.error(e, this)
            this.set<ComponentErrorManifest>({
               $id: this.id,
               type: "<error>",
               message: e.message,
               stack: e.stack,
            })
            this.__instance__ = new Error(e.message) as any
            return this.manifest
         })
      }
      else {
         loading = Promise.resolve(this.manifest)
      }

      ComponentsRegistry.loadings.set(this, loading)
      return loading
   }
   async install(): Promise<ComponentEntry> {
      let installing = ComponentsRegistry.installings.get(this)
      if (installing) return installing

      if (this.instance === undefined) {
         this.instance = null
         installing = new Promise(async (resolve) => {
            try {
               if (this.loaded === false) {
                  await this.fetch()
               }

               const type = this.manifest?.type
               if (type) {
                  const entry = acquireComponent(type)
                  const controller = await ComponentControllerKey.fetch(entry)
                  await controller.createComponent(this, this.manifest)
               }
            }
            catch (e) {
               Log.error(e, this)
            }
            resolve(this)
         })
      }
      else {
         installing = Promise.resolve(this)
      }

      ComponentsRegistry.installings.set(this, installing)
      return installing
   }
   acquireResource(identifier: string): ComponentResource {
      const ref = `${this.id}#${identifier}`
      let rc = ComponentsRegistry.resources.get(ref)
      if (!rc) {
         rc = new ComponentResource(this, identifier)
         ComponentsRegistry.resources.set(ref, rc)
      }
      return rc
   }
   getResource(identifier: string): ComponentResource {
      if (this.hasResource(identifier)) {
         return this.acquireResource(identifier)
      }
      return null
   }
   hasResource(identifier: string): boolean {
      const { manifest } = this
      if (manifest?.apis?.[identifier]) {
         return true
      }
      else if (manifest?.type) {
         const type = acquireComponent(manifest.type)
         if (type) {
            return type?.hasResource(`component.${identifier}`)
         }
      }
      return false
   }
   async getResourceAsync(identifier: string): Promise<ComponentResource> {
      if (this.manifest === undefined) await this.fetch()
      return this.getResource(identifier)
   }
   async fetchResource<T = any>(identifier: string): Promise<T> {
      if (this.manifest === undefined) await this.fetch()
      return this.getResource(identifier)?.fetch<T>()
   }
   getLogStats() {
      return queryLogInfos(this.id)
   }
   getLogs(count: number): QueryLogResult {
      return queryLogObjects(count, this.id)
   }
}

// Component resource
export class ComponentResource {
   entry: any = undefined
   identifier: string = undefined
   constructor(
      readonly component: ComponentEntry,
      readonly resource: string,
   ) {
      component.fetch()
   }
   get valid(): boolean {
      return this.identifier !== undefined && this.component.valid
   }
   get loaded(): boolean {
      return this.identifier !== undefined
   }
   async fetch<T = any>(): Promise<T> {
      if (this.identifier === undefined) {
         let loading = ComponentsRegistry.loadings.get(this)
         if (loading) return loading

         loading = new Promise(async (resolve) => {
            const { component } = this
            try {
               // Fetch manifest with resource catalog
               if (component.installed === false) {
                  await component.install()
               }

               // Fetch resource data
               const { manifest } = component
               const entry = parseResourceEntry(manifest.apis?.[this.resource])
               const type = entry?.type
               if (type === "module") {
                  this.entry = await ComponentsRegistry.resources_loader.load_resource(entry.location)
                  this.identifier = entry.identifier
               }
               /*else if (type === "api.rest") {
                  this.entry = __import_RESTService(entry as RESTServiceImport, component)
                  this.identifier = null
               }*/
               else if (manifest.type) {
                  const controller = acquireComponent(manifest.type)
                  const resource = controller.getResource(`component.${this.resource}`)
                  if (resource) {
                     const getter = await resource.fetch<ComponentServiceGetter>()
                     if (getter) this.entry = await getter(this.component)
                     else this.entry = null
                     this.identifier = null
                  }
                  else {
                     throw new Error(`Cannot provide resource '${this.resource}'`)
                  }
               }
               else {
                  throw new Error(`Cannot load resource '${this.resource}': ${JSON.stringify(entry)}`)
               }
               const entrypoint = this.get()
               if (entrypoint instanceof Object) {
                  ComponentsRegistry.datamap.set(entrypoint, this)
               }
            }
            catch (e) {
               console.error(`Cannot install service api '${this.resource}' of '${component.id}':`, e)
               this.entry = null
               this.identifier = null
            }
            resolve(this.get())
            ComponentsRegistry.loadings.set(this, null)
         })

         ComponentsRegistry.loadings.set(this, loading)
         return loading
      }
      else {
         return this.get()
      }
   }
   get<T = any>(): T {
      if (this.entry) {
         if (this.identifier !== null) {
            return this.entry?.[this.identifier]
         }
         else {
            return this.entry
         }
      }
      return undefined
   }
   set(data: any) {
      this.entry = data
      this.identifier = null
   }
   get spec() {
      const norm = this.resource.split(".")[0]
      return this.component.manifest?.specs?.[norm]
   }
   get url(): string {
      const ref = this.component.manifest?.apis?.[this.resource]
      if (typeof ref === "string") {
         const base = URI.parse(window.location.href).with({ fragment: null })
         const uri = Utils.joinPath(base, "..", ref.split("#")[0])
         return uri.toString()
      }
      return null
   }
}

export type ComponentsListener = (target: ComponentEntry) => void

export class ComponentsManifold {
   components = new Map<string, ComponentEntry>()
   resources = new Map<string, ComponentResource>()
   datamap = new WeakMap<any, ComponentResource | ComponentEntry>()

   loadings = new Map<any, Promise<any>>()
   installings = new Map<any, Promise<ComponentEntry>>()
   listeners = new Set<ComponentsListener>()

   components_provider: IComponentProvider = null
   resources_loader: IResourceLoader = null
   content_provider: IContentProvider = null

   constructor() {
      /*this.content_provider = new StaticContentProvider()
      this.components_provider.add_provider(new StaticComponentProvider(this.content_provider))
      this.components_provider.add_provider(createLocalComponentProvider())
      this.resources_loader = new CommonResourceProvider(this.content_provider)*/
   }
   listen(l: ComponentsListener) {
      this.listeners.add(l)
      return l
   }
   unlisten(l: ComponentsListener) {
      this.listeners.delete(l)
   }
   notifyError(subject: ComponentEntry, error: Error) {

   }
}

export const ComponentsRegistry = new ComponentsManifold()

acquireComponent("<error>").set({
   $id: "<error>",
   icon: "bi:house",
   title: "Define invalid component",
})

export function getDefaultComponent() {
   return acquireComponent("log:application")
}

export function getComponentFromData(data: any, is_static?: boolean): ComponentEntry {
   if (data instanceof Object) {
      const target = ComponentsRegistry.datamap.get(data) || data
      if (target instanceof ComponentEntry) {
         return target
      }
      if (target instanceof ComponentResource) {
         return target.component
      }
      if (!is_static && data["getComponent"] instanceof Function) {
         return getComponentFromData(data["getComponent"](), true)
      }
   }
   return getDefaultComponent()
}

export function acquireComponent(id: string): ComponentEntry {
   let obj = ComponentsRegistry.components.get(id) as ComponentEntry
   if (!obj && typeof id === "string") {
      obj = new ComponentEntry(id)
      ComponentsRegistry.components.set(id, obj)
   }
   return obj
}

export function acquireFutureComponent(manifest: ComponentManifest): ComponentEntry {
   const id = manifest.$id
   let obj = ComponentsRegistry.components.get(id) as ComponentEntry
   if (!obj && typeof id === "string") {
      obj = new ComponentEntry(id)
      obj.manifest = manifest
      obj.instance = null
      ComponentsRegistry.components.set(id, obj)
   }
   return obj
}

export function acquireResource(ref: string): ComponentResource {
   const parts = ref.split("#")
   if (parts.length === 2) {
      const entry = acquireComponent(parts[0])
      return entry?.acquireResource(parts[1])
   }
   return null
}

export function resolveRelativeComponent(ref: string, from: ComponentEntry): ComponentEntry {
   if (from && ref.startsWith("/")) {
      return acquireComponent(`${from?.id}${ref}`)
   }
   return null
}

export async function saveComponentManifest(manifest: ComponentManifest) {
   const component = acquireComponent(manifest.$id)
   ComponentsRegistry.loadings.delete(component)
   component.manifest = manifest
   return saveComponent(component)
}

export async function saveComponent(component: ComponentEntry) {
   console.log("[Update Component]", component.id)
   const manifest = await component.fetch()
   const provider = ComponentsRegistry.components_provider
   await provider.add_component(manifest)

   if (component.loaded) {
      if (manifest.type && component.installed) {
         const controller = await ComponentControllerKey.fetch(acquireComponent(manifest.type))
         if (controller) {
            if (component.instance) {
               await controller.updateComponent(component, manifest)
            }
            else {
               component["__instance__"] = undefined
               await controller.createComponent(component, manifest)
            }
         }
         if (component.instance instanceof Object) {
            ComponentsRegistry.datamap.set(component.instance, component)
         }
         ComponentsRegistry.listeners.forEach(l => l(component))
      }
   }

   return component
}

export async function deleteComponent(id: string) {
   console.log("deleteComponent", id)
   const provider = ComponentsRegistry.components_provider
   if (await provider.delete_component(id)) {
      unregisterComponent(id)
   }
}

export function unregisterComponent(id: string) {
   const component = ComponentsRegistry.components.get(id)
   if (component) {
      component.set<ComponentErrorManifest>({
         $id: component.id,
         type: "<error>",
         message: `Component deleted`,
      })
      ComponentsRegistry.listeners.forEach(l => l(component))
      ComponentsRegistry.components.delete(id)
   }
}

export async function searchComponentsPublications(filter: ComponentFilter): Promise<ComponentPublication[]> {
   return ComponentsRegistry.components_provider.search_component_publications(filter)
}

export async function fetchComponentsPublications(components_ids: string[]): Promise<ComponentPublication[]> {
   const results: ComponentPublication[] = []
   for (const id of components_ids) {
      const cnx = await ComponentsRegistry.components_provider.get_component_publication(id)
      if (cnx) {
         results.push(cnx)
      }
      else {
         results.push(failedComponentPublication(id))
      }
   }
   return results
}

export function failedComponentPublication(id: string, title?: string): ComponentPublication {
   return {
      id: id,
      title: title ? title : "! Not found: " + id,
   }
}
