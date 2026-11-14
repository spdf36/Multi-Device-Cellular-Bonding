package com.uplink.node

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// -------------------------------------------------------------------------------------
// MuxProtocol – Yamux-inspired binary framing over a WebSocket byte stream
//
// Frame layout (12-byte fixed header):
//   Offset 0-1  : MAGIC   (0x4D58 = 'MX')
//   Offset 2    : TYPE    (see FrameType enum)
//   Offset 3    : FLAGS   (bitmask, see FLAG_* constants)
//   Offset 4-7  : STREAM_ID (UInt32, big-endian)
//   Offset 8-11 : LENGTH  (UInt32, big-endian) – byte count of the payload that follows
// -------------------------------------------------------------------------------------

object MuxProtocol {

    const val HEADER_SIZE = 12
    const val MAGIC: Short = 0x4D58.toShort()   // 'MX'
    const val MAX_PAYLOAD = 65535                 // Max single-frame payload (64 KiB - 1)
    const val PING_STREAM_ID = 0xFFFFFFFF.toInt() // Reserved stream id for PING/PONG
    const val STATS_STREAM_ID = 0xFFFFFFFE.toInt()// Reserved stream id for STATS

    // Frame type byte values
    object FrameType {
        const val DATA: Byte  = 0x00
        const val SYN: Byte   = 0x01  // Open new stream
        const val FIN: Byte   = 0x02  // Half-close stream (EOF)
        const val RST: Byte   = 0x03  // Reset/abort stream
        const val PING: Byte  = 0x04
        const val PONG: Byte  = 0x05
        const val STATS: Byte = 0x06  // Stats payload (JSON)
    }

    // Flag bits
    const val FLAG_NONE: Byte    = 0x00
    const val FLAG_ACK: Byte     = 0x01
    const val FLAG_FIN: Byte     = 0x02
    const val FLAG_SYN: Byte     = 0x04

    // -------------------------------------------------------------------------------------
    // Frame data class
    // -------------------------------------------------------------------------------------

    data class Frame(
        val type: Byte,
        val flags: Byte,
        val streamId: Int,
        val payload: ByteArray
    ) {
        val payloadLength: Int get() = payload.size

        fun encode(): ByteArray {
            val buf = ByteBuffer.allocate(HEADER_SIZE + payload.size).order(ByteOrder.BIG_ENDIAN)
            buf.putShort(MAGIC)
            buf.put(type)
            buf.put(flags)
            buf.putInt(streamId)
            buf.putInt(payload.size)
            buf.put(payload)
            return buf.array()
        }

        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is Frame) return false
            return type == other.type &&
                    flags == other.flags &&
                    streamId == other.streamId &&
                    payload.contentEquals(other.payload)
        }

        override fun hashCode(): Int {
            var result = type.toInt()
            result = 31 * result + flags.toInt()
            result = 31 * result + streamId
            result = 31 * result + payload.contentHashCode()
            return result
        }

        companion object {
            /** Convenience builders */
            fun syn(streamId: Int): Frame = Frame(FrameType.SYN, FLAG_SYN, streamId, ByteArray(0))
            fun fin(streamId: Int): Frame = Frame(FrameType.FIN, FLAG_FIN, streamId, ByteArray(0))
            fun rst(streamId: Int): Frame = Frame(FrameType.RST, FLAG_NONE, streamId, ByteArray(0))
            fun data(streamId: Int, payload: ByteArray, flags: Byte = FLAG_NONE): Frame =
                Frame(FrameType.DATA, flags, streamId, payload)
            fun ping(nonce: Int): Frame =
                Frame(FrameType.PING, FLAG_NONE, PING_STREAM_ID, ByteBuffer.allocate(4).putInt(nonce).array())
            fun pong(nonce: Int): Frame =
                Frame(FrameType.PONG, FLAG_ACK, PING_STREAM_ID, ByteBuffer.allocate(4).putInt(nonce).array())
            fun stats(json: ByteArray): Frame =
                Frame(FrameType.STATS, FLAG_NONE, STATS_STREAM_ID, json)
        }
    }

    // -------------------------------------------------------------------------------------
    // FrameDecoder – stateful decoder that parses frames from an accumulating byte buffer.
    // Feed raw bytes in; call decode() to extract complete frames.
    // -------------------------------------------------------------------------------------

    class FrameDecoder {
        private val accumulator = ArrayDeque<Byte>()

        /** Append newly received bytes and return all complete frames decoded so far. */
        fun feed(bytes: ByteArray): List<Frame> {
            bytes.forEach { accumulator.addLast(it) }
            return drain()
        }

        private fun drain(): List<Frame> {
            val frames = mutableListOf<Frame>()
            while (accumulator.size >= HEADER_SIZE) {
                // Peek at the magic bytes without consuming
                if (peekShortAt(0) != MAGIC) {
                    // De-sync: drop one byte and try to re-sync
                    accumulator.removeFirst()
                    continue
                }

                val payloadLength = peekIntAt(8)
                if (payloadLength < 0 || payloadLength > MAX_PAYLOAD) {
                    // Corrupt length field – drop this header and attempt re-sync
                    accumulator.removeFirst()
                    continue
                }

                val totalNeeded = HEADER_SIZE + payloadLength
                if (accumulator.size < totalNeeded) break // Wait for more data

                // Consume the full frame
                val rawHeader = ByteArray(HEADER_SIZE) { accumulator.removeFirst() }
                val payload   = ByteArray(payloadLength) { accumulator.removeFirst() }

                val buf = ByteBuffer.wrap(rawHeader).order(ByteOrder.BIG_ENDIAN)
                buf.getShort()          // skip magic (already verified)
                val type     = buf.get()
                val flags    = buf.get()
                val streamId = buf.getInt()
                // payloadLength already read above

                frames.add(Frame(type, flags, streamId, payload))
            }
            return frames
        }

        private fun peekShortAt(offset: Int): Short {
            val hi = accumulator.elementAt(offset).toInt() and 0xFF
            val lo = accumulator.elementAt(offset + 1).toInt() and 0xFF
            return ((hi shl 8) or lo).toShort()
        }

        private fun peekIntAt(offset: Int): Int {
            var result = 0
            for (i in 0..3) {
                result = (result shl 8) or (accumulator.elementAt(offset + i).toInt() and 0xFF)
            }
            return result
        }
    }

    // -------------------------------------------------------------------------------------
    // StreamMultiplexer – manages hundreds of logical streams over a single WebSocket
    // -------------------------------------------------------------------------------------

    class StreamMultiplexer {
        // Channel capacity per stream: bounded to avoid runaway memory growth
        private val CHANNEL_CAPACITY = 256

        private val streams = java.util.concurrent.ConcurrentHashMap<Int, StreamChannel>()
        private val _activeStreamCount = MutableStateFlow(0)
        val activeStreamCount: StateFlow<Int> = _activeStreamCount

        /** Open a new outbound logical stream. Returns the StreamChannel. */
        fun openStream(streamId: Int): StreamChannel {
            val ch = StreamChannel(streamId, Channel(CHANNEL_CAPACITY))
            streams[streamId] = ch
            _activeStreamCount.value = streams.size
            return ch
        }

        /** Called by the WebSocket receive loop when a frame arrives for a known stream. */
        fun dispatch(frame: Frame) {
            when (frame.type) {
                FrameType.SYN -> {
                    // Remote opened a new stream
                    streams.getOrPut(frame.streamId) {
                        StreamChannel(frame.streamId, Channel(CHANNEL_CAPACITY))
                    }
                    _activeStreamCount.value = streams.size
                }
                FrameType.DATA -> {
                    streams[frame.streamId]?.channel?.trySend(frame)
                }
                FrameType.FIN, FrameType.RST -> {
                    streams[frame.streamId]?.channel?.close()
                    streams.remove(frame.streamId)
                    _activeStreamCount.value = streams.size
                }
                else -> { /* PING/PONG/STATS handled outside multiplexer */ }
            }
        }

        /** Close a stream locally (sends FIN). */
        fun closeStream(streamId: Int) {
            streams[streamId]?.channel?.close()
            streams.remove(streamId)
            _activeStreamCount.value = streams.size
        }

        /** Close all streams (e.g. on WebSocket disconnect). */
        fun closeAll() {
            streams.values.forEach { it.channel.close() }
            streams.clear()
            _activeStreamCount.value = 0
        }

        fun getStream(streamId: Int): StreamChannel? = streams[streamId]

        fun streamCount(): Int = streams.size
    }

    // -------------------------------------------------------------------------------------
    // StreamChannel – one logical bidirectional stream
    // -------------------------------------------------------------------------------------

    data class StreamChannel(
        val streamId: Int,
        val channel: Channel<Frame>,
        val createdAt: Long = System.currentTimeMillis()
    )
}
