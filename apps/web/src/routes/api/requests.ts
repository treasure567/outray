import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { auth } from "../../lib/auth";
import { createClient } from "@clickhouse/client";

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

export const Route = createFileRoute("/api/requests")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const organizationId = url.searchParams.get("organizationId");
        const timeRange = url.searchParams.get("range") || "1h";
        const limit = parseInt(url.searchParams.get("limit") || "100");

        if (!organizationId) {
          return json({ error: "Organization ID required" }, { status: 400 });
        }

        // Verify user has access to this organization
        const organizations = await auth.api.listOrganizations({
          headers: request.headers,
        });
        const hasAccess = organizations.find(
          (org) => org.id === organizationId,
        );
        if (!hasAccess) {
          return json({ error: "Unauthorized" }, { status: 403 });
        }

        let interval = "1 HOUR";
        if (timeRange === "24h") {
          interval = "24 HOUR";
        } else if (timeRange === "7d") {
          interval = "7 DAY";
        } else if (timeRange === "30d") {
          interval = "30 DAY";
        }

        try {
          const requestsResult = await clickhouse.query({
            query: `
              SELECT 
                timestamp,
                tunnel_id,
                organization_id,
                host,
                method,
                path,
                status_code,
                request_duration_ms,
                bytes_in,
                bytes_out,
                client_ip,
                user_agent
              FROM tunnel_events
              WHERE organization_id = {organizationId:String}
                AND timestamp >= now64() - INTERVAL ${interval}
              ORDER BY timestamp DESC
              LIMIT {limit:UInt32}
            `,
            query_params: { organizationId, limit },
            format: "JSONEachRow",
          });

          const requests = (await requestsResult.json()) as Array<any>;

          return json({
            requests,
            timeRange,
            count: requests.length,
          });
        } catch (error) {
          console.error("Failed to fetch requests:", error);
          return json({ error: "Failed to fetch requests" }, { status: 500 });
        }
      },
    },
  },
});
