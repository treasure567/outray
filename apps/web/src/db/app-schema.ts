import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { users, organizations } from "./auth-schema";

export const tunnels = pgTable(
  "tunnels",
  {
    id: text("id").primaryKey(),
    subdomain: text("subdomain").notNull().unique(),
    name: text("name"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("tunnels_userId_idx").on(table.userId),
    index("tunnels_organizationId_idx").on(table.organizationId),
  ],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("auth_tokens_organizationId_idx").on(table.organizationId),
    index("auth_tokens_userId_idx").on(table.userId),
  ],
);

export const tunnelsRelations = relations(tunnels, ({ one }) => ({
  user: one(users, {
    fields: [tunnels.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [tunnels.organizationId],
    references: [organizations.id],
  }),
}));

export const authTokensRelations = relations(authTokens, ({ one }) => ({
  organization: one(organizations, {
    fields: [authTokens.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [authTokens.userId],
    references: [users.id],
  }),
}));

export const usersAppRelations = relations(users, ({ many }) => ({
  tunnels: many(tunnels),
  authTokens: many(authTokens),
}));

export const organizationsAppRelations = relations(organizations, ({ many }) => ({
  tunnels: many(tunnels),
  authTokens: many(authTokens),
}));
