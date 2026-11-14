import React, { useState, useEffect } from 'react';
import { QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { QRData } from '../types';

export const QRPanel: React.FC = () => {
  const [qrData, setQrData] = useState<QRData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchQR = async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/qr${refresh ? '?refresh=true' : ''}`);
      const json = await res.json();
      if (json.success) {
        setQrData(json.data);
      }
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => {
    fetchQR();
  }, []);

  return (
    <div className="bg-[#121722]/80 border border-[#222b3d] rounded-2xl p-6 shadow-lg flex flex-col items-center text-center">
      <div className="flex items-center justify-between w-full mb-4">
        <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
          <QrCode className="w-5 h-5" />
          <span>Connect Phone Uplink</span>
        </div>
        <button
          onClick={() => fetchQR(true)}
          disabled={loading}
          className="text-gray-400 hover:text-white transition-colors p-1"
          title="Regenerate Pairing Code"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-[#0a0d14] p-3 rounded-xl border border-gray-800 mb-4 inline-block">
        {qrData?.qrSvg ? (
          <div
            className="w-48 h-48 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
            dangerouslySetInnerHTML={{ __html: qrData.qrSvg }}
          />
        ) : (
          <div className="w-48 h-48 flex items-center justify-center text-gray-500 text-xs">
            {loading ? 'Generating QR...' : 'Hub offline'}
          </div>
        )}
      </div>

      <div className="text-left w-full bg-[#161c2b] p-3 rounded-xl border border-[#222b3d] text-xs space-y-1.5">
        <div className="flex justify-between text-gray-400">
          <span>Hub IP:</span>
          <strong className="text-gray-200">{qrData?.ip || '127.0.0.1'}</strong>
        </div>
        <div className="flex justify-between text-gray-400">
          <span>Hub WS Port:</span>
          <strong className="text-gray-200">{qrData?.port || 9000}</strong>
        </div>
        <div className="flex justify-between text-gray-400">
          <span>Token:</span>
          <strong className="text-cyan-400 font-mono">{qrData?.token || '--'}</strong>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-4 leading-relaxed">
        1. Open the Android app on any phone<br />
        2. Tap <strong>Scan Hub QR</strong> and point camera here<br />
        3. Traffic begins bonding automatically!
      </p>
    </div>
  );
};
