import type { JSONSchema } from "../schema/schema.ts"
import type { ZodType } from "zod"

// =============================================================================
// Service Specification Interface
// =============================================================================

/**
 * ServiceSpecification defines the metadata and schema for a service interface.
 * It describes the contract that providers must implement and consumers can rely on.
 * 
 * @template I - The TypeScript interface type this service represents
 * @template P - The type of properties (hyperparameters) for service specialization
 */
export interface ServiceSpecification<I = unknown, P = unknown> {
   /** Unique identifier for the service specification (URI or qualified name) */
   $spec: string

   /** Semantic version of the specification (e.g., "1.0.0") */
   version: string

   /** 
    * JSON Schema defining the service interface including:
    * - title, description (metadata)
    * - properties (hyperparameters for service specialization)
    * - All standard JSON Schema validation rules
    */
   schema?: JSONSchema

   /** 
    * Zod schema for runtime validation and compile-time type inference.
    * Bridges runtime validation with TypeScript's static type system.
    */
   properties?: ZodType<P>

   /** Category or domain the service belongs to */
   category?: string

   /** Tags for discovery and filtering */
   tags?: string[]

   /** Minimum compatible version for consumers */
   minCompatibleVersion?: string
}

// =============================================================================
// Service Compatibility
// =============================================================================

/**
 * Result of checking compatibility between consumer and provider
 */
export interface ServiceCompatibility {
   /** Whether the service is compatible */
   compatible: boolean
   /** Reason for incompatibility if not compatible */
   reason?: string
   /** Warnings about potential issues */
   warnings?: string[]
}

/**
 * Check if a provider version is compatible with a consumer's required version
 */
export function checkVersionCompatibility(
   requiredVersion: string,
   providedVersion: string,
   minCompatibleVersion?: string
): ServiceCompatibility {
   const required = parseVersion(requiredVersion)
   const provided = parseVersion(providedVersion)

   // Exact match is always compatible
   if (requiredVersion === providedVersion) {
      return { compatible: true }
   }

   // Major version must match for compatibility
   if (required.major !== provided.major) {
      return {
         compatible: false,
         reason: `Major version mismatch: required ${required.major}.x, provided ${provided.major}.x`
      }
   }

   // Provider version must be >= required version
   if (provided.minor < required.minor) {
      return {
         compatible: false,
         reason: `Provider version ${providedVersion} is older than required ${requiredVersion}`
      }
   }

   // Check minimum compatible version if specified
   if (minCompatibleVersion) {
      const minCompat = parseVersion(minCompatibleVersion)
      if (required.major < minCompat.major ||
         (required.major === minCompat.major && required.minor < minCompat.minor)) {
         return {
            compatible: false,
            reason: `Required version ${requiredVersion} is below minimum compatible version ${minCompatibleVersion}`
         }
      }
   }

   return {
      compatible: true,
      warnings: provided.minor > required.minor
         ? [`Provider version ${providedVersion} is newer than required ${requiredVersion}`]
         : undefined
   }
}

function parseVersion(version: string): { major: number, minor: number, patch: number } {
   const parts = version.split(".").map(Number)
   return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
   }
}

// =============================================================================
// Service Specification Factory
// =============================================================================

/**
 * Create a service specification with full metadata
 */
export function defineServiceSpec<I = unknown, P = unknown>(
   spec: ServiceSpecification<I, P>
): ServiceSpecification<I, P> {
   return spec
}
