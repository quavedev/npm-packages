import { randomUUID } from 'node:crypto';
import { RedshiftDataClient, SqlParameter } from '@aws-sdk/client-redshift-data';
import { MigrationBackend, ControlState } from '@quave/migrations';
import {
  DataApiExecutor,
  ExecutorOpts,
  ExecuteResult,
  RedshiftStatementError,
  isSerializationError,
} from './dataApiClient';
import {
  qualify,
  createTableSql,
  seedRowSql,
  tryLockSql,
  readNonceSql,
  unlockSql,
  setVersionSql,
  getControlSql,
  resetSql,
} from './sql';

export interface RedshiftContext {
  execute: (sql: string, params?: SqlParameter[]) => Promise<ExecuteResult>;
}

export interface RedshiftBackendOptions extends ExecutorOpts {
  database: string;
  clusterIdentifier?: string;
  workgroupName?: string;
  dbUser?: string;
  secretArn?: string;
  region?: string;
  schemaName?: string;
  tableName?: string;
  client?: RedshiftDataClient;
}

export class RedshiftBackend implements MigrationBackend<RedshiftContext> {
  private executor: DataApiExecutor;
  private qualifiedTable: string;
  private initialized = false;

  constructor(opts: RedshiftBackendOptions) {
    validateAuth(opts);

    const client =
      opts.client ??
      new RedshiftDataClient({
        ...(opts.region ? { region: opts.region } : {}),
      });

    const auth = {
      database: opts.database,
      ...(opts.clusterIdentifier ? { clusterIdentifier: opts.clusterIdentifier } : {}),
      ...(opts.workgroupName ? { workgroupName: opts.workgroupName } : {}),
      ...(opts.dbUser ? { dbUser: opts.dbUser } : {}),
      ...(opts.secretArn ? { secretArn: opts.secretArn } : {}),
    };

    const executorOpts: ExecutorOpts = {};
    if (opts.pollIntervalMs !== undefined) executorOpts.pollIntervalMs = opts.pollIntervalMs;
    if (opts.pollMaxIntervalMs !== undefined) executorOpts.pollMaxIntervalMs = opts.pollMaxIntervalMs;
    if (opts.statementTimeoutMs !== undefined) executorOpts.statementTimeoutMs = opts.statementTimeoutMs;
    if (opts.maxThrottleRetries !== undefined) executorOpts.maxThrottleRetries = opts.maxThrottleRetries;

    this.executor = new DataApiExecutor(client, auth, executorOpts);
    this.qualifiedTable = qualify(opts.schemaName ?? 'public', opts.tableName ?? 'migrations_control');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.executor.execute(createTableSql(this.qualifiedTable));
    await this.executor.execute(seedRowSql(this.qualifiedTable));
    this.initialized = true;
  }

  async getControl(): Promise<ControlState> {
    const result = await this.executor.execute(getControlSql(this.qualifiedTable));
    const row = result.rows[0];
    if (!row) {
      return { version: 0, locked: false };
    }
    const state: ControlState = {
      version: Number(row['version'] ?? 0),
      locked: Boolean(row['locked']),
    };
    const lockedAt = row['locked_at'];
    if (lockedAt instanceof Date) {
      state.lockedAt = lockedAt;
    } else if (typeof lockedAt === 'string' && lockedAt) {
      state.lockedAt = new Date(lockedAt);
    }
    return state;
  }

  async tryLock(): Promise<boolean> {
    const nonce = randomUUID();
    try {
      await this.executor.execute(tryLockSql(this.qualifiedTable), [
        { name: 'nonce', value: nonce },
      ]);
    } catch (err) {
      if (err instanceof RedshiftStatementError && isSerializationError((err as { errorText?: string }).errorText ?? err.message)) {
        return false;
      }
      throw err;
    }

    const readback = await this.executor.execute(readNonceSql(this.qualifiedTable));
    const row = readback.rows[0];
    return row?.['lock_nonce'] === nonce;
  }

  async unlock(): Promise<void> {
    await this.executor.execute(unlockSql(this.qualifiedTable));
  }

  async setVersion(version: number): Promise<void> {
    await this.executor.execute(setVersionSql(this.qualifiedTable), [
      { name: 'version', value: String(version) },
    ]);
  }

  getContext(): RedshiftContext {
    return {
      execute: (sql, params) => this.executor.execute(sql, params),
    };
  }

  async reset(): Promise<void> {
    await this.executor.execute(resetSql(this.qualifiedTable));
    this.initialized = false;
  }
}

function validateAuth(opts: RedshiftBackendOptions): void {
  if (!opts.database) {
    throw new Error('RedshiftBackend: `database` is required');
  }
  const hasCluster = !!opts.clusterIdentifier;
  const hasWorkgroup = !!opts.workgroupName;
  if (hasCluster === hasWorkgroup) {
    throw new Error(
      'RedshiftBackend: provide exactly one of `clusterIdentifier` (provisioned) or `workgroupName` (serverless)',
    );
  }
  if (hasCluster && !opts.dbUser && !opts.secretArn) {
    throw new Error(
      'RedshiftBackend: provisioned clusters require `dbUser` or `secretArn`',
    );
  }
}
