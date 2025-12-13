import WebSocket from "ws";
import Redis from "ioredis";
import { Protocol, RequestMessage, ResponseMessage, Message } from "./Protocol";
import { generateId } from "../../../../shared/utils";

interface PendingRequest {
  resolve: (response: ResponseMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface TunnelRouterOptions {
  redis?: Redis;
  ttlSeconds?: number;
  heartbeatIntervalMs?: number;
}

export class TunnelRouter {
  private tunnels = new Map<string, WebSocket>();
  private pendingRequests = new Map<string, PendingRequest>();
  private redis?: Redis;
  private readonly serverId = generateId("tunnel-server");
  private readonly ttlSeconds: number;
  private readonly heartbeatIntervalMs: number;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(options: TunnelRouterOptions = {}) {
    this.redis = options.redis;
    this.ttlSeconds = Math.max(30, options.ttlSeconds ?? 120);
    this.heartbeatIntervalMs = Math.max(
      5000,
      options.heartbeatIntervalMs ?? 20000,
    );

    if (this.redis) {
      this.startHeartbeat();
    }
  }

  async registerTunnel(tunnelId: string, ws: WebSocket): Promise<boolean> {
    this.tunnels.set(tunnelId, ws);
    const persisted = await this.persistTunnelState(tunnelId, "XX");
    if (!persisted) {
      this.tunnels.delete(tunnelId);
    }
    return persisted;
  }

  async unregisterTunnel(tunnelId: string): Promise<void> {
    this.tunnels.delete(tunnelId);
    if (this.redis) {
      try {
        await this.redis.del(this.redisKey(tunnelId));
      } catch (error) {
        console.error("Failed to remove tunnel reservation", error);
      }
    }
  }

  async reserveTunnel(tunnelId: string): Promise<boolean> {
    if (!this.redis) {
      return !this.tunnels.has(tunnelId);
    }

    return this.persistTunnelState(tunnelId, "NX");
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.redis) {
      const keys = Array.from(this.tunnels.keys()).map((id) =>
        this.redisKey(id),
      );
      if (keys.length > 0) {
        try {
          await this.redis.del(...keys);
        } catch (error) {
          console.error(
            "Failed to clear tunnel reservations on shutdown",
            error,
          );
        }
      }
    }
  }

  getTunnel(tunnelId: string): WebSocket | undefined {
    return this.tunnels.get(tunnelId);
  }

  hasTunnel(tunnelId: string): boolean {
    return this.tunnels.has(tunnelId);
  }

  handleMessage(tunnelId: string, message: Message): void {
    if (message.type === "response") {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.requestId);
        pending.resolve(message);
      }
    }
  }

  async forwardRequest(
    tunnelId: string,
    method: string,
    path: string,
    headers: Record<string, string | string[]>,
    body?: string,
  ): Promise<ResponseMessage> {
    const ws = this.tunnels.get(tunnelId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Tunnel not available");
    }

    const requestId = generateId("req");

    const requestMessage: RequestMessage = {
      type: "request",
      requestId,
      method,
      path,
      headers,
      body,
    };

    return new Promise<ResponseMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Request timeout"));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      ws.send(Protocol.encode(requestMessage));
    });
  }

  private redisKey(tunnelId: string): string {
    return `tunnel:active:${tunnelId}`;
  }

  private async persistTunnelState(
    tunnelId: string,
    mode: "NX" | "XX",
  ): Promise<boolean> {
    if (!this.redis) {
      return true;
    }

    const metadata = JSON.stringify({
      serverId: this.serverId,
      updatedAt: Date.now(),
    });

    try {
      const key = this.redisKey(tunnelId);
      const result =
        mode === "NX"
          ? await this.redis.set(key, metadata, "EX", this.ttlSeconds, "NX")
          : await this.redis.set(key, metadata, "EX", this.ttlSeconds, "XX");

      if (mode === "XX" && result === null) {
        return this.persistTunnelState(tunnelId, "NX");
      }

      return result === null ? false : true;
    } catch (error) {
      console.error("Failed to persist tunnel state", error);
      return false;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.refreshActiveTunnels();
    }, this.heartbeatIntervalMs);

    if (typeof this.heartbeatTimer.unref === "function") {
      this.heartbeatTimer.unref();
    }
  }

  private async refreshActiveTunnels(): Promise<void> {
    if (!this.redis || this.tunnels.size === 0) {
      return;
    }

    await Promise.all(
      Array.from(this.tunnels.keys()).map((tunnelId) =>
        this.persistTunnelState(tunnelId, "XX"),
      ),
    );
  }
}
