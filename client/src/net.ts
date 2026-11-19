// WebSocket client: single connection for lobby + match traffic.
export type NetHandler = (msg: Record<string, unknown>) => void;

export class NetClient {
  ws: WebSocket | null = null;
  private handlers = new Set<NetHandler>();
  private reconnectTimer: number | null = null;
  authed = false;
  user: { username: string; rating: number } | null = null;
  connected = false;

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.emit({ type: "_connected" });
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        if (msg.type === "hello") {
          this.authed = !!msg.authed;
          this.user = (msg.user as { username: string; rating: number }) ?? null;
        }
        this.emit(msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.connected = false;
      this.authed = false;
      this.emit({ type: "_disconnected" });
      // auto-reconnect for lobby use
      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 2000);
      }
    };
    ws.onerror = () => ws.close();
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(h: NetHandler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private emit(msg: Record<string, unknown>): void {
    for (const h of this.handlers) h(msg);
  }

  close(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

export const net = new NetClient();
