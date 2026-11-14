'use strict';
/**
 * src/TunnelManager.js
 * Manages WebSocket connections from Android phones with binary framing.
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const { createLogger } = require('./logger');
const { v4: uuidv4 } = require('uuid');
const { FRAME_TYPE, FLAGS, encodeFrame, parseFrame } = require('./MuxProtocol');

const log = createLogger('TunnelManager');

// Store valid tokens (can also allow testing/dev pairing)
const validTokens = new Set(['dev-token']);

function registerToken(token) {
  validTokens.add(token);
}

function consumeToken(token) {
  if (token === 'dev-token') return true;
  if (!validTokens.has(token)) return false;
  validTokens.delete(token);
  return true;
}

class PhoneSession extends EventEmitter {
  constructor(ws, id, clientInfo = {}) {
    super();
    this.ws = ws;
    this.id = id;
    this.name = clientInfo.name || `Phone-${id.substring(0, 4)}`;
    this.authenticated = false;
    this.connectedAt = Date.now();
    this.nextStreamId = 1; // odd for hub initiated
    this._buf = Buffer.alloc(0);
    this._pendingPings = new Map();

    this.stats = {
      bytes_in: 0,
      bytes_out: 0,
      active_connections: 0,
      latency_ms: 15,
    };

    ws.on('message', (data) => this._onRaw(Buffer.isBuffer(data) ? data : Buffer.from(data)));
    ws.on('close', () => this.emit('disconnected'));
    ws.on('error', (err) => {
      log.warn(`Session ${id} WS error:`, err.message);
      this.emit('disconnected');
    });
  }

  _onRaw(chunk) {
    this.stats.bytes_in += chunk.length;
    this._buf = Buffer.concat([this._buf, chunk]);
    this._drain();
  }

  _drain() {
    while (true) {
      if (this._buf.length < 12) break;
      const res = parseFrame(this._buf);
      if (!res) break;
      if (res.error) {
        // Drop 1 byte and re-sync
        this._buf = this._buf.slice(1);
        continue;
      }
      this._buf = res.remaining;
      this._handleFrame(res.frame);
    }
  }

  _handleFrame(frame) {
    switch (frame.type) {
      case FRAME_TYPE.AUTH: {
        const token = frame.payload.toString('utf8').trim();
        if (consumeToken(token)) {
          this.authenticated = true;
          this._send(encodeFrame(FRAME_TYPE.AUTH_OK, 0, 0));
          log.info(`Session ${this.id} (${this.name}): AUTH_OK`);
        } else {
          this._send(encodeFrame(FRAME_TYPE.AUTH_FAIL, 0, 0));
          log.warn(`Session ${this.id}: AUTH_FAIL (invalid token: ${token})`);
          this.ws.close(4001, 'Bad token');
        }
        break;
      }

      case FRAME_TYPE.DATA:
        if (this.authenticated) {
          this.emit('stream_data', frame.streamId, frame.payload);
        }
        break;

      case FRAME_TYPE.FIN:
        if (this.authenticated) {
          this.emit('stream_fin', frame.streamId);
        }
        break;

      case FRAME_TYPE.RST:
        if (this.authenticated) {
          this.emit('stream_rst', frame.streamId);
        }
        break;

      case FRAME_TYPE.PONG: {
        if (frame.payload.length >= 4) {
          const pingNonce = frame.payload.readUInt32BE(0);
          const sentAt = this._pendingPings.get(pingNonce);
          if (sentAt) {
            this.stats.latency_ms = Date.now() - sentAt;
            this._pendingPings.delete(pingNonce);
            this.emit('pong', this.stats.latency_ms);
          }
        }
        break;
      }

      case FRAME_TYPE.STATS: {
        try {
          const statData = JSON.parse(frame.payload.toString('utf8'));
          if (statData.name) this.name = statData.name;
        } catch (_) {}
        break;
      }

      default:
        break;
    }
  }

  _send(buf) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.stats.bytes_out += buf.length;
    this.ws.send(buf);
  }

  openStream(host, port) {
    const streamId = this.nextStreamId;
    this.nextStreamId += 2;
    const target = Buffer.from(`${host}:${port}\0`, 'utf8');
    this._send(encodeFrame(FRAME_TYPE.SYN, FLAGS.SYN, streamId, target));
    this.stats.active_connections++;
    return streamId;
  }

  sendData(streamId, chunk) {
    this._send(encodeFrame(FRAME_TYPE.DATA, FLAGS.NONE, streamId, chunk));
  }

  sendFin(streamId) {
    this._send(encodeFrame(FRAME_TYPE.FIN, FLAGS.FIN, streamId));
    this.stats.active_connections = Math.max(0, this.stats.active_connections - 1);
  }

  sendRst(streamId) {
    this._send(encodeFrame(FRAME_TYPE.RST, FLAGS.NONE, streamId));
    this.stats.active_connections = Math.max(0, this.stats.active_connections - 1);
  }

  ping() {
    const nonce = (this.nextStreamId++ & 0xffffffff) >>> 0;
    const body = Buffer.allocUnsafe(4);
    body.writeUInt32BE(nonce, 0);
    this._pendingPings.set(nonce, Date.now());
    this._send(encodeFrame(FRAME_TYPE.PING, FLAGS.NONE, 0, body));
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Hub shutdown');
    }
  }
}

class TunnelManager extends EventEmitter {
  constructor({ port = 9000 } = {}) {
    super();
    this._port = port;
    this._sessions = new Map();
    this._wss = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this._wss = new WebSocket.Server({ port: this._port, host: '0.0.0.0' });
      this._wss.on('listening', resolve);
      this._wss.on('error', reject);
      this._wss.on('connection', (ws, req) => {
        log.info(`New WS connection from ${req.socket.remoteAddress}`);
        this._onConnection(ws);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      for (const session of this._sessions.values()) {
        session.close();
      }
      this._sessions.clear();
      if (this._wss) {
        this._wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  _onConnection(ws) {
    const id = uuidv4();
    const session = new PhoneSession(ws, id);

    const authTimer = setTimeout(() => {
      if (!session.authenticated) {
        log.warn(`Session ${id}: auth timeout`);
        ws.close(4000, 'Auth timeout');
      }
    }, 10000);

    session.once('disconnected', () => {
      clearTimeout(authTimer);
      this._sessions.delete(id);
      log.info(`Session ${id} disconnected. Active: ${this._sessions.size}`);
      this.emit('session_removed', id);
    });

    const checkInterval = setInterval(() => {
      if (session.authenticated) {
        clearInterval(checkInterval);
        this._sessions.set(id, session);
        log.info(`Session ${id} authenticated and active.`);
        this.emit('session_added', session);
      }
    }, 50);

    session.once('disconnected', () => clearInterval(checkInterval));
  }

  getSessions() {
    return [...this._sessions.values()];
  }

  getSession(id) {
    return this._sessions.get(id);
  }

  getSessionCount() {
    return this._sessions.size;
  }

  static registerToken(token) {
    registerToken(token);
  }

  createTunnel(session, host, port) {
    return new MuxStream(session, host, port);
  }
}

const { Duplex } = require('stream');

class MuxStream extends Duplex {
  constructor(session, host, port) {
    super();
    this._session = session;
    this._streamId = session.openStream(host, port);
    this._closed = false;

    const onData = (sid, chunk) => {
      if (sid === this._streamId) this.push(chunk);
    };
    const onFin = (sid) => {
      if (sid === this._streamId) {
        this.push(null);
        cleanup();
      }
    };
    const onRst = (sid) => {
      if (sid === this._streamId) {
        this.destroy(new Error('Remote reset'));
        cleanup();
      }
    };
    const onDisconnected = () => {
      if (!this._closed) this.destroy(new Error('Phone disconnected'));
      cleanup();
    };

    session.on('stream_data', onData);
    session.on('stream_fin', onFin);
    session.on('stream_rst', onRst);
    session.once('disconnected', onDisconnected);

    const cleanup = () => {
      session.off('stream_data', onData);
      session.off('stream_fin', onFin);
      session.off('stream_rst', onRst);
      session.off('disconnected', onDisconnected);
    };

    this.once('close', () => {
      cleanup();
      this._closed = true;
    });
  }

  _read() {}

  _write(chunk, _enc, cb) {
    if (this._closed) return cb(new Error('Stream closed'));
    this._session.sendData(this._streamId, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    cb();
  }

  _final(cb) {
    if (!this._closed) this._session.sendFin(this._streamId);
    cb();
  }

  _destroy(err, cb) {
    if (!this._closed) {
      this._session.sendRst(this._streamId);
      this._closed = true;
    }
    cb(err);
  }
}

module.exports = TunnelManager;
module.exports.MuxStream = MuxStream;
