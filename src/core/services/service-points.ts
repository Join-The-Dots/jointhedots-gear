import { acquireComponent, listenComponents } from "../components/manifold.ts"
import { type ComponentID } from "../components/components.ts"
import { getSettings, listenSettings, WriteMode } from "./settings.ts"
import { type ILogDispatcher, Log, type LogObject } from "../logging/mod.ts"
import { ServiceAccessor, type ServiceType } from "./service-accessor.ts"

export const ServicePoints: Map<string, ServicePoint> = new Map()

export type ServicePointID = string

export type ServicePointProperties = {
   title?: string
   multiple?: boolean
   alternative?: ServicePointID
}

export type ServicePointSetting = {
   id: ServicePointID
   providers: ComponentID[]
   properties: ServicePointProperties
}

export type ServiceChangeHandler = (service: ServicePoint) => void
const ServiceChangeHandlers = new Set<ServiceChangeHandler>()

export class ServicePoint<IService = unknown> implements ILogDispatcher {
   service: ServiceType = ""
   name: string = ""
   services: IService[] = []
   loading: Promise<IService[]> = null
   ready: boolean = false
   failure: Error = null
   constructor(
      public descriptor: ServicePointSetting,
   ) {
      const [service, name] = descriptor.id.split("/")
      this.service = service
      this.name = name
   }
   get id(): string {
      return this.descriptor.id
   }
   get multiple(): boolean {
      return this.descriptor?.properties?.multiple || false
   }
   async fetch(): Promise<IService[]> {
      if (this.ready) {
         return this.services
      }
      if (!this.loading) {
         this.loading = new Promise(async (resolve) => {
            const { descriptor } = this
            const { providers } = this.descriptor
            const services = await fetchComponentsService<IService>(providers, this.service, this.id, this)
            if (descriptor === this.descriptor) {
               this.services = services
               this.ready = true
               this.loading = null
               resolve(this.services)
            }
            else {
               resolve(this.fetch())
            }
         })
      }
      return this.loading
   }
   async reset(descriptor: ServicePointSetting) {
      if (this.descriptor !== descriptor) {
         this.descriptor = descriptor
         if (this.loading || this.ready || this.failure) {
            this.failure = null
            this.loading = null
            this.ready = false
            ServiceChangeHandlers.forEach(l => l(this))
            await this.fetch()
         }
         ServiceChangeHandlers.forEach(l => l(this))
      }
      return this
   }
   override(providers: ComponentID[]) {
      const settings = getSettings()
      const descriptor = settings.get("service_points", this.id)
      settings.set("service_points", this.id, { ...descriptor, providers }, WriteMode.Temporary)
   }
   notifyError(error: Error) {
      this.failure = error
      Log.error(error)
   }
   notifyObject(object: LogObject) {
      Log.send(object)
   }
}

export function listenServicePoints(handler: ServiceChangeHandler) {
   ServiceChangeHandlers.add(handler)
   return handler
}

export function unlistenServicePoints(handler: ServiceChangeHandler) {
   ServiceChangeHandlers.delete(handler)
}

listenComponents((component) => {
   for (const service of ServicePoints.values()) {
      if (service.descriptor.providers?.includes(component.id)) {
         ServiceChangeHandlers.forEach(l => l(service))
      }
   }
})

async function fetchComponentsService<IService>(components_ids: string[], service: string, servicepoint: string, log: ILogDispatcher): Promise<IService[]> {
   const services = []
   if (Array.isArray(components_ids) && components_ids.length > 0) {
      for (const component_id of components_ids) {
         const component = acquireComponent(component_id)
         if (await component.fetch()) {
            const srv = await component.acquireInterface(service).fetch()
            if (srv) {
               services.push(srv)
            }
            else {
               log.notifyError(new Error(`ServicePoint '${servicepoint}': component '${component_id}' not implement service '${service}'`))
            }
         }
         else {
            log.notifyError(new Error(`ServicePoint '${servicepoint}': component '${component_id}' not found`))
         }
      }
   }
   return services
}

export function acquireServicePointDescriptor(id: string): ServicePointSetting {
   const settings = getSettings()
   let desc = settings.get("service_points", id)
   if (!desc) desc = { id, providers: [], properties: {} }
   return desc
}

export function updateServicePointDescriptor(id: string, properties: ServicePointProperties): ServicePointSetting {
   const settings = getSettings()
   let desc = settings.get("service_points", id)
   if (desc) {
      let hasChanged = false
      for (const key in properties) {
         const value = properties[key]
         if (value !== undefined && desc[key] != value) {
            desc[key] = value
            hasChanged = true
         }
      }
      hasChanged && settings.set("service_points", id, desc)
   }
   else {
      desc = { id, providers: [], properties }
      settings.set("service_points", id, desc)
   }
   return desc
}

listenSettings((group, id) => {
   if (group === "service_points") {
      const svc = ServicePoints.get(id)
      if (svc) {
         const desc = getSettings().get<ServicePointSetting>("service_points", id)
         svc.reset(desc)
         console.log("[Update Service Point]", id)
      }
   }
})

export function getServicePoint<IService>(id: string): ServicePoint<IService> {
   return ServicePoints.get(id) as ServicePoint<IService>
}

export function acquireServicePoint<IService>(id: string): ServicePoint<IService> {
   let svc = ServicePoints.get(id) as ServicePoint<IService>
   if (!svc) {
      svc = new ServicePoint<IService>(acquireServicePointDescriptor(id))
      ServicePoints.set(svc.id, svc)
   }
   return svc
}

export function createServicePoint<S extends any, D extends any>(service: ServiceAccessor<S, D>, name: ServicePointID, properties?: ServicePointProperties): ServicePoint<S> {
   const id = service.resource + "/" + name
   updateServicePointDescriptor(id, properties)
   return acquireServicePoint(id)
}

