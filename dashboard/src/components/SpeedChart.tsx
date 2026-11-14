import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface DataPoint {
  time: string;
  download: number;
  upload: number;
}

interface Props {
  data: DataPoint[];
}

export const SpeedChart: React.FC<Props> = ({ data }) => {
  return (
    <div className="w-full h-64 bg-[#121722]/80 border border-[#222b3d] rounded-2xl p-5 shadow-lg">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Total Combined Throughput (Last 60s)</h3>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-cyan-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400 inline-block"></span> Download
          </span>
          <span className="flex items-center gap-1.5 text-purple-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-400 inline-block"></span> Upload
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="downGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#00f0ff" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#c084fc" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#c084fc" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" stroke="#4b5563" tick={{ fontSize: 10 }} />
          <YAxis stroke="#4b5563" tick={{ fontSize: 10 }} unit=" M" />
          <Tooltip
            contentStyle={{
              backgroundColor: '#161c2b',
              borderColor: '#222b3d',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Area
            type="monotone"
            dataKey="download"
            stroke="#00f0ff"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#downGrad)"
          />
          <Area
            type="monotone"
            dataKey="upload"
            stroke="#c084fc"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#upGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
