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
  
  // Prefer standard Wi-Fi or Ethernet interfaces over VPN/virtual adapters
  for (const name of Object.keys(interfaces)) {
    if (/wi-fi|wlan|ethernet/i.test(name)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }

  // Fallback to any non-internal IPv4 that isn't Tailscale/Docker (100.x or 172.x)
  for (const name of Object.keys(interfaces)) {
    if (/tailscale|docker|vethernet|hyper-v/i.test(name)) continue;
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  // Final fallback
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  return '192.168.1.34';
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
