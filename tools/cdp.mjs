/* Minimal Chrome DevTools Protocol client over WebSocket (no deps).
   Used by the test harness because the sandbox forbids piped stdio. */
import http from 'node:http';
import { randomBytes } from 'node:crypto';

export class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
    this.events = [];
    this.handlers = new Map();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
  }

  static async connect(port, timeoutMs = 20000) {
    const start = Date.now();
    let target = null;
    while (Date.now() - start < timeoutMs) {
      try {
        const list = await new Promise((resolve, reject) => {
          const req = http.get({ host: '127.0.0.1', port, path: '/json/list' }, res => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
          });
          req.on('error', reject);
          req.setTimeout(1000, () => req.destroy(new Error('timeout')));
        });
        target = list.find(t => t.type === 'page') || list[0];
        if (target) break;
      } catch (e) { /* chrome not ready */ }
      await new Promise(r => setTimeout(r, 200));
    }
    if (!target) throw new Error('no CDP target found');
    const c = new CDP(target.webSocketDebuggerUrl);
    await c.open();
    return c;
  }

  open() {
    return new Promise((resolve, reject) => {
      const u = new URL(this.wsUrl);
      const key = randomBytes(16).toString('base64');
      const req = http.request({
        host: u.hostname, port: u.port, path: u.pathname + u.search,
        headers: {
          Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13',
        },
      });
      req.on('upgrade', (res, socket) => {
        this.socket = socket;
        socket.setNoDelay(true);
        socket.on('data', d => this._onData(d));
        socket.on('close', () => { this.closed = true; });
        socket.on('error', () => { this.closed = true; });
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        len = Number(this.buffer.readBigUInt64BE(2)); off = 10;
      }
      let mask = null;
      if (masked) {
        if (this.buffer.length < off + 4) return;
        mask = this.buffer.slice(off, off + 4); off += 4;
      }
      if (this.buffer.length < off + len) return;
      let payload = this.buffer.slice(off, off + len);
      if (mask) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this.buffer = this.buffer.slice(off + len);
      if (op === 1) {
        try { this._onMessage(JSON.parse(payload.toString('utf8'))); } catch (e) { }
      } else if (op === 8) { this.closed = true; this.socket?.end(); }
      else if (op === 9) { this._frame(0xA, payload); }
    }
  }

  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message + ' ' + (msg.error.data || '')));
      else resolve(msg.result);
    } else if (msg.method) {
      const h = this.handlers.get(msg.method);
      if (h) for (const fn of h) { try { fn(msg.params); } catch (e) { } }
    }
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  _frame(op, payload) {
    if (!this.socket || this.closed) return;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2); header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | op;
    const mask = randomBytes(4);
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(method, params = {}) {
    const id = this.id++;
    const msg = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._frame(0x1, msg);
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 120000);
    });
  }

  /** disable HTTP cache + clear it (dev server sends no-cache anyway) */
  async hardReload() {
    try { await this.send('Network.enable'); } catch (e) { }
    try { await this.send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) { }
    try { await this.send('Network.clearBrowserCache'); } catch (e) { }
  }

  async evaluate(expression, { awaitPromise = true, timeout = 120000 } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true, timeout,
    });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails;
      const desc = ex.exception?.description || ex.text || 'evaluate failed';
      throw new Error(desc.split('\n').slice(0, 6).join('\n'));
    }
    return r.result?.value;
  }

  close() { try { this.socket?.end(); } catch (e) { } }
}
