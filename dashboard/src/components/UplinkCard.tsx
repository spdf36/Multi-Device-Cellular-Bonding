import React from 'react';
import { Smartphone, Wifi, Activity, ArrowDown, ArrowUp } from 'lucide-react';
import { UplinkStats } from '../types';

interface Props {
  uplink: UplinkStats;
  onToggle: (id: string, enabled: boolean) => void;
  onWeightChange: (id: string, weight: number) => void;
}

export const UplinkCard: React.FC<Props> = ({ uplink, onToggle, onWeightChange }) => {
  const isNative = uplink.type === 'native';
  const downMbps = (uplink.speed_down_kbps / 1024).toFixed(2);
  const upMbps = (uplink.speed_up_kbps / 1024).toFixed(2);

  return (
    <div
      className={`rounded-2xl border p-5 transition-all ${
        uplink.enabled
          ? 'bg-[#121722]/80 border-[#222b3d] shadow-lg shadow-cyan-950/20'
          : 'bg-[#121722]/40 border-gray-800 opacity-60'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl ${
              isNative ? 'bg-cyan-500/10 text-cyan-400' : 'bg-purple-500/10 text-purple-400'
            }`}
          >
            {isNative ? <Wifi className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="font-semibold text-white text-base tracking-wide flex items-center gap-2">
              {uplink.name}
              {uplink.enabled && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              )}
            </h3>
            <span className="text-xs text-gray-400 uppercase tracking-wider">
              {isNative ? 'PC Native NIC' : 'Cellular Modem'}
            </span>
          </div>
        </div>

        <button
          onClick={() => onToggle(uplink.id, !uplink.enabled)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            uplink.enabled
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-gray-800 text-gray-400 border border-gray-700'
          }`}
        >
          {uplink.enabled ? 'ACTIVE' : 'MUTED'}
        </button>
      </div>

      {/* Speed & Metrics grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-[#161c2b] rounded-xl p-3 border border-[#222b3d]">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
            <ArrowDown className="w-3.5 h-3.5 text-cyan-400" /> Downlink
          </div>
          <div className="text-xl font-bold text-white tracking-tight">
            {downMbps} <span className="text-xs text-gray-400 font-normal">Mbps</span>
          </div>
        </div>

        <div className="bg-[#161c2b] rounded-xl p-3 border border-[#222b3d]">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
            <ArrowUp className="w-3.5 h-3.5 text-purple-400" /> Uplink
          </div>
          <div className="text-xl font-bold text-white tracking-tight">
            {upMbps} <span className="text-xs text-gray-400 font-normal">Mbps</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400 mb-4 px-1">
        <span className="flex items-center gap-1">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          Latency: <strong className="text-gray-200">{uplink.latency_ms} ms</strong>
        </span>
        <span>
          Streams: <strong className="text-gray-200">{uplink.active_connections}</strong>
        </span>
      </div>

      {/* Weight slider */}
      <div className="pt-3 border-t border-gray-800/80">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-gray-400">Traffic Ratio Weight:</span>
          <span className="text-cyan-400 font-semibold">{uplink.weight}x</span>
        </div>
        <input
          type="range"
          min="1"
          max="50"
          value={uplink.weight}
          onChange={(e) => onWeightChange(uplink.id, parseInt(e.target.value, 10))}
          className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
        />
      </div>
    </div>
  );
};
