/**
 * Minimal dependency-free RFC 6455 WebSocket client (ws:// only).
 *
 * Enough for the T-to-T chat server protocol: one auth frame plus JSON text
 * messages in both directions. Client frames are masked (mandatory per the
 * RFC); the server's frames are unmasked. Handles text/binary/continuation
 * frames, ping->pong, and close handshake. Emits: open, message(string),
 * binary(Buffer), pong, server-close(code), close, error(Error).
 */
import net from 'node:net'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { URL } from 'node:url'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export class MiniWS extends EventEmitter {
  constructor(urlString) {
    super()
    this.url = new URL(urlString)
    if (this.url.protocol !== 'ws:') throw new Error('MiniWS: unsupported protocol ' + this.url.protocol + ' (only ws://)')
    this.socket = null
    this.isOpen = false
    this._buf = Buffer.alloc(0)
    this._fragments = []
    this._fragOp = null
    this._closed = false
    this._dead = false
  }

  /**
   * Connect and perform the handshake.
   * @returns {Promise<void>} resolves on open, rejects on handshake/network failure.
   */
  connect() {
    const host = this.url.hostname
    const port = this.url.port ? Number(this.url.port) : 80
    const target = (this.url.pathname + this.url.search) || '/'
    const key = crypto.randomBytes(16).toString('base64')
    const request = [
      'GET ' + target + ' HTTP/1.1',
      'Host: ' + host + ':' + port,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: ' + key,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n')

    const socket = net.connect({ host, port, timeout: 8000 })
    this.socket = socket
    socket.setNoDelay(true)
    let handshakeDone = false
    let headerBuf = Buffer.alloc(0)

    socket.on('timeout', () => {
      if (!handshakeDone) this._fail(new Error('ws connect timeout'))
    })

    socket.on('data', (chunk) => {
      if (!handshakeDone) {
        headerBuf = Buffer.concat([headerBuf, chunk])
        const idx = headerBuf.indexOf('\r\n\r\n')
        if (idx === -1) return
        const head = headerBuf.slice(0, idx).toString('latin1')
        const rest = headerBuf.slice(idx + 4)
        if (!/^HTTP\/1\.[01]\s+101/m.test(head)) {
          this._fail(new Error('ws handshake rejected: ' + head.split('\r\n')[0]))
          return
        }
        const expected = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
        const acceptLine = head.split('\r\n').find((l) => l.toLowerCase().startsWith('sec-websocket-accept:'))
        const acceptValue = acceptLine ? acceptLine.slice(acceptLine.indexOf(':') + 1).trim() : ''
        if (acceptValue !== expected) {
          this._fail(new Error('ws handshake: bad Sec-WebSocket-Accept'))
          return
        }
        handshakeDone = true
        this.isOpen = true
        this.emit('open')
        if (rest.length > 0) this._feed(rest)
      } else {
        this._feed(chunk)
      }
    })

    socket.on('error', (err) => {
      if (!this._closed && !this._dead) this.emit('error', err)
    })
    socket.on('close', () => this._shutdown())
    socket.write(request)

    return new Promise((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve() }
      const onError = (err) => { cleanup(); reject(err) }
      const cleanup = () => {
        this.removeListener('open', onOpen)
        this.removeListener('error', onError)
      }
      this.once('open', onOpen)
      this.once('error', onError)
    })
  }

  _fail(err) {
    if (this._closed) return
    this._closed = true
    try { this.socket && this.socket.destroy() } catch { /* already gone */ }
    this.emit('error', err)
    this._shutdown()
  }

  _shutdown() {
    if (this._dead) return
    this._dead = true
    this.isOpen = false
    this.emit('close')
  }

  _feed(chunk) {
    this._buf = Buffer.concat([this._buf, chunk])
    for (;;) {
      const frame = this._tryParseFrame()
      if (frame === null) return
      this._handleFrame(frame)
    }
  }

  _tryParseFrame() {
    const b = this._buf
    if (b.length < 2) return null
    const fin = (b[0] & 0x80) !== 0
    const opcode = b[0] & 0x0f
    const masked = (b[1] & 0x80) !== 0
    let len = b[1] & 0x7f
    let offset = 2
    if (len === 126) {
      if (b.length < 4) return null
      len = b.readUInt16BE(2)
      offset = 4
    } else if (len === 127) {
      if (b.length < 10) return null
      len = Number(b.readBigUInt64BE(2))
      offset = 10
    }
    if (b.length < offset + len) return null
    let payload = b.subarray(offset, offset + len)
    this._buf = b.subarray(offset + len)
    if (masked) {
      const mask = payload.subarray(0, 4)
      const unmasked = Buffer.from(payload)
      for (let i = 4; i < unmasked.length; i += 1) unmasked[i] ^= mask[i % 4]
      payload = unmasked.subarray(4)
    }
    return { fin, opcode, payload: Buffer.from(payload) }
  }

  _handleFrame({ fin, opcode, payload }) {
    if (opcode === 0x8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000
      this.emit('server-close', code)
      try { this._sendFrame(0x8, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0)) } catch { /* ignore */ }
      this.socket && this.socket.destroy()
      return
    }
    if (opcode === 0x9) {
      this._sendFrame(0xa, payload)
      return
    }
    if (opcode === 0xa) {
      this.emit('pong')
      return
    }
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      if (opcode !== 0x0) {
        this._fragOp = opcode
        this._fragments = []
      }
      this._fragments.push(payload)
      if (fin) {
        const full = Buffer.concat(this._fragments)
        const op = this._fragOp !== null ? this._fragOp : opcode
        this._fragments = []
        this._fragOp = null
        if (op === 0x1) this.emit('message', full.toString('utf8'))
        else if (op === 0x2) this.emit('binary', full)
      }
    }
  }

  _sendFrame(opcode, payload) {
    if (!this.isOpen || !this.socket || this.socket.destroyed) throw new Error('ws is not open')
    const mask = crypto.randomBytes(4)
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | len])
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    const masked = Buffer.from(payload)
    for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4]
    this.socket.write(Buffer.concat([header, mask, masked]))
  }

  /** Send one text message (an object is JSON-serialized). */
  send(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    this._sendFrame(0x1, Buffer.from(text, 'utf8'))
  }

  close() {
    if (this._closed) return
    this._closed = true
    try {
      if (this.isOpen) this._sendFrame(0x8, Buffer.from([0x03, 0xe8]))
    } catch { /* ignore */ }
    this.socket && this.socket.destroy()
  }
}
