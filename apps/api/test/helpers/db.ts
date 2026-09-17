import { Client, type QueryResultRow } from 'pg';
import { assertTestDatabase } from '../test-env';

async function withClient<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function ownerUrl(): string {
  const url = process.env.DIRECT_DATABASE_URL ?? '';
  assertTestDatabase(url);
  return url;
}

/** Runs SQL as the schema owner (can do what the app role cannot). */
export function ownerQuery<R extends QueryResultRow>(sql: string, params: unknown[] = []) {
  return withClient(ownerUrl(), (client) => client.query<R>(sql, params));
}

/** Runs SQL as the restricted runtime role the API uses. */
export function appRoleQuery<R extends QueryResultRow>(sql: string, params: unknown[] = []) {
  return withClient(process.env.DATABASE_URL ?? '', (client) => client.query<R>(sql, params));
}

/** Empties every table. Needs the owner role because the app role cannot delete audit rows. */
export async function truncateAll(): Promise<void> {
  await ownerQuery(
    `TRUNCATE "AuditTrail", "DocumentField", "DocumentVersion", "Recipient",
              "Envelope", "Session", "User", "Tenant" RESTART IDENTITY CASCADE`,
  );
}
