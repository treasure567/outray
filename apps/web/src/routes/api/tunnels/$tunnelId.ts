import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { eq, and } from "drizzle-orm";
import { auth } from "../../../lib/auth";
import { db } from "../../../db";
import { tunnels, subdomains } from "../../../db/app-schema";
import { redis } from "../../../lib/redis";

export const Route = createFileRoute("/api/tunnels/$tunnelId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        const { tunnelId } = params;

        const [tunnel] = await db
          .select()
          .from(tunnels)
          .where(
            and(eq(tunnels.id, tunnelId), eq(tunnels.userId, session.user.id)),
          );

        if (!tunnel) {
          return json({ error: "Tunnel not found" }, { status: 404 });
        }

        // Get the subdomain for this tunnel
        const [subdomainRecord] = await db
          .select()
          .from(subdomains)
          .where(eq(subdomains.tunnelId, tunnel.id));

        const isOnline = subdomainRecord
          ? await redis.exists(`tunnel:online:${subdomainRecord.subdomain}`)
          : false;

        return json({
          tunnel: {
            id: tunnel.id,
            url: tunnel.url,
            userId: tunnel.userId,
            status: isOnline ? "online" : "offline",
            createdAt: tunnel.createdAt,
            updatedAt: tunnel.updatedAt,
          },
        });
      },
      DELETE: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        const { tunnelId } = params;

        const [tunnel] = await db
          .select()
          .from(tunnels)
          .where(
            and(eq(tunnels.id, tunnelId), eq(tunnels.userId, session.user.id)),
          );

        if (!tunnel) {
          return json({ error: "Tunnel not found" }, { status: 404 });
        }

        // Hard delete the tunnel record (cascade will delete subdomains)
        await db.delete(tunnels).where(eq(tunnels.id, tunnel.id));

        // Note: The tunnel server will continue to serve the tunnel if it's currently connected
        // because it manages the Redis key separately. This is fine - the tunnel stays active
        // until the client disconnects. Once deleted from DB, a new client can't register it.

        return json({ message: "Tunnel deleted" });
      },
    },
  },
});
