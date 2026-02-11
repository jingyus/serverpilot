import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/server/src/db/pg-schema.ts',
  out: './packages/server/src/db/pg-migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://serverpilot:serverpilot@localhost:5432/serverpilot',
  },
});
