// Side effects script that provides Node.js globals for browser environment
// This file is injected by esbuild to polyfill globals like Buffer

import './process.js'
import './buffer.js'

// Make Buffer available globally
globalThis.Buffer = Buffer
