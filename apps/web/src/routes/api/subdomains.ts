import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { auth } from "../../lib/auth";
import { db } from "../../db";
import { subdomains } from "../../db/app-schema";
import { subscriptions } from "../../db/subscription-schema";
import { getPlanLimits } from "../../lib/subscription-plans";

export const Route = createFileRoute("/api/subdomains")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const organizationId = url.searchParams.get("organizationId");

        if (!organizationId) {
          return json({ error: "Organization ID required" }, { status: 400 });
        }

        const organizations = await auth.api.listOrganizations({
          headers: request.headers,
        });

        const hasAccess = organizations.find(
          (org) => org.id === organizationId,
        );

        if (!hasAccess) {
          return json({ error: "Unauthorized" }, { status: 403 });
        }

        const results = await db
          .select()
          .from(subdomains)
          .where(eq(subdomains.organizationId, organizationId));

        return json({ subdomains: results });
      },
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { subdomain, organizationId } = body;

        if (!subdomain || !organizationId) {
          return json(
            { error: "Subdomain and Organization ID required" },
            { status: 400 },
          );
        }

        // Validate subdomain format (alphanumeric, hyphens)
        const subdomainRegex = /^[a-z0-9-]+$/;
        if (!subdomainRegex.test(subdomain)) {
          return json(
            {
              error:
                "Invalid subdomain format. Use lowercase letters, numbers, and hyphens.",
            },
            { status: 400 },
          );
        }

        const organizations = await auth.api.listOrganizations({
          headers: request.headers,
        });

        const hasAccess = organizations.find(
          (org) => org.id === organizationId,
        );

        if (!hasAccess) {
          return json({ error: "Unauthorized" }, { status: 403 });
        }

        // Check subscription limits
        const [subscription] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.organizationId, organizationId));

        const currentPlan = subscription?.plan || "free";
        const planLimits = getPlanLimits(currentPlan as any);
        const subdomainLimit = planLimits.maxSubdomains;

        const existingSubdomains = await db
          .select()
          .from(subdomains)
          .where(eq(subdomains.organizationId, organizationId));

        if (existingSubdomains.length >= subdomainLimit) {
          return json(
            {
              error: `Subdomain limit reached. The ${currentPlan} plan allows ${subdomainLimit} subdomain${subdomainLimit > 1 ? "s" : ""}.`,
            },
            { status: 403 },
          );
        }

        // Check if subdomain is already taken
        const existing = await db
          .select()
          .from(subdomains)
          .where(eq(subdomains.subdomain, subdomain))
          .limit(1);

        if (existing.length > 0) {
          return json({ error: "Subdomain already taken" }, { status: 409 });
        }

        const [newSubdomain] = await db
          .insert(subdomains)
          .values({
            id: crypto.randomUUID(),
            subdomain,
            organizationId,
            userId: session.user.id,
          })
          .returning();

        return json({ subdomain: newSubdomain });
      },
    },
  },
});
