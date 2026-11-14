'use strict';
/**
 * src/StatsCollector.js
 * Gathers bandwidth usage, speed, latency, active stream counts and maintains history.
 */

const EventEmitter = require('events');

class StatsCollector extends EventEmitter {
  constructor({ router }) {
    super();
    this.router = router;
    this._interval = null;
    this.lastSampleTime = Date.now();
    this.lastUplinkBytes = new Map(); // id -> { bytes_in, bytes_out }
    this.currentMetrics = {
      timestamp: Date.now(),
      total_speed_down_kbps: 0,
      total_speed_up_kbps: 0,
      total_active_connections: 0,
      uplinks: [],
    };
  }

  start() {
    this._interval = setInterval(() => this._collect(), 500);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _collect() {
    const now = Date.now();
    const durationSec = Math.max(0.1, (now - this.lastSampleTime) / 1000);
    this.lastSampleTime = now;

    const uplinks = this.router.getUplinks();
    let totalDownBytes = 0;
    let totalUpBytes = 0;
    let totalActive = 0;

    const formattedUplinks = uplinks.map((u) => {
      const prev = this.lastUplinkBytes.get(u.id) || { bytes_in: u.stats.bytes_in, bytes_out: u.stats.bytes_out };

      const diffIn = Math.max(0, u.stats.bytes_in - prev.bytes_in);
      const diffOut = Math.max(0, u.stats.bytes_out - prev.bytes_out);

      this.lastUplinkBytes.set(u.id, { bytes_in: u.stats.bytes_in, bytes_out: u.stats.bytes_out });

      const speedDownKbps = Math.round((diffIn * 8) / (durationSec * 1024));
      const speedUpKbps = Math.round((diffOut * 8) / (durationSec * 1024));

      totalDownBytes += diffIn;
      totalUpBytes += diffOut;
      totalActive += u.stats.active_connections;

      return {
        id: u.id,
        name: u.name,
        type: u.type,
        enabled: u.enabled,
        weight: u.weight,
        active_connections: u.stats.active_connections,
        latency_ms: u.stats.latency_ms || 0,
        bytes_in: u.stats.bytes_in,
        bytes_out: u.stats.bytes_out,
        speed_down_kbps: speedDownKbps,
        speed_up_kbps: speedUpKbps,
      };
    });

    this.currentMetrics = {
      timestamp: now,
      total_speed_down_kbps: Math.round((totalDownBytes * 8) / (durationSec * 1024)),
      total_speed_up_kbps: Math.round((totalUpBytes * 8) / (durationSec * 1024)),
      total_active_connections: totalActive,
      uplinks: formattedUplinks,
    };

    this.emit('metrics', this.currentMetrics);
  }

  getLatestMetrics() {
    return this.currentMetrics;
  }
}

module.exports = StatsCollector;
