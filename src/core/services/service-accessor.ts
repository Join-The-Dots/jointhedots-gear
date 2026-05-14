import type { ComponentEntry } from "../components/manifold.ts"

//-------------------------------------------------------------
// Service: programming resource provided by a component
//-------------------------------------------------------------

export type ServiceType = string

export class ServiceAccessor<Instance extends any, Spec extends any> {
   private constructor(public resource: string, public definition) { }

   /** Synchronously retrieves the service instance from the given component entry. Returns undefined if the resource is not available. */
   get(entry: ComponentEntry): Instance { return entry.getInterface(this.resource)?.get<Instance>() }

   /** Asynchronously fetches the service instance from the given component entry, waiting until the resource becomes available. */
   fetch(entry: ComponentEntry): Promise<Instance> { return entry.fetchInterface<Instance>(this.resource) }

   /** Returns the specification/configuration associated with this service from the given component entry. */
   spec(entry: ComponentEntry): Spec { return entry.acquireInterface(this.resource)?.spec as Spec }

   /** Creates a child service accessor scoped under this service's resource path. */
   subservice<T extends any>(name: string) { return ServiceAccessor.About<T, Spec>(`${this.resource}.${name}`) }

   /** Factory method that creates a new ServiceAccessor for the given resource name and optional definition. */
   static About<Instance extends any, Spec extends any>(resource: string, definition = null) {
      return new ServiceAccessor<Instance, Spec>(resource, definition)
   }
}
