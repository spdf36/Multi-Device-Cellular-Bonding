'use strict';
/**
 * src/index.js
 * Entry point – boots all services in dependency order and wires them together.
 */

require('dotenv').config();

const { createLogger } = require('./logger');
const TunnelManager   = require('./TunnelManager');
const Router          = require('./Router');
const ProxyServer     = require('./ProxyServer');
const ApiServer       = require('./ApiServer');
const StatsCollector  = require('./StatsCollector');

const log = createLogger('main');

const HUB_WS_PORT  = parseInt(process.env.HUB_WS_PORT  || '9000', 10);
const SOCKS_PORT   = parseInt(process.env.SOCKS_PORT   || '1080', 10);
const PROXY_PORT   = parseInt(process.env.PROXY_PORT   || '8080', 10);
const API_PORT     = parseInt(process.env.PORT          || '3001', 10);
const STRATEGY     = process.env.BALANCE_STRATEGY || 'least-connections';

async function main() {
  log.info('=== PC-Hub starting ===');

  // 1. TunnelManager – manages phone WebSocket connections
  const tunnelManager = new TunnelManager({ port: HUB_WS_PORT });
  await tunnelManager.start();
  log.info(`TunnelManager listening on ws://0.0.0.0:${HUB_WS_PORT}`);

  // 2. Router – traffic balancing across all uplinks
  const router = new Router({ strategy: STRATEGY, tunnelManager });
  router.start();
  log.info(`Router started (strategy: ${STRATEGY})`);

  // 3. ProxyServer – SOCKS5 + HTTP CONNECT
  const proxyServer = new ProxyServer({ router, socksPort: SOCKS_PORT, httpPort: PROXY_PORT });
  await proxyServer.start();
  log.info(`SOCKS5  proxy listening on 127.0.0.1:${SOCKS_PORT}`);
  log.info(`HTTP    proxy listening on 127.0.0.1:${PROXY_PORT}`);

  // 4. StatsCollector – aggregates metrics every 500ms
  const statsCollector = new StatsCollector({ router });
  statsCollector.start();

  // 5. ApiServer – REST + WebSocket dashboard
  const apiServer = new ApiServer({ port: API_PORT, router, tunnelManager, statsCollector });
  await apiServer.start();
  log.info(`API     server listening on http://127.0.0.1:${API_PORT}`);

  log.info('=== PC-Hub ready ===');

  // Graceful shutdown
  const shutdown = async (signal) => {
    log.info(`Received ${signal}, shutting down…`);
    statsCollector.stop();
    router.stop();
    await proxyServer.stop();
    await apiServer.stop();
    await tunnelManager.stop();
    log.info('Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection:', reason);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
