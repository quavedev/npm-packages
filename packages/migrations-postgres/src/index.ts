import { Migrations, MigrationOptions } from '@quave/migrations';
import { PostgresBackend, PostgresBackendOptions, PostgresContext } from './postgresBackend';

export { PostgresBackend } from './postgresBackend';
export type { PostgresBackendOptions, PostgresContext } from './postgresBackend';

export function createPostgresMigrations(
  opts: PostgresBackendOptions & MigrationOptions = {},
): Migrations<PostgresContext> {
  const {
    log,
    logger,
    logIfLatest,
    pool,
    connectionString,
    host,
    port,
    user,
    password,
    database,
    schemaName,
    tableName,
    poolConfig,
  } = opts;

  const migrationOpts: MigrationOptions = {};
  if (log !== undefined) migrationOpts.log = log;
  if (logger !== undefined) migrationOpts.logger = logger;
  if (logIfLatest !== undefined) migrationOpts.logIfLatest = logIfLatest;

  const backendOpts: PostgresBackendOptions = {};
  if (pool !== undefined) backendOpts.pool = pool;
  if (connectionString !== undefined) backendOpts.connectionString = connectionString;
  if (host !== undefined) backendOpts.host = host;
  if (port !== undefined) backendOpts.port = port;
  if (user !== undefined) backendOpts.user = user;
  if (password !== undefined) backendOpts.password = password;
  if (database !== undefined) backendOpts.database = database;
  if (schemaName !== undefined) backendOpts.schemaName = schemaName;
  if (tableName !== undefined) backendOpts.tableName = tableName;
  if (poolConfig !== undefined) backendOpts.poolConfig = poolConfig;

  return new Migrations(new PostgresBackend(backendOpts), migrationOpts);
}
