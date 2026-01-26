// Browser polyfill for child_process module
// child_process is not available in browser environments, so we provide stubs
// that throw meaningful errors when called

class NotSupportedError extends Error {
   constructor(method) {
      super(`child_process.${method}() is not supported in browser environments`)
      this.name = 'NotSupportedError'
      this.code = 'ERR_NOT_SUPPORTED'
   }
}

export function spawn(command, args, options) {
   throw new NotSupportedError('spawn')
}

export function spawnSync(command, args, options) {
   throw new NotSupportedError('spawnSync')
}

export function exec(command, options, callback) {
   if (typeof options === 'function') {
      callback = options
      options = {}
   }
   const error = new NotSupportedError('exec')
   if (callback) {
      process.nextTick(() => callback(error, '', ''))
   }
   return {
      stdin: null,
      stdout: null,
      stderr: null,
      kill: () => false,
      on: () => {},
      once: () => {},
      removeListener: () => {},
   }
}

export function execSync(command, options) {
   throw new NotSupportedError('execSync')
}

export function execFile(file, args, options, callback) {
   if (typeof args === 'function') {
      callback = args
      args = []
      options = {}
   } else if (typeof options === 'function') {
      callback = options
      options = {}
   }
   const error = new NotSupportedError('execFile')
   if (callback) {
      process.nextTick(() => callback(error, '', ''))
   }
   return {
      stdin: null,
      stdout: null,
      stderr: null,
      kill: () => false,
      on: () => {},
      once: () => {},
      removeListener: () => {},
   }
}

export function execFileSync(file, args, options) {
   throw new NotSupportedError('execFileSync')
}

export function fork(modulePath, args, options) {
   throw new NotSupportedError('fork')
}

// ChildProcess class stub
export class ChildProcess {
   constructor() {
      this.stdin = null
      this.stdout = null
      this.stderr = null
      this.stdio = [null, null, null]
      this.killed = false
      this.pid = undefined
      this.connected = false
      this.exitCode = null
      this.signalCode = null
   }

   kill(signal) {
      return false
   }

   send(message, sendHandle, options, callback) {
      throw new NotSupportedError('ChildProcess.send')
   }

   disconnect() {
      throw new NotSupportedError('ChildProcess.disconnect')
   }

   ref() {
      return this
   }

   unref() {
      return this
   }

   on(event, listener) {
      return this
   }

   once(event, listener) {
      return this
   }

   off(event, listener) {
      return this
   }

   removeListener(event, listener) {
      return this
   }

   removeAllListeners(event) {
      return this
   }

   emit(event, ...args) {
      return false
   }
}

export default {
   spawn,
   spawnSync,
   exec,
   execSync,
   execFile,
   execFileSync,
   fork,
   ChildProcess,
}
