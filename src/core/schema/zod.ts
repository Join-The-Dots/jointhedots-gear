import { z, type ZodType } from "zod"
import { type JSONSchema, type ServiceSchema } from "./schema.ts"

// =============================================================================
// ZodService - Service Reference Type (External Spec)
// =============================================================================

export class ZodService<T = unknown> {
   readonly _type = "ZodService" as const
   constructor(public readonly $spec: string, public readonly version?: string) { }

   parse(data: unknown): T {
      if (typeof data !== "object" || data === null) throw new Error(`Expected object, received ${typeof data}`)
      return data as T
   }

   safeParse(data: unknown) {
      try { return { success: true as const, data: this.parse(data) } }
      catch (e) { return { success: false as const, error: e as Error } }
   }

   toJSONSchema(): ServiceSchema {
      return { type: "service", $spec: this.$spec, ...(this.version && { version: this.version }) }
   }

   static create<T = unknown>($spec: string, version?: string) { return new ZodService<T>($spec, version) }
}

export const zService = ZodService.create

// =============================================================================
// Zod → JSON Schema (using Zod 4 native toJSONSchema with custom override)
// =============================================================================

export function zodToJSONSchema(schema: ZodType | ZodService): JSONSchema {
   if (schema instanceof ZodService) return schema.toJSONSchema()
   return z.toJSONSchema(schema, {
      unrepresentable: "any",
      override: ({ zodSchema, jsonSchema }) => {
         // Handle ZodService wrapped in other types via metadata
         const meta = (zodSchema as any)._zod?.def?.meta
         if (meta?.$spec) {
            Object.assign(jsonSchema, meta.toServiceSchema())
         }
      }
   }) as JSONSchema
}

// =============================================================================
// JSON Schema → Zod (using Zod 4 native fromJSONSchema)
// =============================================================================

export function jsonSchemaToZod(schema: JSONSchema): ZodType {
   if (!schema || !Object.keys(schema).length) return z.any()
   // Handle custom "service" type not supported by standard JSON Schema
   if ((schema as ServiceSchema).type === "service") {
      const s = schema as ServiceSchema
      return zService(s.$spec, s.version) as any
   }
   return z.fromJSONSchema(schema as any)
}

// =============================================================================
// Validation
// =============================================================================

export type ValidationResult<T = unknown> = { success: true; data: T } | { success: false; errors: ValidationError[] }
export type ValidationError = { path: string[]; message: string; code?: string }

export function validate<T>(schema: JSONSchema | ZodType, data: unknown): ValidationResult<T> {
   const zs = schema instanceof z.ZodType ? schema : jsonSchemaToZod(schema)
   const r = zs.safeParse(data)
   return r.success
      ? { success: true, data: r.data as T }
      : { success: false, errors: r.error.issues.map(i => ({ path: i.path.map(String), message: i.message, code: i.code })) }
}

export function validateOrThrow<T>(schema: JSONSchema | ZodType, data: unknown): T {
   const zs = schema instanceof z.ZodType ? schema : jsonSchemaToZod(schema)
   return zs.parse(data) as T
}

// =============================================================================
// TypeScript Generation
// =============================================================================

export type TSGenOptions = { comments?: boolean; indent?: string; export?: boolean }

export function generateTypeScript(schema: JSONSchema, name: string, opts: TSGenOptions = {}): string {
   const { comments = true, indent = "  ", export: exp = true } = opts
   const ex = exp ? "export " : ""
   const desc = comments && schema.description ? `/** ${schema.description} */\n` : ""

   if ((schema as ServiceSchema).type === "service") {
      const s = schema as ServiceSchema
      const specComment = comments ? `${indent}/** @spec ${s.$spec}${s.version ? ` @version ${s.version}` : ""} */\n` : ""
      return `${desc}${ex}interface ${name} {\n${specComment}${indent}[key: string]: unknown\n}`
   }
   return `${desc}${ex}type ${name} = ${toTS(schema, indent, 0)}`
}

const toTS = (s: JSONSchema, ind: string, d: number): string => {
   const base = ind.repeat(d), inner = ind.repeat(d + 1)
   if (s.const !== undefined) return JSON.stringify(s.const)
   if (s.enum) return s.enum.map(v => JSON.stringify(v)).join(" | ")
   if (s.oneOf) return s.oneOf.map(x => toTS(x, ind, d)).join(" | ")
   if (s.anyOf) return s.anyOf.map(x => toTS(x, ind, d)).join(" | ")
   if (s.allOf) return s.allOf.map(x => toTS(x, ind, d)).join(" & ")
   switch (s.type) {
      case "string": return "string"
      case "number": case "integer": return "number"
      case "boolean": return "boolean"
      case "null": return "null"
      case "array":
         if (Array.isArray(s.items)) return `[${s.items.map(i => toTS(i, ind, d)).join(", ")}]`
         return `${s.items ? toTS(s.items, ind, d) : "any"}[]`
      case "object":
         if (!s.properties && s.additionalProperties && typeof s.additionalProperties === "object")
            return `Record<string, ${toTS(s.additionalProperties, ind, d)}>`
         if (!s.properties) return "object"
         const req = s.required ?? []
         const props = Object.entries(s.properties).map(([k, v]) => `${inner}${k}${req.includes(k) ? "" : "?"}: ${toTS(v, ind, d + 1)}`)
         if (typeof s.additionalProperties === "object" && Object.keys(s.additionalProperties).length)
            props.push(`${inner}[key: string]: ${toTS(s.additionalProperties, ind, d + 1)}`)
         return `{\n${props.join("\n")}\n${base}}`
      case "function": return "Function"
      case "view": case "display": case "element": return "React.ReactNode"
      default: return "any"
   }
}

// =============================================================================
// Re-exports
// =============================================================================

export { z }
