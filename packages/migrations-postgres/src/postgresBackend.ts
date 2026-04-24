import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { MigrationBackend, ControlState } from '@quave/migrations';
import {
  qualify,
  createTableSql,
  seedRowSql,
  tryLockSql,
  unlockSql,
  setVersionSql,
  getControlSql,
  resetSql,
} from './sql';

export interface PostgresBackendOptions {
  pool?: Pool;
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  schemaName?: string;
  tableName?: string;
  /**
   * Extra PoolConfig passed through when we construct the Pool ourselves.
   * Ignored if `pool` is supplied directly.
   */
  poolConfig?: PoolConfig;
}

export interface PostgresContext {
  pool: Pool;
  query: <R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ) => Promise<QueryResult<R>>;
}

export class PostgresBackend implements MigrationBackend<PostgresContext> {
  private pool: Pool;
  private qualifiedTable: string;
  private ownsPool: boolean;

  constructor(opts: PostgresBackendOptions = {}) {
    if (opts.pool) {
      this.pool = opts.pool;
      this.ownsPool = false;
    } else {
      const config: PoolConfig = { ...opts.poolConfig };
      if (opts.connectionString) config.connectionString = opts.connectionString;
      if (opts.host !== undefined) config.host = opts.host;
      if (opts.port !== undefined) config.port = opts.port;
      if (opts.user !== undefined) config.user = opts.user;
      if (opts.password !== undefined) config.password = opts.password;
      if (opts.database !== undefined) config.database = opts.database;
      this.pool = new Pool(config);
      this.ownsPool = true;
    }
    this.qualifiedTable = qualify(opts.schemaName ?? 'public', opts.tableName ?? 'migrations_control');
  }

  async init(): Promise<void> {
    await this.pool.query(createTableSql(this.qualifiedTable));
    await this.pool.query(seedRowSql(this.qualifiedTable));
  }

  async getControl(): Promise<ControlState> {
    const res = await this.pool.query(getControlSql(this.qualifiedTable));
    const row = res.rows[0] as { version?: number | string; locked?: boolean; locked_at?: Date | string | null } | undefined;
    if (!row) {
      return { version: 0, locked: false };
    }
    const state: ControlState = {
      version: Number(row.version ?? 0),
      locked: Boolean(row.locked),
    };
    if (row.locked_at instanceof Date) {
      state.lockedAt = row.locked_at;
    } else if (typeof row.locked_at === 'string' && row.locked_at) {
      state.lockedAt = new Date(row.locked_at);
    }
    return state;
  }

  async tryLock(): Promise<boolean> {
    const res = await this.pool.query(tryLockSql(this.qualifiedTable));
    return (res.rowCount ?? 0) === 1;
  }

  async unlock(): Promise<void> {
    await this.pool.query(unlockSql(this.qualifiedTable));
  }

  async setVersion(version: number): Promise<void> {
    await this.pool.query(setVersionSql(this.qualifiedTable), [version]);
  }

  getContext(): PostgresContext {
    return {
      pool: this.pool,
      query: (sql, params) => this.pool.query(sql, params as unknown[]),
    };
  }

  async reset(): Promise<void> {
    await this.pool.query(resetSql(this.qualifiedTable));
  }

  /**
   * Close the Pool if this backend created it. No-op if the caller supplied one.
   */
  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}
