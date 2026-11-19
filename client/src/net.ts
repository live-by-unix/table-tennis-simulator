// WebSocket client: single connection for lobby + match traffic.
export type NetHandler = (msg: Record<string, unknown>) => void;

export class NetClient {
  ws: WebSocket | null = null;
  private handlers = new Set<NetHandler>();
  private reconnectTimer: number | null = null;
  private pending: string[] = [];
  private wantConnect = false;
  authed = false;
  user: { username: string; rating: number } | null = null;
  connected = false;

  connect(): void {
    this.wantConnect = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      // flush queued messages
      const q = this.pending.splice(0);
      for (const m of q) ws.send(m);
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
      if (this.wantConnect && this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 2000);
      }
    };
    ws.onerror = () => ws.close();
  }

  disconnect(): void {
    this.wantConnect = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.authed = false;
  }

  send(msg: Record<string, unknown>): void {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else if (this.wantConnect) {
      // queue until open (cap to avoid unbounded growth)
      if (this.pending.length < 200) this.pending.push(data);
    }
  }

  onMessage(h: NetHandler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private emit(msg: Record<string, unknown>): void {
    for (const h of this.handlers) h(msg);
  }
}

export const net = new NetClient();
