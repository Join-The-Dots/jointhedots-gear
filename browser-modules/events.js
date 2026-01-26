// Browser polyfill for node:events module

export class EventEmitter {
   constructor() {
      this._events = Object.create(null)
      this._maxListeners = EventEmitter.defaultMaxListeners
   }

   static defaultMaxListeners = 10

   setMaxListeners(n) {
      this._maxListeners = n
      return this
   }

   getMaxListeners() {
      return this._maxListeners
   }

   emit(type, ...args) {
      const listeners = this._events[type]
      if (!listeners || listeners.length === 0) {
         if (type === 'error') {
            const err = args[0]
            throw err instanceof Error ? err : new Error('Unhandled error: ' + err)
         }
         return false
      }

      for (const listener of [...listeners]) {
         listener.apply(this, args)
      }
      return true
   }

   on(type, listener) {
      return this.addListener(type, listener)
   }

   addListener(type, listener) {
      if (typeof listener !== 'function') {
         throw new TypeError('listener must be a function')
      }
      if (!this._events[type]) {
         this._events[type] = []
      }
      this._events[type].push(listener)
      return this
   }

   once(type, listener) {
      if (typeof listener !== 'function') {
         throw new TypeError('listener must be a function')
      }
      const wrapped = (...args) => {
         this.removeListener(type, wrapped)
         listener.apply(this, args)
      }
      wrapped.listener = listener
      return this.addListener(type, wrapped)
   }

   prependListener(type, listener) {
      if (typeof listener !== 'function') {
         throw new TypeError('listener must be a function')
      }
      if (!this._events[type]) {
         this._events[type] = []
      }
      this._events[type].unshift(listener)
      return this
   }

   prependOnceListener(type, listener) {
      if (typeof listener !== 'function') {
         throw new TypeError('listener must be a function')
      }
      const wrapped = (...args) => {
         this.removeListener(type, wrapped)
         listener.apply(this, args)
      }
      wrapped.listener = listener
      return this.prependListener(type, wrapped)
   }

   off(type, listener) {
      return this.removeListener(type, listener)
   }

   removeListener(type, listener) {
      const listeners = this._events[type]
      if (!listeners) return this

      const index = listeners.findIndex(
         (l) => l === listener || l.listener === listener
      )
      if (index !== -1) {
         listeners.splice(index, 1)
         if (listeners.length === 0) {
            delete this._events[type]
         }
      }
      return this
   }

   removeAllListeners(type) {
      if (type) {
         delete this._events[type]
      } else {
         this._events = Object.create(null)
      }
      return this
   }

   listeners(type) {
      const listeners = this._events[type]
      if (!listeners) return []
      return listeners.map((l) => l.listener || l)
   }

   rawListeners(type) {
      return this._events[type] ? [...this._events[type]] : []
   }

   listenerCount(type) {
      const listeners = this._events[type]
      return listeners ? listeners.length : 0
   }

   eventNames() {
      return Object.keys(this._events)
   }
}

// Static method
export function once(emitter, name) {
   return new Promise((resolve, reject) => {
      const onEvent = (...args) => {
         emitter.removeListener('error', onError)
         resolve(args)
      }
      const onError = (err) => {
         emitter.removeListener(name, onEvent)
         reject(err)
      }
      emitter.once(name, onEvent)
      if (name !== 'error') {
         emitter.once('error', onError)
      }
   })
}

export function on(emitter, event) {
   const queue = []
   let resolve = null
   let done = false

   const listener = (...args) => {
      if (resolve) {
         resolve({ value: args, done: false })
         resolve = null
      } else {
         queue.push(args)
      }
   }

   emitter.on(event, listener)

   return {
      [Symbol.asyncIterator]() {
         return this
      },
      async next() {
         if (done) {
            return { value: undefined, done: true }
         }
         if (queue.length > 0) {
            return { value: queue.shift(), done: false }
         }
         return new Promise((res) => {
            resolve = res
         })
      },
      async return() {
         done = true
         emitter.removeListener(event, listener)
         return { value: undefined, done: true }
      },
   }
}

export function getEventListeners(emitter, name) {
   return emitter.listeners(name)
}

export function listenerCount(emitter, type) {
   return emitter.listenerCount(type)
}

export default EventEmitter
