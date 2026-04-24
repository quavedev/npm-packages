import { Migrations, MigrationOptions } from '@quave/migrations';
import { RedshiftBackend, RedshiftBackendOptions, RedshiftContext } from './redshiftBackend';

export { RedshiftBackend } from './redshiftBackend';
export type { RedshiftBackendOptions, RedshiftContext } from './redshiftBackend';
export { RedshiftStatementError, isSerializationError } from './dataApiClient';
export type { ExecuteResult, DataApiExecutor } from './dataApiClient';

export function createRedshiftMigrations(
  opts: RedshiftBackendOptions & MigrationOptions,
): Migrations<RedshiftContext> {
  const { log, logger, logIfLatest, ...backendOpts } = opts;
  const migrationOpts: MigrationOptions = {};
  if (log !== undefined) migrationOpts.log = log;
  if (logger !== undefined) migrationOpts.logger = logger;
  if (logIfLatest !== undefined) migrationOpts.logIfLatest = logIfLatest;
  return new Migrations(new RedshiftBackend(backendOpts), migrationOpts);
}
