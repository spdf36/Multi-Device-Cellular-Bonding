'use strict';
/**
 * src/Router.js
 * Balances traffic across local network interfaces (Wi-Fi/Ethernet) and connected phones.
 */

const net = require('net');
const EventEmitter = require('events');
const { createLogger } = require('./logger');

const log = createLogger('Router');

class Router extends EventEmitter {
  constructor({ strategy = 'least-connections', tunnelManager } = {}) {
    super();
    this.strategy = strategy;
    this.tunnelManager = tunnelManager;
    this._pingInterval = null;

    // Node 0: Native PC network connection (Ethernet / native Wi-Fi)
    this.localUplink = {
      id: 'local-nic',
      name: 'PC Local NIC (Ethernet / Wi-Fi)',
      type: 'native',
      enabled: true,
      weight: 10,
      stats: {
        bytes_in: 0,
        bytes_out: 0,
        active_connections: 0,
        latency_ms: 5,
      },
      createConnection: (host, port) => {
        const socket = net.createConnection({ host, port });
        this.localUplink.stats.active_connections++;
        socket.on('data', (chunk) => {
          this.localUplink.stats.bytes_in += chunk.length;
        });
        const origWrite = socket.write.bind(socket);
        socket.write = (chunk, enc, cb) => {
          this.localUplink.stats.bytes_out += (chunk ? chunk.length : 0);
          return origWrite(chunk, enc, cb);
        };
        const cleanup = () => {
          this.localUplink.stats.active_connections = Math.max(0, this.localUplink.stats.active_connections - 1);
        };
        socket.once('close', cleanup);
        socket.once('error', cleanup);
        return socket;
      },
    };

    // Uplinks map: id -> config
    this.uplinkConfigs = new Map();
    this.uplinkConfigs.set(this.localUplink.id, {
      enabled: true,
      weight: 10,
    });

    this.roundRobinIndex = 0;
  }

  start() {
    this._pingInterval = setInterval(() => {
      const sessions = this.tunnelManager.getSessions();
      for (const session of sessions) {
        if (session.authenticated) {
          session.ping();
        }
      }
    }, 2000);
  }

  stop() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  getUplinks() {
    const list = [];
    const localCfg = this.uplinkConfigs.get(this.localUplink.id) || { enabled: true, weight: 10 };
    list.push({
      id: this.localUplink.id,
      name: this.localUplink.name,
      type: 'native',
      enabled: localCfg.enabled,
      weight: localCfg.weight,
      stats: { ...this.localUplink.stats },
    });

    const sessions = this.tunnelManager.getSessions();
    for (const s of sessions) {
      const cfg = this.uplinkConfigs.get(s.id) || { enabled: true, weight: 10 };
      list.push({
        id: s.id,
        name: s.name,
        type: 'phone',
        authenticated: s.authenticated,
        enabled: cfg.enabled,
        weight: cfg.weight,
        stats: { ...s.stats },
      });
    }

    return list;
  }

  setWeight(id, weight) {
    const cfg = this.uplinkConfigs.get(id) || { enabled: true, weight: 10 };
    cfg.weight = Math.max(1, Math.min(100, parseInt(weight, 10) || 10));
    this.uplinkConfigs.set(id, cfg);
    return cfg;
  }

  toggleUplink(id, enabled) {
    const cfg = this.uplinkConfigs.get(id) || { enabled: true, weight: 10 };
    cfg.enabled = enabled !== undefined ? !!enabled : !cfg.enabled;
    this.uplinkConfigs.set(id, cfg);
    return cfg;
  }

  selectUplink() {
    const candidates = [];

    // Local NIC candidate
    const localCfg = this.uplinkConfigs.get(this.localUplink.id) || { enabled: true, weight: 10 };
    if (localCfg.enabled) {
      candidates.push({
        id: this.localUplink.id,
        weight: localCfg.weight,
        active: this.localUplink.stats.active_connections,
        latency: this.localUplink.stats.latency_ms || 5,
        createStream: (host, port) => this.localUplink.createConnection(host, port),
      });
    }

    // Phone candidates
    const sessions = this.tunnelManager.getSessions();
    for (const session of sessions) {
      if (!session.authenticated) continue;
      const cfg = this.uplinkConfigs.get(session.id) || { enabled: true, weight: 10 };
      if (!cfg.enabled) continue;

      candidates.push({
        id: session.id,
        weight: cfg.weight,
        active: session.stats.active_connections,
        latency: session.stats.latency_ms || 40,
        createStream: (host, port) => this.tunnelManager.createTunnel(session, host, port),
      });
    }

    if (candidates.length === 0) {
      // Fallback directly to local NIC even if disabled
      return {
        id: this.localUplink.id,
        createStream: (host, port) => this.localUplink.createConnection(host, port),
      };
    }

    if (this.strategy === 'least-connections') {
      candidates.sort((a, b) => (a.active / (a.weight || 1)) - (b.active / (b.weight || 1)));
      return candidates[0];
    } else if (this.strategy === 'least-latency') {
      candidates.sort((a, b) => a.latency - b.latency);
      return candidates[0];
    } else {
      // Weighted Round-Robin
      const pool = [];
      for (const c of candidates) {
        for (let i = 0; i < (c.weight || 1); i++) {
          pool.push(c);
        }
      }
      this.roundRobinIndex = (this.roundRobinIndex + 1) % pool.length;
      return pool[this.roundRobinIndex];
    }
  }

  createOutboundStream(host, port) {
    const selected = this.selectUplink();
    log.debug(`Routing target ${host}:${port} through uplink: ${selected.id}`);
    return selected.createStream(host, port);
  }
}

module.exports = Router;
