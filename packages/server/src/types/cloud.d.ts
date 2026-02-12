/**
 * Type declarations for @aiinstaller/cloud (optional dependency).
 *
 * The cloud package is dynamically imported only when DB_TYPE=postgres.
 * This declaration allows server to typecheck without building cloud first.
 */
declare module '@aiinstaller/cloud' {
  export interface CloudBootstrapResult {
    dbType: 'postgres';
    close: () => Promise<void>;
  }

  export function bootstrapCloud(): Promise<CloudBootstrapResult>;
}
