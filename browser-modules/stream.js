// Browser polyfill for node:stream module
// Provides basic EventEmitter-based stream implementations

import { EventEmitter } from './events.js'

export class Stream extends EventEmitter {
   constructor(options) {
      super()
      this.readable = false
      this.writable = false
   }

   pipe(dest, options) {
      return dest
   }
}

export class Readable extends Stream {
   constructor(options = {}) {
      super()
      this.readable = true
      this._readableState = {
         flowing: null,
         ended: false,
         endEmitted: false,
         reading: false,
         destroyed: false,
         objectMode: options.objectMode || false,
         highWaterMark: options.highWaterMark || 16384,
         buffer: [],
         length: 0,
      }
   }

   read(size) {
      return null
   }

   _read(size) {
      // Override in subclass
   }

   push(chunk, encoding) {
      if (chunk === null) {
         this._readableState.ended = true
         this.emit('end')
         return false
      }
      this._readableState.buffer.push(chunk)
      this.emit('data', chunk)
      return true
   }

   unshift(chunk) {
      this._readableState.buffer.unshift(chunk)
   }

   pause() {
      this._readableState.flowing = false
      return this
   }

   resume() {
      this._readableState.flowing = true
      return this
   }

   isPaused() {
      return this._readableState.flowing === false
   }

   pipe(dest, options) {
      this.on('data', (chunk) => {
         dest.write(chunk)
      })
      this.on('end', () => {
         if (!options || options.end !== false) {
            dest.end()
         }
      })
      return dest
   }

   destroy(err) {
      this._readableState.destroyed = true
      if (err) this.emit('error', err)
      this.emit('close')
      return this
   }

   [Symbol.asyncIterator]() {
      const self = this
      return {
         async next() {
            return new Promise((resolve) => {
               const onData = (chunk) => {
                  self.removeListener('data', onData)
                  self.removeListener('end', onEnd)
                  resolve({ value: chunk, done: false })
               }
               const onEnd = () => {
                  self.removeListener('data', onData)
                  self.removeListener('end', onEnd)
                  resolve({ value: undefined, done: true })
               }
               self.once('data', onData)
               self.once('end', onEnd)
            })
         }
      }
   }
}

export class Writable extends Stream {
   constructor(options = {}) {
      super()
      this.writable = true
      this._writableState = {
         ended: false,
         finished: false,
         destroyed: false,
         objectMode: options.objectMode || false,
         highWaterMark: options.highWaterMark || 16384,
         needDrain: false,
         writing: false,
         corked: 0,
         bufferProcessing: false,
         buffer: [],
      }
   }

   write(chunk, encoding, callback) {
      if (typeof encoding === 'function') {
         callback = encoding
         encoding = 'utf8'
      }
      this._write(chunk, encoding, callback || (() => {}))
      return true
   }

   _write(chunk, encoding, callback) {
      // Override in subclass
      callback()
   }

   end(chunk, encoding, callback) {
      if (typeof chunk === 'function') {
         callback = chunk
         chunk = null
      } else if (typeof encoding === 'function') {
         callback = encoding
         encoding = null
      }
      if (chunk != null) {
         this.write(chunk, encoding)
      }
      this._writableState.ended = true
      this._writableState.finished = true
      this.emit('finish')
      if (callback) callback()
      return this
   }

   cork() {
      this._writableState.corked++
   }

   uncork() {
      if (this._writableState.corked > 0) {
         this._writableState.corked--
      }
   }

   destroy(err) {
      this._writableState.destroyed = true
      if (err) this.emit('error', err)
      this.emit('close')
      return this
   }

   setDefaultEncoding(encoding) {
      this._defaultEncoding = encoding
      return this
   }
}

export class Duplex extends Readable {
   constructor(options = {}) {
      super(options)
      Writable.call(this, options)
      this.writable = true
      this._writableState = {
         ended: false,
         finished: false,
         destroyed: false,
         objectMode: options.objectMode || false,
         highWaterMark: options.highWaterMark || 16384,
         needDrain: false,
         writing: false,
         corked: 0,
         bufferProcessing: false,
         buffer: [],
      }
   }
}

// Mix in Writable methods
Object.assign(Duplex.prototype, Writable.prototype)

export class Transform extends Duplex {
   constructor(options = {}) {
      super(options)
      this._transformState = {
         transforming: false,
         writecb: null,
         writechunk: null,
      }
   }

   _transform(chunk, encoding, callback) {
      // Override in subclass
      callback(null, chunk)
   }

   _flush(callback) {
      callback()
   }

   _write(chunk, encoding, callback) {
      this._transform(chunk, encoding, (err, data) => {
         if (err) {
            callback(err)
            return
         }
         if (data != null) {
            this.push(data)
         }
         callback()
      })
   }
}

export class PassThrough extends Transform {
   constructor(options) {
      super(options)
   }

   _transform(chunk, encoding, callback) {
      callback(null, chunk)
   }
}

// Utility functions
export function finished(stream, options, callback) {
   if (typeof options === 'function') {
      callback = options
      options = {}
   }
   options = options || {}

   const onFinish = () => {
      cleanup()
      callback()
   }
   const onError = (err) => {
      cleanup()
      callback(err)
   }
   const cleanup = () => {
      stream.removeListener('finish', onFinish)
      stream.removeListener('end', onFinish)
      stream.removeListener('error', onError)
      stream.removeListener('close', onFinish)
   }

   stream.on('finish', onFinish)
   stream.on('end', onFinish)
   stream.on('error', onError)
   stream.on('close', onFinish)

   return cleanup
}

export function pipeline(...args) {
   const callback = args.pop()
   const streams = args

   if (streams.length < 2) {
      throw new Error('pipeline requires at least 2 streams')
   }

   let error
   const destroys = streams.map((stream, i) => {
      const isLast = i === streams.length - 1
      const isSource = i === 0

      return (err) => {
         if (err) error = err
         if (!isSource) stream.destroy()
         if (isLast && callback) callback(error)
      }
   })

   streams.reduce((prev, curr, i) => {
      prev.pipe(curr)
      prev.on('error', destroys[i])
      return curr
   })

   return streams[streams.length - 1]
}

// Default export
export default {
   Stream,
   Readable,
   Writable,
   Duplex,
   Transform,
   PassThrough,
   finished,
   pipeline,
}
