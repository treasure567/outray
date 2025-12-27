import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "../../../db";
import { tunnels } from "../../../db/app-schema";
import { subscriptions } from "../../../db/subscription-schema";
import { getPlanLimits } from "../../../lib/subscription-plans";
import { redis } from "../../../lib/redis";

export const Route = createFileRoute("/api/tunnel/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            userId?: string;
            organizationId?: string;
            url?: string;
          };

          const { userId, organizationId, url } = body;

          if (!url || !userId || !organizationId) {
            return json({ error: "Missing required fields" }, { status: 400 });
          }

          // Get the tunnel ID from the URL (hostname)
          const urlObj = new URL(
            url.startsWith("http") ? url : `https://${url}`,
          );
          const tunnelId = urlObj.hostname;

          // Check subscription limits
          const [subscription] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.organizationId, organizationId));

          const currentPlan = subscription?.plan || "free";
          const planLimits = getPlanLimits(currentPlan as any);
          const tunnelLimit = planLimits.maxTunnels;

          const zsetKey = `org:${organizationId}:active_tunnels`;

          // Remove expired entries from Redis
          await redis.zremrangebyscore(zsetKey, "-inf", Date.now().toString());

          // Check if tunnel with this URL already exists in database (reconnection check)
          const [existingTunnel] = await db
            .select()
            .from(tunnels)
            .where(eq(tunnels.url, url));

          const isReconnection = !!existingTunnel;

          console.log(
            `[TUNNEL LIMIT CHECK] Org: ${organizationId}, Tunnel: ${tunnelId}`,
          );
          console.log(
            `[TUNNEL LIMIT CHECK] Is Reconnection: ${isReconnection}`,
          );
          console.log(
            `[TUNNEL LIMIT CHECK] Plan: ${currentPlan}, Limit: ${tunnelLimit}`,
          );

          // Check limits only for NEW tunnels (not reconnections)
          if (!isReconnection) {
            // Count active tunnels from Redis ONLY
            const activeCount = await redis.zcard(zsetKey);
            console.log(
              `[TUNNEL LIMIT CHECK] Active count in Redis: ${activeCount}`,
            );

            // Since reserveTunnel was already called, the current tunnel is in Redis
            // So we need to check if activeCount > limit (not >=)
            if (activeCount > tunnelLimit) {
              console.log(
                `[TUNNEL LIMIT CHECK] REJECTED - ${activeCount} > ${tunnelLimit}`,
              );
              return json(
                {
                  error: `Tunnel limit reached. The ${currentPlan} plan allows ${tunnelLimit} active tunnel${tunnelLimit > 1 ? "s" : ""}.`,
                },
                { status: 403 },
              );
            }
            console.log(
              `[TUNNEL LIMIT CHECK] ALLOWED - ${activeCount} <= ${tunnelLimit}`,
            );
          } else {
            console.log(`[TUNNEL LIMIT CHECK] SKIPPED - Reconnection detected`);
          }

          if (existingTunnel) {
            // Tunnel with this URL already exists, update lastSeenAt
            await db
              .update(tunnels)
              .set({ lastSeenAt: new Date() })
              .where(eq(tunnels.id, existingTunnel.id));

            return json({
              success: true,
              tunnelId: existingTunnel.id,
            });
          }

          // Create new tunnel record with full URL
          const tunnelRecord = {
            id: randomUUID(),
            url,
            userId,
            organizationId,
            name: null,
            lastSeenAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await db.insert(tunnels).values(tunnelRecord);

          return json({ success: true, tunnelId: tunnelRecord.id });
        } catch (error) {
          console.error("Tunnel registration error:", error);
          return json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});
