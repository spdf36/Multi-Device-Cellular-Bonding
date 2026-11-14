package com.uplink.node

import android.Manifest
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.uplink.node.databinding.ActivityMainBinding
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.text.DecimalFormat

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    // Service binding
    private var tunnelService: TunnelService? = null
    private var serviceBound = false

    // Stats update job
    private val df = DecimalFormat("#,##0.0")

    // ---- Permission Launchers ----------------------------------------------------------------

    private val cameraPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) launchQrScanner()
        else showToast(getString(R.string.perm_camera_denied))
    }

    private val notificationPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* result handled silently */ }

    // ---- QR Result Launcher -----------------------------------------------------------------

    private val qrScanLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val hubUrl = result.data?.getStringExtra(QRScanActivity.EXTRA_HUB_URL)
            if (!hubUrl.isNullOrBlank()) {
                binding.tvHubUrl.text = hubUrl
                startTunnelService(hubUrl)
            }
        }
    }

    // ---- Service Connection ------------------------------------------------------------------

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? TunnelService.TunnelBinder
            tunnelService = binder?.getService()
            serviceBound = true
            updateButtonState()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            tunnelService = null
            serviceBound = false
        }
    }

    // ---- Broadcast Receiver for Stats --------------------------------------------------------

    private val statsReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent ?: return
            when (intent.action) {
                TunnelService.ACTION_STATUS_UPDATE -> {
                    val state = intent.getStringExtra(TunnelService.EXTRA_STATE) ?: "IDLE"
                    val bytesSent = intent.getLongExtra(TunnelService.EXTRA_BYTES_SENT, 0L)
                    val bytesRecv = intent.getLongExtra(TunnelService.EXTRA_BYTES_RECV, 0L)
                    val streams = intent.getIntExtra(TunnelService.EXTRA_ACTIVE_STREAMS, 0)
                    val latencyMs = intent.getLongExtra(TunnelService.EXTRA_LATENCY_MS, -1L)
                    updateStats(state, bytesSent, bytesRecv, streams, latencyMs)
                }
            }
        }
    }

    // ---- Lifecycle ---------------------------------------------------------------------------

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupToolbar()
        setupClickListeners()
        requestNotificationPermission()
        startStatsPolling()
    }

    override fun onStart() {
        super.onStart()
        // Bind to running service if it exists
        val intent = Intent(this, TunnelService::class.java)
        bindService(intent, serviceConnection, 0) // 0 = don't auto-create
    }

    override fun onStop() {
        super.onStop()
        if (serviceBound) {
            unbindService(serviceConnection)
            serviceBound = false
        }
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter(TunnelService.ACTION_STATUS_UPDATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(statsReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(statsReceiver, filter)
        }
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(statsReceiver)
    }

    // ---- Setup -------------------------------------------------------------------------------

    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
        supportActionBar?.title = getString(R.string.app_name)
    }

    private fun setupClickListeners() {
        binding.btnScanQr.setOnClickListener {
            checkCameraAndScan()
        }

        binding.btnToggleTunnel.setOnClickListener {
            if (TunnelService.isRunning) {
                stopTunnelService()
            } else {
                val url = binding.tvHubUrl.text.toString()
                if (url.isBlank() || url == getString(R.string.no_hub_configured)) {
                    showToast(getString(R.string.scan_qr_first))
                } else {
                    startTunnelService(url)
                }
            }
        }
    }

    private fun startStatsPolling() {
        lifecycleScope.launch {
            while (isActive) {
                delay(1000)
                if (!TunnelService.isRunning) {
                    updateUiForIdleState()
                }
            }
        }
    }

    // ---- QR Scanning -------------------------------------------------------------------------

    private fun checkCameraAndScan() {
        when {
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED -> launchQrScanner()

            shouldShowRequestPermissionRationale(Manifest.permission.CAMERA) -> {
                showToast(getString(R.string.perm_camera_rationale))
                cameraPermLauncher.launch(Manifest.permission.CAMERA)
            }

            else -> cameraPermLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun launchQrScanner() {
        val intent = Intent(this, QRScanActivity::class.java)
        qrScanLauncher.launch(intent)
    }

    // ---- Service Control ---------------------------------------------------------------------

    private fun startTunnelService(hubUrl: String) {
        val intent = Intent(this, TunnelService::class.java).apply {
            action = TunnelService.ACTION_START
            putExtra(TunnelService.EXTRA_HUB_URL, hubUrl)
        }
        ContextCompat.startForegroundService(this, intent)
        // Bind after a moment
        lifecycleScope.launch {
            delay(500)
            bindService(
                Intent(this@MainActivity, TunnelService::class.java),
                serviceConnection,
                0
            )
        }
        updateButtonState(running = true)
    }

    private fun stopTunnelService() {
        val intent = Intent(this, TunnelService::class.java).apply {
            action = TunnelService.ACTION_STOP
        }
        startService(intent)
        updateButtonState(running = false)
        updateUiForIdleState()
    }

    // ---- UI Updates --------------------------------------------------------------------------

    private fun updateButtonState(running: Boolean = TunnelService.isRunning) {
        runOnUiThread {
            binding.btnToggleTunnel.text = if (running)
                getString(R.string.stop_tunnel)
            else
                getString(R.string.start_tunnel)

            binding.btnToggleTunnel.setIconResource(
                if (running) R.drawable.ic_stop else R.drawable.ic_play
            )

            val colorRes = if (running) R.color.status_connected else R.color.status_idle
            binding.statusIndicator.setBackgroundColor(
                ContextCompat.getColor(this, colorRes)
            )
        }
    }

    private fun updateStats(
        state: String,
        bytesSent: Long,
        bytesRecv: Long,
        activeStreams: Int,
        latencyMs: Long
    ) {
        runOnUiThread {
            binding.tvConnectionState.text = state
            binding.tvBytesSent.text = formatBytes(bytesSent)
            binding.tvBytesReceived.text = formatBytes(bytesRecv)
            binding.tvActiveStreams.text = activeStreams.toString()

            binding.tvLatency.text = if (latencyMs >= 0) "${latencyMs}ms" else "--"

            val isConnected = state == "CONNECTED"
            updateButtonState(running = TunnelService.isRunning)

            val colorRes = when (state) {
                "CONNECTED" -> R.color.status_connected
                "CONNECTING" -> R.color.status_connecting
                "RECONNECTING" -> R.color.status_connecting
                else -> R.color.status_idle
            }
            binding.statusIndicator.setBackgroundColor(
                ContextCompat.getColor(this, colorRes)
            )

            binding.statsCard.visibility = if (TunnelService.isRunning) View.VISIBLE else View.GONE
        }
    }

    private fun updateUiForIdleState() {
        runOnUiThread {
            binding.tvConnectionState.text = getString(R.string.state_idle)
            binding.tvBytesSent.text = "0 B"
            binding.tvBytesReceived.text = "0 B"
            binding.tvActiveStreams.text = "0"
            binding.tvLatency.text = "--"
            binding.statsCard.visibility = View.GONE
            updateButtonState(running = false)
        }
    }

    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024L -> "$bytes B"
            bytes < 1024L * 1024L -> "${df.format(bytes / 1024.0)} KB"
            bytes < 1024L * 1024L * 1024L -> "${df.format(bytes / (1024.0 * 1024.0))} MB"
            else -> "${df.format(bytes / (1024.0 * 1024.0 * 1024.0))} GB"
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun showToast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
