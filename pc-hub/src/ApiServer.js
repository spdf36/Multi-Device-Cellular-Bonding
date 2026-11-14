'use strict';
/**
 * src/ApiServer.js
 * Express REST API + WebSocket Server on port 3001 for React Dashboard.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const QRGenerator = require('./QRGenerator');
const { createLogger } = require('./logger');

const log = createLogger('ApiServer');

class ApiServer {
  constructor({ port = 3001, router, tunnelManager, statsCollector }) {
    this.port = port;
    this.router = router;
    this.tunnelManager = tunnelManager;
    this.statsCollector = statsCollector;
    this.app = express();
    this.server = null;
    this.wss = null;

    this.currentPairing = null;
    this._setupRoutes();
  }

  _setupRoutes() {
    this.app.use(cors());
    this.app.use(express.json());

    // GET /api/status - overall hub status
    this.app.get('/api/status', (req, res) => {
      const metrics = this.statsCollector.getLatestMetrics();
      res.json({
        success: true,
        data: metrics,
      });
    });

    // GET /api/qr - get or regenerate QR pairing code
    this.app.get('/api/qr', async (req, res) => {
      try {
        if (!this.currentPairing || req.query.refresh === 'true') {
          const info = await QRGenerator.generatePairingInfo(9000);
          this.tunnelManager.constructor.registerToken(info.token);
          this.currentPairing = info;
        }
        res.json({
          success: true,
          data: this.currentPairing,
        });
      } catch (err) {
        log.error('Failed generating QR code:', err);
        res.status(500).json({ error: 'Failed to generate QR pairing info' });
      }
    });

    // POST /api/uplink/:id/weight - update weight
    this.app.post('/api/uplink/:id/weight', (req, res) => {
      const { id } = req.params;
      const { weight } = req.body;
      const updated = this.router.setWeight(id, weight);
      res.json({ success: true, uplink: id, config: updated });
    });

    // POST /api/uplink/:id/toggle - toggle enabled state
    this.app.post('/api/uplink/:id/toggle', (req, res) => {
      const { id } = req.params;
      const { enabled } = req.body;
      const updated = this.router.toggleUplink(id, enabled);
      res.json({ success: true, uplink: id, config: updated });
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer(this.app);

      // WebSocket endpoint on /api/ws
      this.wss = new WebSocket.Server({ server: this.server, path: '/api/ws' });

      this.wss.on('connection', (ws) => {
        log.info('Dashboard connected to real-time stats WS');
        ws.send(JSON.stringify({ type: 'welcome', data: this.statsCollector.getLatestMetrics() }));

        const metricsHandler = (metrics) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'metrics', data: metrics }));
          }
        };

        this.statsCollector.on('metrics', metricsHandler);

        ws.on('close', () => {
          this.statsCollector.off('metrics', metricsHandler);
        });
      });

      this.server.listen(this.port, () => {
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close();
      }
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}

module.exports = ApiServer;
