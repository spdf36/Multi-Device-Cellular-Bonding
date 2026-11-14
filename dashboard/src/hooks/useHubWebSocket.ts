import { useState, useEffect, useRef } from 'react';
import { HubMetrics } from '../types';

export function useHubWebSocket() {
  const [metrics, setMetrics] = useState<HubMetrics | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let timeoutId: number;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      // Connect to backend ws port 3001
      const wsUrl = `${protocol}//${host}:3001/api/ws`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'metrics' || msg.type === 'welcome') {
            setMetrics(msg.data);
          }
        } catch (_) {}
      };

      ws.onclose = () => {
        setConnected(false);
        timeoutId = window.setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(timeoutId);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return { metrics, connected };
}
