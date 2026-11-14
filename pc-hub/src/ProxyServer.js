'use strict';
/**
 * src/ProxyServer.js
 * Implements SOCKS5 and HTTP CONNECT proxy server.
 */

const net = require('net');
const http = require('http');
const { createLogger } = require('./logger');

const log = createLogger('ProxyServer');

class ProxyServer {
  constructor({ router, socksPort = 1080, httpPort = 8080 }) {
    this.router = router;
    this.socksPort = socksPort;
    this.httpPort = httpPort;
    this.socksServer = null;
    this.httpServer = null;
  }

  start() {
    return Promise.all([
      this._startSocks5(),
      this._startHttpConnect(),
    ]);
  }

  stop() {
    return Promise.all([
      new Promise((res) => (this.socksServer ? this.socksServer.close(res) : res())),
      new Promise((res) => (this.httpServer ? this.httpServer.close(res) : res())),
    ]);
  }

  _startSocks5() {
    return new Promise((resolve, reject) => {
      this.socksServer = net.createServer((socket) => {
        this._handleSocksClient(socket);
      });

      this.socksServer.on('error', (err) => {
        log.error('SOCKS5 Server error:', err);
      });

      this.socksServer.listen(this.socksPort, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  _handleSocksClient(clientSocket) {
    let state = 'HANDSHAKE';

    clientSocket.once('data', (chunk) => {
      // SOCKS Version check
      if (chunk[0] !== 0x05) {
        clientSocket.end();
        return;
      }

      // No authentication required (0x05, 0x00)
      clientSocket.write(Buffer.from([0x05, 0x00]));

      clientSocket.once('data', (reqChunk) => {
        if (reqChunk.length < 6 || reqChunk[0] !== 0x05) {
          clientSocket.end();
          return;
        }

        const cmd = reqChunk[1]; // 0x01 = CONNECT
        if (cmd !== 0x01) {
          // Command not supported
          clientSocket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          clientSocket.end();
          return;
        }

        const atyp = reqChunk[3];
        let host = '';
        let portOffset = 4;

        if (atyp === 0x01) {
          // IPv4
          host = `${reqChunk[4]}.${reqChunk[5]}.${reqChunk[6]}.${reqChunk[7]}`;
          portOffset = 8;
        } else if (atyp === 0x03) {
          // Domain
          const domainLen = reqChunk[4];
          host = reqChunk.slice(5, 5 + domainLen).toString('utf8');
          portOffset = 5 + domainLen;
        } else if (atyp === 0x04) {
          // IPv6
          host = reqChunk.slice(4, 20).toString('hex').match(/.{1,4}/g).join(':');
          portOffset = 20;
        } else {
          clientSocket.end();
          return;
        }

        const port = reqChunk.readUInt16BE(portOffset);

        try {
          const upstream = this.router.createOutboundStream(host, port);

          upstream.once('error', (err) => {
            log.warn(`Upstream error connecting to ${host}:${port}:`, err.message);
            // SOCKS error: Host unreachable
            clientSocket.write(Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            clientSocket.end();
          });

          // Success reply
          clientSocket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));

          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);

          clientSocket.on('error', () => upstream.destroy());
          upstream.on('error', () => clientSocket.destroy());
        } catch (err) {
          log.error(`Proxy routing failed for ${host}:${port}:`, err);
          clientSocket.end();
        }
      });
    });
  }

  _startHttpConnect() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Multi-Device Hub HTTP Proxy Active. Use HTTP CONNECT or SOCKS5.\n');
      });

      this.httpServer.on('connect', (req, clientSocket, head) => {
        const [host, portStr] = req.url.split(':');
        const port = parseInt(portStr, 10) || 443;

        try {
          const upstream = this.router.createOutboundStream(host, port);

          upstream.once('error', (err) => {
            log.warn(`HTTP CONNECT upstream error: ${host}:${port}`, err.message);
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            clientSocket.end();
          });

          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head && head.length > 0) {
            upstream.write(head);
          }

          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);

          clientSocket.on('error', () => upstream.destroy());
          upstream.on('error', () => clientSocket.destroy());
        } catch (err) {
          log.error(`HTTP CONNECT failed for ${req.url}:`, err);
          clientSocket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          clientSocket.end();
        }
      });

      this.httpServer.listen(this.httpPort, '127.0.0.1', () => {
        resolve();
      });
    });
  }
}

module.exports = ProxyServer;
