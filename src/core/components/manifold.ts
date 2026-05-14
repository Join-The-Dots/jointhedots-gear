import { URI, Utils } from "vscode-uri"
import { type ComponentManifest, type ComponentPublication, type IComponentProvider, ComponentControllerKey } from "./components.ts"
import { Log, queryLogInfos, queryLogObjects, type QueryLogResult } from "../logging/mod.ts"
import { ComponentProviderHub } from "./helpers.ts"
import { type ComponentFilter } from "./publisher.ts"
import { loadInterface, parseInterfaceImport } from "./interfaces.ts"

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
   origin?: string // URI from where the component is located
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
         datamap.set(value, this)
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
   set<Manifest extends ComponentManifest = ComponentManifest>(manifest: Manifest, origin?: string) {
      this.manifest = manifest
      this.origin = origin ?? this.origin
      return this
   }
   fetch<Manifest extends ComponentManifest = ComponentManifest>(): Promise<Manifest> {
      let loading = loadings.get(this)
      if (loading) return loading

      if (this.manifest === undefined) {
         loading = components_provider.load_component(this).then(async (found) => {
            if (found) {
               if (this.manifest.type) {
                  await acquireComponent(this.manifest.type).fetch()
               }
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

      loadings.set(this, loading)
      return loading
   }
   async install(): Promise<ComponentEntry> {
      let installing = installings.get(this)
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

      installings.set(this, installing)
      return installing
   }
   acquireInterface(identifier: string): ComponentInterface {
      const ref = `${this.id}#${identifier}`
      let rc = resources.get(ref)
      if (!rc) {
         rc = new ComponentInterface(this, identifier)
         resources.set(ref, rc)
      }
      return rc
   }
   getInterface(identifier: string): ComponentInterface {
      if (this.hasInterface(identifier)) {
         return this.acquireInterface(identifier)
      }
      return null
   }
   hasInterface(identifier: string): boolean {
      const { manifest } = this
      if (manifest?.apis?.[identifier]) {
         return true
      }
      else if (manifest?.type) {
         const type = acquireComponent(manifest.type)
         if (type) {
            return type?.hasInterface(`component.${identifier}`)
         }
      }
      return false
   }
   async getInterfaceAsync(identifier: string): Promise<ComponentInterface> {
      if (this.manifest === undefined) await this.fetch()
      return this.getInterface(identifier)
   }
   async fetchInterface<T = any>(identifier: string): Promise<T> {
      if (this.manifest === undefined) await this.fetch()
      return this.getInterface(identifier)?.fetch<T>()
   }
   getLogStats() {
      return queryLogInfos(this.id)
   }
   getLogs(count: number): QueryLogResult {
      return queryLogObjects(count, this.id)
   }
}

// Component interface
export class ComponentInterface {
   entry: any = undefined
   constructor(
      readonly component: ComponentEntry,
      readonly identifier: string,
   ) {
      component.fetch()
   }
   get valid(): boolean {
      return this.entry !== undefined && this.component.valid
   }
   get loaded(): boolean {
      return this.entry !== undefined
   }
   async fetch<T = any>(): Promise<T> {
      if (this.entry === undefined) {
         let loading = loadings.get(this)
         if (loading) return loading

         loading = new Promise(async (resolve) => {
            const { component } = this
            try {

               // Fetch manifest with resource catalog
               if (component.installed === false) {
                  await component.install()
               }

               // Fetch resource data
               this.entry = await loadComponentInterface(component, this.identifier)
               if (this.entry instanceof Object) {
                  datamap.set(this.entry, this)
               }
            }
            catch (e) {
               console.error(`Cannot install service api '${this.identifier}' of '${component.id}':`, e)
               this.entry = null
            }
            resolve(this.get())
            loadings.set(this, null)
         })

         loadings.set(this, loading)
         return loading
      }
      else {
         return this.get()
      }
   }
   get<T = any>(): T {
      return this.entry
   }
   set(data: any) {
      this.entry = data
   }
   get spec() {
      const norm = this.identifier.split(".")[0]
      return this.component.manifest?.specs?.[norm]
   }
   get url(): string {
      const ref = this.component.manifest?.apis?.[this.identifier]
      const href = globalThis?.location?.href
      if (!href) return null
      if (typeof ref === "string") {
         const base = URI.parse(href).with({ fragment: null })
         const uri = Utils.joinPath(base, "..", ref.split("#")[0])
         return uri.toString()
      }
      if (ref && typeof ref === "object" && typeof ref["location"] === "string") {
         const base = URI.parse(href).with({ fragment: null })
         const uri = Utils.joinPath(base, "..", ref["location"])
         return uri.toString()
      }
      return null
   }
}

const components = new Map<string, ComponentEntry>()
const resources = new Map<string, ComponentInterface>()
const datamap = new WeakMap<any, ComponentInterface | ComponentEntry>()

const loadings = new Map<any, Promise<any>>()
const installings = new Map<any, Promise<ComponentEntry>>()
const listeners = new Set<ComponentsListener>()

const components_provider = new ComponentProviderHub()

acquireComponent("<error>").set({
   $id: "<error>",
   icon: "bi:house",
   title: "Define invalid component",
})

export type ComponentsListener = (target: ComponentEntry) => void

export function listenComponents(l: ComponentsListener) {
   listeners.add(l)
   return l
}

export function unlistenComponents(l: ComponentsListener) {
   listeners.delete(l)
}

export function notifyError(subject: ComponentEntry, error: Error) {

}

export function addComponentProvider(provider: IComponentProvider) {
   components_provider.add_provider(provider)
}

export function getDefaultComponent() {
   return acquireComponent("log:application")
}

export function getComponentFromData(data: any, is_static?: boolean): ComponentEntry {
   if (data instanceof Object) {
      const target = datamap.get(data) || data
      if (target instanceof ComponentEntry) {
         return target
      }
      if (target instanceof ComponentInterface) {
         return target.component
      }
      if (!is_static && data["getComponent"] instanceof Function) {
         return getComponentFromData(data["getComponent"](), true)
      }
   }
   return getDefaultComponent()
}

export function acquireComponent(id: string): ComponentEntry {
   let obj = components.get(id) as ComponentEntry
   if (!obj && typeof id === "string") {
      obj = new ComponentEntry(id)
      components.set(id, obj)
   }
   return obj
}

export function acquireFutureComponent(manifest: ComponentManifest): ComponentEntry {
   const id = manifest.$id
   let obj = components.get(id) as ComponentEntry
   if (!obj && typeof id === "string") {
      obj = new ComponentEntry(id)
      obj.manifest = manifest
      obj.instance = null
      components.set(id, obj)
   }
   return obj
}

export function setupComponent(manif: ComponentManifest, apis: Record<string, any>) {
   const comp = acquireComponent(manif.$id).set(manif)
   manif.apis = manif.apis ?? {}
   for (const api in apis) {
      manif.apis[api] = { type: "internal" }
      comp.acquireInterface(api).set(apis[api])
   }
   return comp
}

export function acquireResource(ref: string): ComponentInterface {
   const parts = ref.split("#")
   if (parts.length === 2) {
      const entry = acquireComponent(parts[0])
      return entry?.acquireInterface(parts[1])
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
   loadings.delete(component)
   component.manifest = manifest
   return saveComponent(component)
}

export async function saveComponent(component: ComponentEntry) {
   console.log("[Update Component]", component.id)
   const manifest = await component.fetch()

   const provider = components_provider
   if (!provider) throw new Error(`No component provider`)
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
            datamap.set(component.instance, component)
         }
         listeners.forEach(l => l(component))
      }
   }

   return component
}

export async function deleteComponent(id: string) {
   console.log("deleteComponent", id)
   const provider = components_provider
   if (!provider) throw new Error(`No component provider`)
   if (await provider.delete_component(id)) {
      unregisterComponent(id)
   }
}

export function unregisterComponent(id: string) {
   const component = components.get(id)
   if (component) {
      component.set<ComponentErrorManifest>({
         $id: component.id,
         type: "<error>",
         message: `Component deleted`,
      })
      listeners.forEach(l => l(component))
      components.delete(id)
   }
}

export async function searchComponentsPublications(filter: ComponentFilter): Promise<ComponentPublication[]> {
   const provider = components_provider
   if (!provider) throw new Error(`No component provider`)
   return provider.search_component_publications(filter)
}

export async function fetchComponentsPublications(components_ids: string[]): Promise<ComponentPublication[]> {
   const results: ComponentPublication[] = []
   const provider = components_provider
   if (!provider) throw new Error(`No component provider`)
   for (const id of components_ids) {
      const cnx = await provider.get_component_publication(id)
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

async function loadComponentInterface(component: ComponentEntry, identifier: string) {
   const api = component.manifest.apis?.[identifier]
   if (api) {
      return loadInterface(api, component)
   }
   else {
      const { manifest } = component
      if (manifest?.type) {
         const controller = acquireComponent(manifest.type)
         const resource = controller.getInterface(`component.${identifier}`)
         if (resource) {
            const getter = await resource.fetch<ComponentServiceGetter>()
            if (getter) return getter(component)
         }
         else {
            throw new Error(`Component '${manifest?.type}' cannot provide resource '${identifier}'`)
         }
      }
      else {
         throw new Error(`Cannot load resource '${identifier}' from singleton component`)
      }
   }
   return null
}
