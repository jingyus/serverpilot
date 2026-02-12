import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/pg-schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://serverpilot:serverpilot@localhost:5432/serverpilot',
  },
});
