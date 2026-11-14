# Multi-Device Network Hub & Cellular Uplink Bonding

A plug-and-play multi-link internet aggregator that turns your PC into a central bonding hub and your Android phones into high-throughput cellular uplink nodes.

```
       ┌────────────────────────────────────────────────────────┐
       │                   PC Hub (Node.js)                     │
       │                                                        │
       │  Local Proxy: 127.0.0.1:1080 (SOCKS5) / :8080 (HTTP)   │
       │  Tunnel Server: ws://0.0.0.0:9000 (Binary Mux)         │
       │  Web Dashboard: http://localhost:5173                  │
       └──────┬──────────────────────┬────────────────────┬─────┘
              │                      │                    │
        [Node 0: Native]       [Phone 1 Node]       [Phone 2 Node]
       Ethernet / Wi-Fi       Cellular 4G/5G       Cellular 4G/5G
              │                      │                    │
              └──────────────┬───────┴────────────────────┘
                             ▼
                     Internet / Uplink
```

---

## Architecture Overview

1. **PC Hub (`pc-hub/`)**
   - **Local Proxies**: Exposes SOCKS5 (`127.0.0.1:1080`) and HTTP CONNECT (`127.0.0.1:8080`) proxies.
   - **Tunnel Server**: Runs a WebSocket server on `0.0.0.0:9000` supporting binary Yamux-style frame multiplexing.
   - **Load Balancer / Router**: Supports `weighted-round-robin`, `least-connections`, and `least-latency` across native PC Ethernet/Wi-Fi and connected cellular devices.
   - **Dashboard API**: Provides real-time bandwidth metrics, uplink weights, and QR pairing generation over REST + WebSocket on `:3001`.

2. **Android Uplink Node (`android-uplink-node/`)**
   - Single-screen Kotlin app with CameraX QR scanner.
   - Persistent `ForegroundService` that binds outbound sockets directly to cellular using `ConnectivityManager.requestNetwork(TRANSPORT_CELLULAR)`.
   - Multiplexed binary stream handler forwarding TCP sockets through the PC hub tunnel without head-of-line blocking.
   - Automated compilation via GitHub Actions (`.github/workflows/build-apk.yml`).

3. **Live Web Dashboard (`dashboard/`)**
   - Built with React 18, TypeScript, Tailwind CSS, and Recharts.
   - Real-time aggregated throughput chart (download & upload).
   - Per-device cards showing active streams, latency, status toggles, and live weight sliders.
   - Instant QR code scanner pairing for fast phone onboarding.

---

## Quick Start

### 1. Run the PC Hub
```bash
cd pc-hub
npm install
npm start
```
The hub starts:
- SOCKS5 Proxy on `127.0.0.1:1080`
- HTTP Proxy on `127.0.0.1:8080`
- Tunnel Server on `0.0.0.0:9000`
- API & Live WS on `127.0.0.1:3001`

### 2. Run the Dashboard
```bash
cd dashboard
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser.

### 3. Build & Install Android APK
You don't need Android Studio installed locally:
1. Push this repository to GitHub.
2. The GitHub Actions workflow (`.github/workflows/build-apk.yml`) triggers automatically and builds `app-debug.apk`.
3. Download the APK artifact from the **Actions** tab on GitHub and install it on any Android phone.

### 4. Pair Your Phones
1. Connect your phone to the same local Wi-Fi / Hotspot / USB as your PC.
2. Open the **Cellular Uplink Node** app on your phone.
3. Tap **Scan Hub QR** and scan the pairing QR code displayed on your PC dashboard.
4. The phone locks onto cellular, connects to the PC hub, and instantly joins the routing pool!

---

## Testing the Proxy
Set your browser or terminal to use the proxy:
```bash
# Using SOCKS5
curl -x socks5h://127.0.0.1:1080 https://ipinfo.io

# Using HTTP Proxy
curl -x http://127.0.0.1:8080 https://ipinfo.io
```
You will see traffic distribute smoothly across your PC's connection and connected phone cellular uplinks!
