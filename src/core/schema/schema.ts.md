import type { JSONSchema7Type, JSONSchema7Version, JSONSchema7TypeName } from "json-schema"

export type JSONSchema7TypeNameCustom =
   "module" |
   "function" |
   "service"

export type JSONSchema7Definition = JSONSchema

export type JSONSchemaStandard = {
   $id?: string | undefined
   $ref?: string | undefined
   $schema?: JSONSchema7Version | undefined
   $comment?: string | undefined

   /**
    * @see https://datatracker.ietf.org/doc/html/draft-bhutton-json-schema-00#section-8.2.4
    * @see https://datatracker.ietf.org/doc/html/draft-bhutton-json-schema-validation-00#appendix-A
    */
   $defs?: {
      [key: string]: JSONSchema7Definition
   } | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.1
    */
   type?: JSONSchema7TypeName | JSONSchema7TypeNameCustom
   enum?: JSONSchema7Type[] | undefined
   const?: JSONSchema7Type | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.2
    */
   multipleOf?: number | undefined
   maximum?: number | undefined
   exclusiveMaximum?: number | undefined
   minimum?: number | undefined
   exclusiveMinimum?: number | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.3
    */
   maxLength?: number | undefined
   minLength?: number | undefined
   pattern?: string | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.4
    */
   items?: JSONSchema7Definition | JSONSchema7Definition[] | undefined
   additionalItems?: JSONSchema7Definition | undefined
   maxItems?: number | undefined
   minItems?: number | undefined
   uniqueItems?: boolean | undefined
   contains?: JSONSchema7Definition | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.5
    */
   maxProperties?: number | undefined
   minProperties?: number | undefined
   required?: string[] | undefined
   properties?: {
      [key: string]: JSONSchema7Definition
   } | undefined
   patternProperties?: {
      [key: string]: JSONSchema7Definition
   } | undefined
   additionalProperties?: JSONSchema7Definition | undefined
   dependencies?: {
      [key: string]: JSONSchema7Definition | string[]
   } | undefined
   propertyNames?: JSONSchema7Definition | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.6
    */
   if?: JSONSchema7Definition | undefined
   then?: JSONSchema7Definition | undefined
   else?: JSONSchema7Definition | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-6.7
    */
   allOf?: JSONSchema7Definition[] | undefined
   anyOf?: JSONSchema7Definition[] | undefined
   oneOf?: JSONSchema7Definition[] | undefined
   not?: JSONSchema7Definition | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-7
    */
   format?: string | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-8
    */
   contentMediaType?: string | undefined
   contentEncoding?: string | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-9
    */
   definitions?: {
      [key: string]: JSONSchema7Definition
   } | undefined

   /**
    * @see https://tools.ietf.org/html/draft-handrews-json-schema-validation-01#section-10
    */
   title?: string | undefined
   description?: string | undefined
   default?: JSONSchema7Type | undefined
   readOnly?: boolean | undefined
   writeOnly?: boolean | undefined
   examples?: JSONSchema7Type | undefined
}

export type JSONSchemaCustom = {

   // Information
   title?: string
   icon?: string
   doc?: DocumentationSchema
   $error?: string | Error

   // Programming interface
   args?: JSONSchema[]
   placeholder?: boolean // require a placeholder structure when empty
   resources?: Record<string, ResourceEntry> // Resources catalog with undefined interface
   security?: SecurityGuard
   "allow-origin"?: string

   // Component related schema
   docking?: DockingSchema
   templates?: TemplateSchema[] // descriptor to create a valid expression for this schema
   binding?: BindingSchema
   aliases?: Record<string, string>
}

export type JSONSchema = JSONSchemaStandard & JSONSchemaCustom | ServiceSchema

export type ResourceEntry<ResourceInterface = any> = ResourceLink<ResourceInterface> | {
   type: ResourceLink<ResourceFactory<ResourceInterface>>
   data?: any
}

export type ResourceFactory<ResourceInterface = any> = (data: any) => Promise<ResourceInterface>

export type ResourceLink<ResourceInterface = any> = string

export type SecurityGuard =
   "safe" |
   ResourceLink<SecurityRule> |
   {
      rule: ResourceLink<SecurityRule>
      [param: string]: any
   }

export interface SecurityRule {
   check(data: any, params?: Record<string, any>): Error
}

export type BindingSchema = {
   source: string
}

export type TemplateSchema = {
   title?: string
   icon?: string
   description?: string
   args?: JSONSchema[]
   content: ExpressionSchema
}

export type ExpressionSchema = {
   type: string,
   [properties: string]: any
}

export type DockingSchema = {
   view: string
   properties: Record<string, JSONSchema7Definition> | undefined
}

export type ChapterSchema = {
   title?: string
   properties?: string[]
   secondaryProperties?: string[]
   patternProperties?: string[]
   additionalProperties?: boolean
}

export type DocumentationSchema = {
   description?: string
   chapters?: ChapterSchema[]
   additionalChapter?: boolean
}

// =============================================================================
// Service Schema Types
// =============================================================================

/**
 * Service schema type - represents a software abstraction for data or implementation
 * related to a service connection. Uses external specification reference.
 * In TypeScript, represented as an interface.
 */
export type ServiceSchema = JSONSchemaStandard & JSONSchemaCustom & {
   type: "service"
   /** URI or path to the external specification */
   $spec: string
   /** Version of the specification */
   version?: string
}

// =============================================================================
// Function Schema Types (MCP-style tool definition)
// =============================================================================

/**
 * Function schema type - describes a callable function/tool
 */
export type FunctionSchema = JSONSchemaStandard & JSONSchemaCustom & {
   type: "function"
   /** JSON Schema for input parameters */
   input?: JSONSchema | JSONSchema[]
   /** JSON Schema for output */
   output?: JSONSchema | JSONSchema[]
}
