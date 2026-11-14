import React, { useState, useEffect } from 'react';
import { useHubWebSocket } from './hooks/useHubWebSocket';
import { StatusBar } from './components/StatusBar';
import { UplinkCard } from './components/UplinkCard';
import { SpeedChart } from './components/SpeedChart';
import { QRPanel } from './components/QRPanel';

interface ChartPoint {
  time: string;
  download: number;
  upload: number;
}

export const App: React.FC = () => {
  const { metrics, connected } = useHubWebSocket();
  const [chartData, setChartData] = useState<ChartPoint[]>([]);

  useEffect(() => {
    if (!metrics) return;

    const timeLabel = new Date(metrics.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const downMbps = parseFloat((metrics.total_speed_down_kbps / 1024).toFixed(2));
    const upMbps = parseFloat((metrics.total_speed_up_kbps / 1024).toFixed(2));

    setChartData((prev) => {
      const next = [...prev, { time: timeLabel, download: downMbps, upload: upMbps }];
      if (next.length > 30) next.shift();
      return next;
    });
  }, [metrics]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetch(`http://localhost:3001/api/uplink/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch (_) {}
  };

  const handleWeightChange = async (id: string, weight: number) => {
    try {
      await fetch(`http://localhost:3001/api/uplink/${id}/weight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight }),
      });
    } catch (_) {}
  };

  return (
    <div className="min-h-screen bg-[#0a0d14] text-white flex flex-col font-sans selection:bg-cyan-500/30">
      <StatusBar metrics={metrics} connected={connected} />

      <main className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 flex flex-col gap-8">
        {/* Speed Chart */}
        <SpeedChart data={chartData} />

        {/* Uplinks and QR Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Uplink list (takes 2 columns) */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-base font-bold tracking-tight text-gray-200">
                Active Uplink Interfaces ({metrics?.uplinks.length || 1})
              </h2>
              <span className="text-xs text-gray-400">
                Balanced via dynamic weighted routing
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {metrics && metrics.uplinks.length > 0 ? (
                metrics.uplinks.map((u) => (
                  <UplinkCard
                    key={u.id}
                    uplink={u}
                    onToggle={handleToggle}
                    onWeightChange={handleWeightChange}
                  />
                ))
              ) : (
                <div className="p-8 text-center text-gray-500 border border-dashed border-gray-800 rounded-2xl col-span-2">
                  Waiting for hub connection...
                </div>
              )}
            </div>
          </div>

          {/* QR Scan & Join Panel (takes 1 column) */}
          <div className="lg:col-span-1">
            <QRPanel />
          </div>
        </div>
      </main>

      <footer className="border-t border-[#222b3d] py-4 text-center text-xs text-gray-500">
        Multi-Device Network Hub &bull; Local Proxy running on 127.0.0.1:1080 (SOCKS5) and 127.0.0.1:8080 (HTTP)
      </footer>
    </div>
  );
};

export default App;
