'use strict';
/**
 * src/QRGenerator.js
 * Automatically detects LAN IP and generates pairing QR code SVG/DataURL.
 */

const os = require('os');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4, not internal loopback
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

class QRGenerator {
  static async generatePairingInfo(port = 9000) {
    const ip = getLocalIp();
    const token = uuidv4().substring(0, 8);

    const payload = JSON.stringify({
      hub_ip: ip,
      port: port,
      token: token,
    });

    const qrSvg = await QRCode.toString(payload, {
      type: 'svg',
      margin: 2,
      color: {
        dark: '#00f0ff',
        light: '#0a0d14',
      },
    });

    const qrDataUrl = await QRCode.toDataURL(payload, {
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    return {
      ip,
      port,
      token,
      payload,
      qrSvg,
      qrDataUrl,
    };
  }
}

module.exports = QRGenerator;
