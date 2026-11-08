/**
 * Starts the owner's MCP server on stdio: local Supabase by default, production only with
 * `CRONISTA_MCP_TARGET=prod`. Claude Code launches it from `.mcp.json`, through `pnpm with-secrets`
 * for the Voyage key that searches need.
 *
 * @packageDocumentation
 */
import { createVoyage } from '@cronista/memory-tools';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { createMemoryServer } from './memory-server.ts';
import { connectReader, createPostgresReads } from './postgres-reads.ts';
import { targetFrom } from './target.ts';

const target = targetFrom(process.env);
if (!target.ok) {
  // stdout carries the protocol, so everything else goes to stderr.
  console.error(target.error);
  process.exit(1);
}

const apiKey = process.env.VOYAGE_API_KEY;

// `pnpm with-secrets` hands over every local secret; this long-lived process keeps none it read.
for (const name of Object.keys(process.env)) {
  if (/(KEY|SECRET|TOKEN|PASSWORD|_URL)$/i.test(name)) Reflect.deleteProperty(process.env, name);
}

const embedQueries =
  apiKey === undefined || apiKey === ''
    ? () => Promise.resolve({ ok: false as const, error: 'technical' as const, usage: [] })
    : createVoyage({ apiKey, workspace: 'dev' }).embedQueries;

const sql = connectReader(target.value.url);
const server = createMemoryServer({
  reads: createPostgresReads(sql),
  embedQueries,
  clock: () => new Date(),
});

console.error(
  `cronista-memory reads ${target.value.kind === 'prod' ? 'PRODUCTION' : 'local Supabase'}`,
);
await server.connect(new StdioServerTransport());

const close = async () => {
  await server.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
