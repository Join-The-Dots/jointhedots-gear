import { z } from "zod"
import { InterfaceLinkSchema } from "../mod-node.ts"

// =============================================================================
// Base Types
// =============================================================================

export const JSONSchema7TypeNameSchema = z.enum([
   "string",
   "number",
   "integer",
   "boolean",
   "object",
   "array",
   "null"
])

export const JSONSchema7TypeNameCustomSchema = z.enum([
   "module",
   "function",
   "service"
])

export const JSONSchema7TypeSchema = z.union([
   z.string(),
   z.number(),
   z.boolean(),
   z.null(),
   z.record(z.string(), z.any()),
   z.array(z.any())
])

// =============================================================================
// Documentation & Binding Schemas
// =============================================================================

export const ChapterSchema = z.object({
   title: z.string().optional(),
   properties: z.array(z.string()).optional(),
   secondaryProperties: z.array(z.string()).optional(),
   patternProperties: z.array(z.string()).optional(),
   additionalProperties: z.boolean().optional()
})

export const DocumentationSchema = z.object({
   description: z.string().optional(),
   chapters: z.array(ChapterSchema).optional(),
   additionalChapter: z.boolean().optional()
})

export const BindingSchema = z.object({
   source: z.string()
})

export const ExpressionSchema = z.object({
   type: z.string()
}).passthrough()

// Forward declaration for recursive types
export const JSONSchema7DefinitionSchema: z.ZodType<any> = z.lazy(() => JSONSchemaSchema)

export const TemplateSchema = z.object({
   title: z.string().optional(),
   icon: z.string().optional(),
   description: z.string().optional(),
   args: z.array(JSONSchema7DefinitionSchema).optional(),
   content: ExpressionSchema
})

export const DockingSchema = z.object({
   view: z.string(),
   properties: z.record(z.string(), JSONSchema7DefinitionSchema).optional()
})

// =============================================================================
// Security Types
// =============================================================================

// Note: z.function() in Zod 4 is a function factory, not a schema
// Using a more flexible type for security rule checks
export const SecurityRuleSchema = z.object({
   check: z.any() // Function type - validated at runtime
})

export const SecurityGuardSchema = z.union([
   z.literal("safe"),
   z.string(), // ResourceLink<SecurityRule>
   z.object({
      rule: z.string()
   }).passthrough()
])

// =============================================================================
// JSON Schema Standard
// =============================================================================

export const JSONSchemaStandardSchema = z.object({
   $id: z.string().optional(),
   $ref: z.string().optional(),
   $schema: z.string().optional(),
   $comment: z.string().optional(),

   /**
    * @see https://datatracker.ietf.org/doc/html/draft-bhutton-json-schema-00#section-8.2.4
    */
   $defs: z.record(z.string(), z.lazy(() => JSONSchema7DefinitionSchema)).optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.1
    */
   type: z.union([JSONSchema7TypeNameSchema, JSONSchema7TypeNameCustomSchema]).optional(),
   enum: z.array(JSONSchema7TypeSchema).optional(),
   const: JSONSchema7TypeSchema.optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.2
    */
   multipleOf: z.number().optional(),
   maximum: z.number().optional(),
   exclusiveMaximum: z.number().optional(),
   minimum: z.number().optional(),
   exclusiveMinimum: z.number().optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.3
    */
   maxLength: z.number().optional(),
   minLength: z.number().optional(),
   pattern: z.string().optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.4
    */
   items: z.union([
      z.lazy(() => JSONSchema7DefinitionSchema),
      z.array(z.lazy(() => JSONSchema7DefinitionSchema))
   ]).optional(),
   additionalItems: z.lazy(() => JSONSchema7DefinitionSchema).optional(),
   maxItems: z.number().optional(),
   minItems: z.number().optional(),
   uniqueItems: z.boolean().optional(),
   contains: z.lazy(() => JSONSchema7DefinitionSchema).optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.5
    */
   maxProperties: z.number().optional(),
   minProperties: z.number().optional(),
   required: z.array(z.string()).optional(),
   properties: z.record(z.string(), z.lazy(() => JSONSchema7DefinitionSchema)).optional(),
   patternProperties: z.record(z.string(), z.lazy(() => JSONSchema7DefinitionSchema)).optional(),
   additionalProperties: z.lazy(() => JSONSchema7DefinitionSchema).optional(),
   dependencies: z.record(z.string(), z.union([
      z.lazy(() => JSONSchema7DefinitionSchema),
      z.array(z.string())
   ])).optional(),
   propertyNames: z.lazy(() => JSONSchema7DefinitionSchema).optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.6
    */
   if: z.lazy(() => JSONSchema7DefinitionSchema).optional(),
   then: z.lazy(() => JSONSchema7DefinitionSchema).optional(),
   else: z.lazy(() => JSONSchema7DefinitionSchema).optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.7
    */
   allOf: z.array(z.lazy(() => JSONSchema7DefinitionSchema)).optional(),
   anyOf: z.array(z.lazy(() => JSONSchema7DefinitionSchema)).optional(),
   oneOf: z.array(z.lazy(() => JSONSchema7DefinitionSchema)).optional(),
   not: z.lazy(() => JSONSchema7DefinitionSchema).optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-7
    */
   format: z.string().optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-8
    */
   contentMediaType: z.string().optional(),
   contentEncoding: z.string().optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-9
    */
   definitions: z.record(z.string(), z.lazy(() => JSONSchema7DefinitionSchema)).optional(),

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-10
    */
   title: z.string().optional(),
   description: z.string().optional(),
   default: JSONSchema7TypeSchema.optional(),
   readOnly: z.boolean().optional(),
   writeOnly: z.boolean().optional(),
   examples: JSONSchema7TypeSchema.optional()
})

// =============================================================================
// JSON Schema Custom Extensions
// =============================================================================

export const JSONSchemaCustomSchema = z.object({
   // Information
   title: z.string().optional(),
   icon: z.string().optional(),
   doc: DocumentationSchema.optional(),
   $error: z.union([z.string(), z.instanceof(Error)]).optional(),

   // Programming interface
   apis: z.record(z.string(), InterfaceLinkSchema).optional(),
   args: z.array(z.lazy(() => JSONSchemaSchema)).optional(),
   placeholder: z.boolean().optional(),
   security: SecurityGuardSchema.optional(),
   "allow-origin": z.string().optional(),

   // Component related schema
   docking: DockingSchema.optional(),
   templates: z.array(TemplateSchema).optional(),
   binding: BindingSchema.optional(),
   aliases: z.record(z.string(), z.string()).optional()
})

// =============================================================================
// Service Schema
// =============================================================================

export const ServiceSchemaSchema = JSONSchemaStandardSchema.merge(JSONSchemaCustomSchema).extend({
   type: z.literal("service"),
   /** URI or path to the external specification */
   $spec: z.string(),
   /** Version of the specification */
   version: z.string().optional()
})

// =============================================================================
// Function Schema (MCP-style tool definition)
// =============================================================================

export const FunctionSchemaSchema = JSONSchemaStandardSchema.merge(JSONSchemaCustomSchema).extend({
   type: z.literal("function"),
   /** JSON Schema for input parameters */
   input: z.union([
      z.lazy(() => JSONSchemaSchema),
      z.array(z.lazy(() => JSONSchemaSchema))
   ]).optional(),
   /** JSON Schema for output */
   output: z.union([
      z.lazy(() => JSONSchemaSchema),
      z.array(z.lazy(() => JSONSchemaSchema))
   ]).optional()
})

// =============================================================================
// Combined JSON Schema
// =============================================================================

export const JSONSchemaSchema: z.ZodType<any> = z.lazy(() =>
   z.union([
      JSONSchemaStandardSchema.merge(JSONSchemaCustomSchema),
      ServiceSchemaSchema
   ])
)

// =============================================================================
// Type Exports (inferred from Zod schemas)
// =============================================================================

export type JSONSchema7TypeName = z.infer<typeof JSONSchema7TypeNameSchema>
export type JSONSchema7TypeNameCustom = z.infer<typeof JSONSchema7TypeNameCustomSchema>
export type JSONSchema7 = z.infer<typeof JSONSchema7TypeSchema>
export type JSONSchema7Definition = z.infer<typeof JSONSchema7DefinitionSchema>
export type ChapterSchema = z.infer<typeof ChapterSchema>
export type DocumentationSchema = z.infer<typeof DocumentationSchema>
export type BindingSchema = z.infer<typeof BindingSchema>
export type ExpressionSchema = z.infer<typeof ExpressionSchema>
export type TemplateSchema = z.infer<typeof TemplateSchema>
export type DockingSchema = z.infer<typeof DockingSchema>
export type SecurityRule = z.infer<typeof SecurityRuleSchema>
export type SecurityGuard = z.infer<typeof SecurityGuardSchema>
export type JSONSchemaStandard = z.infer<typeof JSONSchemaStandardSchema>
export type JSONSchemaCustom = z.infer<typeof JSONSchemaCustomSchema>
export type ServiceSchema = z.infer<typeof ServiceSchemaSchema>
export type FunctionSchema = z.infer<typeof FunctionSchemaSchema>
export type JSONSchema = z.infer<typeof JSONSchemaSchema>
