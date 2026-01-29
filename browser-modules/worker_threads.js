// Browser polyfill for worker_threads module
// worker_threads is not fully available in browser environments
// This provides stubs that throw meaningful errors or return appropriate defaults

class NotSupportedError extends Error {
   constructor(method) {
      super(`worker_threads.${method}() is not supported in browser environments`)
      this.name = 'NotSupportedError'
      this.code = 'ERR_NOT_SUPPORTED'
   }
}

// In browsers, we're always on the main thread
export const isMainThread = true

// No parent port in main thread
export const parentPort = null

// No worker data in main thread
export const workerData = null

// Thread ID (main thread is 0)
export const threadId = 0

// Resource limits (not applicable in browser)
export const resourceLimits = {}

// SHARE_ENV symbol
export const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV')

// MessageChannel is available natively in browsers
export const MessageChannel = globalThis.MessageChannel

// MessagePort is available natively in browsers
export const MessagePort = globalThis.MessagePort

// BroadcastChannel is available natively in browsers
export const BroadcastChannel = globalThis.BroadcastChannel

// Worker class - stub that throws
export class Worker {
   constructor(filename, options) {
      throw new NotSupportedError('Worker')
   }
}

// Functions that are not supported
export function markAsUntransferable(object) {
   // No-op in browser
}

export function moveMessagePortToContext(port, contextifiedSandbox) {
   throw new NotSupportedError('moveMessagePortToContext')
}

export function receiveMessageOnPort(port) {
   throw new NotSupportedError('receiveMessageOnPort')
}

export function getEnvironmentData(key) {
   return undefined
}

export function setEnvironmentData(key, value) {
   // No-op in browser
}

// Default export with all named exports
export default {
   isMainThread,
   parentPort,
   workerData,
   threadId,
   resourceLimits,
   SHARE_ENV,
   MessageChannel,
   MessagePort,
   BroadcastChannel,
   Worker,
   markAsUntransferable,
   moveMessagePortToContext,
   receiveMessageOnPort,
   getEnvironmentData,
   setEnvironmentData,
}
