import Crypto from "node:crypto"

// Normalized name shapes, name are composed of lowercase alphanum parts with allowed separators
// Styles (checked in order):
// - urn style: separator { namespace = ':', key = '.'}, ex: 'mylib:pack.1:comp.2'
// - html style: separator { namespace = '-', key = '_'}, ex: 'mylib-pack_1-comp_2'
// - url style: separator { namespace = '/', key = '_'}, ex: 'mylib/pack_1/comp_2'
// - object style: separator { namespace = '.', key = '_'}, ex: 'mylib.pack_1.comp_2'
// - dns style: separator { namespace = '.', key = '-'}, ex: 'mylib.pack-1.comp-2'

export enum NameStyle {
   OBJECT = "object",
   WEBC = "webc",
   URN = "urn",
   URL = "url",
   DNS = "dns",
}

export type NameStyleConfig = {
   namespace: string
   key: string
}

export const NormalizedNameSeparators: Record<NameStyle, NameStyleConfig> = {
   [NameStyle.OBJECT]: { namespace: ".", key: "_" },
   [NameStyle.WEBC]: { namespace: "-", key: "_" },
   [NameStyle.URN]: { namespace: ":", key: "." },
   [NameStyle.URL]: { namespace: "/", key: "_" },
   [NameStyle.DNS]: { namespace: ".", key: "-" },
}

// Regex patterns for each style (must start with letter, not 'xml', lowercase alphanum with separators)
const check_name_regexes: Record<NameStyle, RegExp> = {
   [NameStyle.OBJECT]: /^(?![xX][mM][lL])[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/,
   [NameStyle.WEBC]: /^(?![xX][mM][lL])[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*$/,
   [NameStyle.URN]: /^(?![xX][mM][lL])[a-z][a-z0-9.]*(?::[a-z0-9.]+)*$/,
   [NameStyle.URL]: /^(?![xX][mM][lL])[a-z][a-z0-9_]*(?:\/[a-z0-9_]+)*$/,
   [NameStyle.DNS]: /^(?![xX][mM][lL])[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/,
}

export function detectNormalizedNameStyle(name: string): NameStyle {
   // Here we speculate that their is probably a namespace nesting in 'name'
   if (name.includes("/")) return NameStyle.URL
   if (name.includes(":")) return NameStyle.URN
   if (name.includes(".")) {
      if (name.includes("-")) return NameStyle.DNS
      return NameStyle.OBJECT
   }
   if (name.includes("-")) return NameStyle.WEBC
   return NameStyle.OBJECT
}

export function isNormalizedName(name: string, expectedStyle?: NameStyle): boolean {
   if (!name || typeof name !== "string") return false
   const style = expectedStyle ?? detectNormalizedNameStyle(name)
   return check_name_regexes[style].test(name)
}

export function getNormalizedKeys(name: string, fromStyle?: NameStyle): string[] {
   if (!name || typeof name !== "string") return []

   // Split into lowercase keys
   let keys: string[]
   name = name.toLowerCase()
   if (fromStyle) {
      const seps = NormalizedNameSeparators[fromStyle]
      keys = name.split(seps.namespace)
   }
   else {
      // Here we speculate that their is a namespace nesting in 'name'
      if (name.includes("/") || name.includes("\\")) keys = name.split(/[\/\\]/)
      else if (name.includes(":")) keys = name.split(":")
      else if (name.includes("-")) keys = name.split("-")
      else if (name.includes(".")) keys = name.split(".")
      else keys = [name]
   }

   // Normalize keys
   for (let i = 0; i < keys.length; i++) {
      keys[i] = keys[i].replace(/[^a-z0-9\s\t\n:._-]/g, "")
   }

   return keys
}

export function makeNormalizedName(name: string, targetStyle: NameStyle, fromStyle?: NameStyle): string {
   if (!name || typeof name !== "string") return name

   const seps = NormalizedNameSeparators[targetStyle]

   // Split into lowercase keys
   const keys = getNormalizedKeys(name, fromStyle)

   // Reform name, filtering out empty keys
   return keys.filter(x => !!x).join(seps.namespace)
}

export function computeNameHashID(identity: string): string {
   const hasher = Crypto.createHash("sha256")
   hasher.write(identity)
   return hasher.digest().toString("base64url")
}
