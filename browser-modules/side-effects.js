// Side effects script that provides Node.js globals for browser environment
// This file is injected by esbuild to polyfill globals like Buffer

import './process.js'
import './buffer.js'

// Add Node.js-specific API to W3C ReadableStream
{
   const proto = ReadableStream.prototype

   // Start consuming the stream, emitting 'data'/'end'/'error'/'close' events
   function _startReading(stream) {
      if (stream._reading) return
      stream._reading = true
      stream._paused = false
      const reader = stream.getReader()
      const pump = () => reader.read().then(({ done, value }) => {
         if (done) {
            stream._reading = false
            stream._emit('end')
            stream._emit('close')
            return
         }
         stream._emit('data', value)
         if (!stream._paused) return pump()
         stream._pump = pump
      }).catch(err => {
         stream._reading = false
         stream._emit('error', err)
      })
      pump()
   }

   proto._emit = function (event, ...args) {
      this._listeners?.[event]?.slice().forEach(fn => fn(...args))
   }

   proto.on = proto.addListener = function (event, fn) {
      this._listeners ??= {}
         ; (this._listeners[event] ??= []).push(fn)
      if (event === 'data') _startReading(this)
      return this
   }

   proto.once = function (event, fn) {
      const wrapped = (...args) => { this.off(event, wrapped); fn(...args) }
      return this.on(event, wrapped)
   }

   proto.off = proto.removeListener = function (event, fn) {
      const list = this._listeners?.[event]
      if (list) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
      return this
   }

   proto.pipe = function (dest) {
      this.on('data', chunk => dest.write?.(chunk))
      this.once('end', () => dest.end?.())
      this.once('error', err => dest.destroy?.(err))
      return dest
   }

   proto.pause = function () {
      this._paused = true
      return this
   }

   proto.resume = function () {
      this._paused = false
      this._pump?.()
      return this
   }

   proto.destroy = function (err) {
      if (err) this._emit('error', err)
      this._emit('close')
      this.cancel(err).catch(() => { })
      return this
   }

   proto.unpipe = function (dest) {
      this._listeners = {}
      return this
   }
}

// Add Node.js-specific API to W3C WritableStream
{
   const proto = WritableStream.prototype

   proto._emit = function (event, ...args) {
      this._listeners?.[event]?.slice().forEach(fn => fn(...args))
   }

   proto.on = proto.addListener = function (event, fn) {
      this._listeners ??= {}
         ; (this._listeners[event] ??= []).push(fn)
      return this
   }

   proto.once = function (event, fn) {
      const wrapped = (...args) => { this.off(event, wrapped); fn(...args) }
      return this.on(event, wrapped)
   }

   proto.off = proto.removeListener = function (event, fn) {
      const list = this._listeners?.[event]
      if (list) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
      return this
   }

   proto._getWriter = function () {
      if (!this._writer) this._writer = this.getWriter()
      return this._writer
   }

   proto.write = function (chunk, encoding, callback) {
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined }
      const writer = this._getWriter()
      writer.ready.then(() => writer.write(chunk)).then(
         () => { this._emit('drain'); callback?.() },
         err => { this._emit('error', err); callback?.(err) }
      )
      return true
   }

   proto.end = function (chunk, encoding, callback) {
      if (typeof chunk === 'function') { callback = chunk; chunk = null }
      else if (typeof encoding === 'function') { callback = encoding; encoding = null }
      const writer = this._getWriter()
      const finish = () => writer.close().then(
         () => { this._emit('finish'); this._emit('close'); callback?.() },
         err => { this._emit('error', err); callback?.(err) }
      )
      if (chunk != null) {
         writer.ready.then(() => writer.write(chunk)).then(finish, finish)
      } else {
         finish()
      }
      return this
   }

   proto.destroy = function (err) {
      const writer = this._getWriter()
      if (err) {
         writer.abort(err).catch(() => { })
         this._emit('error', err)
      } else {
         writer.close().catch(() => { })
      }
      this._emit('close')
      return this
   }

   proto.cork = function () { this._corked = (this._corked || 0) + 1 }
   proto.uncork = function () { if (this._corked > 0) this._corked-- }

   proto.setDefaultEncoding = function (encoding) {
      this._defaultEncoding = encoding
      return this
   }
}

// Add Node.js-specific API to W3C TransformStream
{
   const proto = TransformStream.prototype

   proto._emit = function (event, ...args) {
      this._listeners?.[event]?.slice().forEach(fn => fn(...args))
   }

   proto.on = proto.addListener = function (event, fn) {
      this._listeners ??= {}
         ; (this._listeners[event] ??= []).push(fn)
      if (event === 'data') this.readable.on('data', chunk => this._emit('data', chunk))
      return this
   }

   proto.once = function (event, fn) {
      const wrapped = (...args) => { this.off(event, wrapped); fn(...args) }
      return this.on(event, wrapped)
   }

   proto.off = proto.removeListener = function (event, fn) {
      const list = this._listeners?.[event]
      if (list) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
      return this
   }

   proto.write = function (chunk, encoding, callback) {
      return this.writable.write(chunk, encoding, callback)
   }

   proto.end = function (chunk, encoding, callback) {
      return this.writable.end(chunk, encoding, callback)
   }

   proto.pipe = function (dest) {
      return this.readable.pipe(dest)
   }

   proto.pause = function () {
      this.readable.pause()
      return this
   }

   proto.resume = function () {
      this.readable.resume()
      return this
   }

   proto.destroy = function (err) {
      this.readable.destroy(err)
      this.writable.destroy(err)
      return this
   }
}
