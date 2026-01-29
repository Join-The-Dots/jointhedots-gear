// Custom util polyfill with stripVTControlCharacters

// stripVTControlCharacters - removes ANSI escape sequences
const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

export function stripVTControlCharacters(str) {
   if (typeof str !== 'string') {
      throw new TypeError('The "str" argument must be of type string')
   }
   return str.replace(ansiRegex, '')
}

// Common util functions
export function inherits(ctor, superCtor) {
   ctor.super_ = superCtor
   ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true }
   })
}

export function deprecate(fn, msg) {
   let warned = false
   return function (...args) {
      if (!warned) {
         console.warn(msg)
         warned = true
      }
      return fn.apply(this, args)
   }
}

export function debuglog(section) {
   return function () { }
}

export function inspect(obj, opts) {
   return JSON.stringify(obj, null, 2)
}

export function format(f, ...args) {
   if (typeof f !== 'string') {
      return args.map(a => inspect(a)).join(' ')
   }
   let i = 0
   return f.replace(/%[sdjifoO%]/g, (x) => {
      if (x === '%%') return '%'
      if (i >= args.length) return x
      const arg = args[i++]
      switch (x) {
         case '%s': return String(arg)
         case '%d': return Number(arg)
         case '%i': return parseInt(arg, 10)
         case '%j': return JSON.stringify(arg)
         case '%f': return parseFloat(arg)
         case '%o':
         case '%O': return inspect(arg)
         default: return x
      }
   })
}

export function formatWithOptions(opts, f, ...args) {
   return format(f, ...args)
}

export const isArray = Array.isArray
export const isBoolean = (v) => typeof v === 'boolean'
export const isNull = (v) => v === null
export const isNullOrUndefined = (v) => v == null
export const isNumber = (v) => typeof v === 'number'
export const isString = (v) => typeof v === 'string'
export const isSymbol = (v) => typeof v === 'symbol'
export const isUndefined = (v) => v === undefined
export const isObject = (v) => typeof v === 'object' && v !== null
export const isFunction = (v) => typeof v === 'function'
export const isRegExp = (v) => v instanceof RegExp
export const isDate = (v) => v instanceof Date
export const isError = (v) => v instanceof Error
export const isPrimitive = (v) => v === null || (typeof v !== 'object' && typeof v !== 'function')
export const isBuffer = (v) => typeof Buffer !== 'undefined' && Buffer.isBuffer(v)

export function callbackify(fn) {
   return function (...args) {
      const callback = args.pop()
      Promise.resolve(fn(...args)).then(
         (result) => callback(null, result),
         (err) => callback(err)
      )
   }
}

export function promisify(fn) {
   return function (...args) {
      return new Promise((resolve, reject) => {
         fn(...args, (err, result) => {
            if (err) reject(err)
            else resolve(result)
         })
      })
   }
}

export const types = {
   isAnyArrayBuffer: (v) => v instanceof ArrayBuffer || v instanceof SharedArrayBuffer,
   isArrayBuffer: (v) => v instanceof ArrayBuffer,
   isArrayBufferView: (v) => ArrayBuffer.isView(v),
   isAsyncFunction: (v) => v?.constructor?.name === 'AsyncFunction',
   isBigInt64Array: (v) => v instanceof BigInt64Array,
   isBigUint64Array: (v) => v instanceof BigUint64Array,
   isDataView: (v) => v instanceof DataView,
   isDate: (v) => v instanceof Date,
   isFloat32Array: (v) => v instanceof Float32Array,
   isFloat64Array: (v) => v instanceof Float64Array,
   isGeneratorFunction: (v) => v?.constructor?.name === 'GeneratorFunction',
   isInt8Array: (v) => v instanceof Int8Array,
   isInt16Array: (v) => v instanceof Int16Array,
   isInt32Array: (v) => v instanceof Int32Array,
   isMap: (v) => v instanceof Map,
   isMapIterator: (v) => v?.[Symbol.toStringTag] === 'Map Iterator',
   isPromise: (v) => v instanceof Promise,
   isRegExp: (v) => v instanceof RegExp,
   isSet: (v) => v instanceof Set,
   isSetIterator: (v) => v?.[Symbol.toStringTag] === 'Set Iterator',
   isSharedArrayBuffer: (v) => v instanceof SharedArrayBuffer,
   isTypedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView),
   isUint8Array: (v) => v instanceof Uint8Array,
   isUint8ClampedArray: (v) => v instanceof Uint8ClampedArray,
   isUint16Array: (v) => v instanceof Uint16Array,
   isUint32Array: (v) => v instanceof Uint32Array,
   isWeakMap: (v) => v instanceof WeakMap,
   isWeakSet: (v) => v instanceof WeakSet,
}

export class TextEncoder {
   encode(str) { return new globalThis.TextEncoder().encode(str) }
}

export class TextDecoder {
   decode(buf) { return new globalThis.TextDecoder().decode(buf) }
}

export default {
   stripVTControlCharacters,
   inherits,
   deprecate,
   debuglog,
   inspect,
   format,
   formatWithOptions,
   isArray,
   isBoolean,
   isNull,
   isNullOrUndefined,
   isNumber,
   isString,
   isSymbol,
   isUndefined,
   isObject,
   isFunction,
   isRegExp,
   isDate,
   isError,
   isPrimitive,
   isBuffer,
   callbackify,
   promisify,
   types,
   TextEncoder,
   TextDecoder,
}
