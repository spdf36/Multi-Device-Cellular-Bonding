package com.uplink.node

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Binder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class TunnelService : Service() {

    private val binder = TunnelBinder()
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var connectivityManager: ConnectivityManager? = null
    private var cellularNetwork: Network? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private var okHttpClient: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var currentHubUrl: String = ""

    private val streamMultiplexer = MuxProtocol.StreamMultiplexer()
    private val frameDecoder = MuxProtocol.FrameDecoder()
    private val activeTcpSockets = ConcurrentHashMap<Int, Socket>()

    private var bytesSent = 0L
    private var bytesReceived = 0L
    private var lastLatencyMs = -1L
    private var connectionState = "IDLE"

    inner class TunnelBinder : Binder() {
        fun getService(): TunnelService = this@TunnelService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val url = intent.getStringExtra(EXTRA_HUB_URL) ?: ""
                if (url.isNotBlank()) {
                    currentHubUrl = url
                    startForeground(NOTIFICATION_ID, buildNotification("Connecting to hub..."))
                    isRunning = true
                    requestCellularNetworkAndConnect()
                }
            }
            ACTION_STOP -> {
                stopTunnel()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    private fun requestCellularNetworkAndConnect() {
        updateState("ACQUIRING_CELLULAR")

        val builder = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                cellularNetwork = network
                updateState("CELLULAR_ACQUIRED")
                connectWebSocket(network)
            }

            override fun onLost(network: Network) {
                if (cellularNetwork == network) {
                    cellularNetwork = null
                    updateState("CELLULAR_LOST")
                }
            }
        }

        try {
            connectivityManager?.requestNetwork(builder.build(), networkCallback!!)
        } catch (e: Exception) {
            updateState("ERROR_REQUEST_NETWORK")
        }
    }

    private fun connectWebSocket(network: Network) {
        updateState("CONNECTING")

        // Build OkHttpClient bound to cellular network socket factory
        val clientBuilder = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .socketFactory(network.socketFactory)

        okHttpClient = clientBuilder.build()

        // Parse ws or http schema from hub URL or JSON payload
        var targetWsUrl = currentHubUrl
        var authToken: String? = null

        if (currentHubUrl.startsWith("{")) {
            try {
                val json = JSONObject(currentHubUrl)
                val ip = json.optString("hub_ip", "127.0.0.1")
                val port = json.optInt("port", 9000)
                authToken = json.optString("token", "")
                targetWsUrl = "ws://$ip:$port"
            } catch (e: Exception) {
                // Ignore fallback to raw string
            }
        }

        if (!targetWsUrl.startsWith("ws://") && !targetWsUrl.startsWith("wss://")) {
            targetWsUrl = "ws://$targetWsUrl"
        }

        val request = Request.Builder().url(targetWsUrl).build()

        webSocket = okHttpClient?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                updateState("CONNECTED")

                // If auth token was found in QR payload, authenticate immediately
                if (!authToken.isNullOrEmpty()) {
                    val authPayload = authToken.toByteArray(Charsets.UTF_8)
                    val authFrame = MuxProtocol.Frame(
                        type = 0x07, // AUTH
                        flags = 0,
                        streamId = 0,
                        payload = authPayload
                    )
                    sendFrame(authFrame)
                }

                startPeriodicStatsBroadcast()
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                val byteArray = bytes.toByteArray()
                bytesReceived += byteArray.size

                val frames = synchronized(frameDecoder) {
                    frameDecoder.feed(byteArray)
                }

                for (frame in frames) {
                    handleIncomingFrame(frame)
                }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                updateState("CLOSING")
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                updateState("DISCONNECTED")
                cleanupSockets()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                updateState("ERROR: ${t.message}")
                cleanupSockets()
            }
        })
    }

    private fun handleIncomingFrame(frame: MuxProtocol.Frame) {
        when (frame.type) {
            MuxProtocol.FrameType.SYN -> {
                // Remote PC wants to open a target host:port stream via this phone's cellular modem
                val targetStr = String(frame.payload, Charsets.UTF_8).trimEnd('\u0000')
                openCellularTcpStream(frame.streamId, targetStr)
            }
            MuxProtocol.FrameType.DATA -> {
                // Forward payload to TCP socket
                serviceScope.launch {
                    val socket = activeTcpSockets[frame.streamId]
                    try {
                        socket?.getOutputStream()?.apply {
                            write(frame.payload)
                            flush()
                        }
                    } catch (e: Exception) {
                        closeStream(frame.streamId)
                    }
                }
            }
            MuxProtocol.FrameType.FIN -> {
                closeStream(frame.streamId)
            }
            MuxProtocol.FrameType.RST -> {
                closeStream(frame.streamId)
            }
            MuxProtocol.FrameType.PING -> {
                // Reply with PONG frame mirroring payload
                val pongFrame = MuxProtocol.Frame(
                    type = MuxProtocol.FrameType.PONG,
                    flags = MuxProtocol.FLAG_ACK,
                    streamId = frame.streamId,
                    payload = frame.payload
                )
                sendFrame(pongFrame)
            }
            MuxProtocol.FrameType.PONG -> {
                // Ping reply
                if (frame.payload.size >= 8) {
                    val sentTime = ByteBuffer.wrap(frame.payload).long
                    lastLatencyMs = System.currentTimeMillis() - sentTime
                }
            }
        }
    }

    private fun openCellularTcpStream(streamId: Int, target: String) {
        serviceScope.launch {
            try {
                val parts = target.split(":")
                val host = parts[0]
                val port = parts.getOrNull(1)?.toIntOrNull() ?: 80

                // Create socket bound to cellular network
                val socket = cellularNetwork?.socketFactory?.createSocket() ?: Socket()
                socket.connect(InetSocketAddress(host, port), 10000)

                activeTcpSockets[streamId] = socket
                streamMultiplexer.dispatch(MuxProtocol.Frame.syn(streamId))

                // Start read loop from cellular TCP socket -> WebSocket Mux
                val inStream: InputStream = socket.getInputStream()
                val buffer = ByteArray(8192)

                while (isActive && activeTcpSockets.containsKey(streamId)) {
                    val read = inStream.read(buffer)
                    if (read == -1) break
                    val chunk = buffer.copyOf(read)
                    val dataFrame = MuxProtocol.Frame.data(streamId, chunk)
                    sendFrame(dataFrame)
                }

                closeStream(streamId)
            } catch (e: Exception) {
                val rstFrame = MuxProtocol.Frame.rst(streamId)
                sendFrame(rstFrame)
                closeStream(streamId)
            }
        }
    }

    private fun sendFrame(frame: MuxProtocol.Frame) {
        val encoded = frame.encode()
        bytesSent += encoded.size
        webSocket?.send(encoded.toByteString())
    }

    private fun closeStream(streamId: Int) {
        activeTcpSockets.remove(streamId)?.let { socket ->
            try {
                socket.close()
            } catch (_: Exception) {}
        }
        val finFrame = MuxProtocol.Frame.fin(streamId)
        sendFrame(finFrame)
        streamMultiplexer.closeStream(streamId)
    }

    private fun cleanupSockets() {
        activeTcpSockets.forEach { (_, socket) ->
            try {
                socket.close()
            } catch (_: Exception) {}
        }
        activeTcpSockets.clear()
        streamMultiplexer.closeAll()
    }

    private fun startPeriodicStatsBroadcast() {
        serviceScope.launch {
            while (isActive && connectionState == "CONNECTED") {
                delay(1000)
                broadcastStats()
            }
        }
    }

    private fun broadcastStats() {
        val intent = Intent(ACTION_STATUS_UPDATE).apply {
            putExtra(EXTRA_STATE, connectionState)
            putExtra(EXTRA_BYTES_SENT, bytesSent)
            putExtra(EXTRA_BYTES_RECV, bytesReceived)
            putExtra(EXTRA_ACTIVE_STREAMS, activeTcpSockets.size)
            putExtra(EXTRA_LATENCY_MS, lastLatencyMs)
        }
        sendBroadcast(intent)
    }

    private fun updateState(newState: String) {
        connectionState = newState
        broadcastStats()
    }

    private fun stopTunnel() {
        isRunning = false
        updateState("STOPPED")
        try {
            webSocket?.close(1000, "Client disconnect")
            networkCallback?.let { connectivityManager?.unregisterNetworkCallback(it) }
        } catch (_: Exception) {}
        cleanupSockets()
        serviceScope.cancel()
    }

    override fun onDestroy() {
        stopTunnel()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Cellular Uplink Node",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Uplink Node Active")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentIntent(pendingIntent)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "cellular_uplink_channel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START = "com.uplink.node.ACTION_START"
        const val ACTION_STOP = "com.uplink.node.ACTION_STOP"
        const val ACTION_STATUS_UPDATE = "com.uplink.node.ACTION_STATUS_UPDATE"

        const val EXTRA_HUB_URL = "extra_hub_url"
        const val EXTRA_STATE = "extra_state"
        const val EXTRA_BYTES_SENT = "extra_bytes_sent"
        const val EXTRA_BYTES_RECV = "extra_bytes_recv"
        const val EXTRA_ACTIVE_STREAMS = "extra_active_streams"
        const val EXTRA_LATENCY_MS = "extra_latency_ms"

        @Volatile
        var isRunning = false
    }
}
