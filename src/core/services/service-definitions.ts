import type { ServiceSchema } from "../schema/schema.ts"
import { ZodService } from "../schema/zod.ts"
import type { ZodType } from "zod"
import { type ServiceSpecification, type ServiceCompatibility, checkVersionCompatibility } from "./service-specification.ts"

// =============================================================================
// Service Definition (Implementation Reference)
// =============================================================================

/**
 * ServiceDefinition is a concrete definition linking a specification to implementation.
 * 
 * @template I - The TypeScript interface type this service implements
 * @template P - The type of properties (hyperparameters) for service speci alization
 */
export interface ServiceDefinition<I, P = unknown> {
   /** Reference to the service specification */
   $spec: string

   /** Version of the specification this definition implements */
   version: string

   /** Zod schema for validating properties */
   properties?: ZodType<P>

   /** Check if the service is compatible for assignement with an other definition */
   isAssignable(from: ServiceDefinition<I>)
}

export type ServiceInterface<T> = T extends ServiceDefinition<infer I, any> ? I : never

// =============================================================================
// Service Factory Functions
// =============================================================================

/**
 * Get ZodService type from a service definition
 */
export function getServiceZod<I>(def: ServiceDefinition<I>) {
   return ZodService.create<I>(
      def.$spec,
      def.version
   )
}

/**
 * Get ServiceSchema (JSON Schema representation) from a service definition
 */
export function getServiceSchema<I, P>(def: ServiceDefinition<I, P>): ServiceSchema {
   return {
      type: "service",
      $spec: def.$spec,
      version: def.version,
   }
}

/**
 * Get full ServiceSchema including attributes schema from a specification
 */
export function getServiceSchemaFromSpec<I, A>(
   spec: ServiceSpecification<I, A>
): ServiceSchema {
   const schema: ServiceSchema = {
      type: "service",
      $spec: spec.$spec,
      version: spec.version,
   }
   return schema
}

/**
 * Check if a service definition matches a specification
 */
export function matchesSpecification<I, A>(
   def: ServiceDefinition<I, A>,
   spec: ServiceSpecification<I, A>
): ServiceCompatibility {
   if (def.$spec !== spec.$spec) {
      return {
         compatible: false,
         reason: `Specification mismatch: definition uses "${def.$spec}", expected "${spec.$spec}"`
      }
   }

   return checkVersionCompatibility(spec.version, def.version, spec.minCompatibleVersion)
}


