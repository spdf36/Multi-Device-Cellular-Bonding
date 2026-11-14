import React from 'react';
import { Layers, Zap, ShieldCheck } from 'lucide-react';
import { HubMetrics } from '../types';

interface Props {
  metrics: HubMetrics | null;
  connected: boolean;
}

export const StatusBar: React.FC<Props> = ({ metrics, connected }) => {
  const totalDownMbps = metrics ? (metrics.total_speed_down_kbps / 1024).toFixed(1) : '0.0';
  const totalUpMbps = metrics ? (metrics.total_speed_up_kbps / 1024).toFixed(1) : '0.0';
  const activeCount = metrics ? metrics.uplinks.filter((u) => u.enabled).length : 0;
  const totalStreams = metrics ? metrics.total_active_connections : 0;

  return (
    <header className="bg-[#121722]/90 backdrop-blur border-b border-[#222b3d] sticky top-0 z-50 px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-xl text-black">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              Multi-Link Bonding Hub
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ${
                  connected
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}
              >
                {connected ? 'LIVE' : 'DISCONNECTED'}
              </span>
            </h1>
            <p className="text-xs text-gray-400">
              Aggregated Cellular + Wi-Fi Multiplexer
            </p>
          </div>
        </div>

        {/* Global Key Metrics */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-gray-400">Aggregated Down</div>
            <div className="text-2xl font-black text-cyan-400 tracking-tight">
              {totalDownMbps} <span className="text-xs text-gray-400 font-normal">Mbps</span>
            </div>
          </div>

          <div className="w-[1px] h-8 bg-gray-800"></div>

          <div className="text-right">
            <div className="text-xs text-gray-400">Aggregated Up</div>
            <div className="text-2xl font-black text-purple-400 tracking-tight">
              {totalUpMbps} <span className="text-xs text-gray-400 font-normal">Mbps</span>
            </div>
          </div>

          <div className="w-[1px] h-8 bg-gray-800"></div>

          <div className="flex flex-col gap-1 text-xs text-gray-400">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              Active Uplinks: <strong className="text-white">{activeCount}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              SOCKS5: <strong className="text-white">127.0.0.1:1080</strong>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
