import { newDb, IMemoryDb } from 'pg-mem';
import type { Pool } from 'pg';
import { runBackendContract } from '@quave/migrations/testing';
import { PostgresBackend } from '../postgresBackend';
import { createPostgresMigrations } from '../index';

function makePool(db: IMemoryDb): Pool {
  const { Pool } = db.adapters.createPg();
  return new Pool() as unknown as Pool;
}

runBackendContract('PostgresBackend (pg-mem)', () => {
  const db = newDb({ noAstCoverageCheck: true });
  const pool = makePool(db);
  return new PostgresBackend({ pool });
});

describe('createPostgresMigrations end-to-end (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;

  beforeEach(() => {
    db = newDb({ noAstCoverageCheck: true });
    pool = makePool(db);
  });

  it('runs up and down migrations using ctx.query', async () => {
    const migrations = createPostgresMigrations({ pool, log: false });
    const order: string[] = [];

    migrations.add({
      version: 1,
      name: 'create widgets',
      up: async (_m, { query }) => {
        order.push('up1');
        await query('CREATE TABLE widgets (id SERIAL PRIMARY KEY, name TEXT NOT NULL);');
      },
      down: async (_m, { query }) => {
        order.push('down1');
        await query('DROP TABLE widgets;');
      },
    });
    migrations.add({
      version: 2,
      name: 'seed widgets',
      up: async (_m, { query }) => {
        order.push('up2');
        await query("INSERT INTO widgets (name) VALUES ('foo'), ('bar');");
      },
      down: async (_m, { query }) => {
        order.push('down2');
        await query('DELETE FROM widgets;');
      },
    });

    const up = await migrations.migrateTo('latest');
    expect(up.success).toBe(true);
    expect(up.migrationsRun).toBe(2);
    expect(order).toEqual(['up1', 'up2']);
    expect(await migrations.getVersion()).toBe(2);

    const countRes = await pool.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM widgets;');
    expect(Number(countRes.rows[0]?.count ?? 0)).toBe(2);

    const down = await migrations.migrateTo(0);
    expect(down.success).toBe(true);
    expect(order).toEqual(['up1', 'up2', 'down2', 'down1']);
    expect(await migrations.getVersion()).toBe(0);
  });

  it('respects schemaName + tableName options', async () => {
    await pool.query('CREATE SCHEMA app;');
    const migrations = createPostgresMigrations({
      pool,
      schemaName: 'app',
      tableName: 'mig_state',
      log: false,
    });
    migrations.add({ version: 1, up: async () => {} });
    const result = await migrations.migrateTo('latest');
    expect(result.success).toBe(true);

    const row = await pool.query<{ version: number }>(
      'SELECT version FROM app.mig_state WHERE id = $1',
      ['control'],
    );
    expect(row.rows[0]?.version).toBe(1);
  });

  it('unlocks after a migration throws', async () => {
    const migrations = createPostgresMigrations({ pool, log: false });
    migrations.add({
      version: 1,
      up: async () => { throw new Error('boom'); },
    });
    const result = await migrations.migrateTo('latest');
    expect(result.success).toBe(false);

    const row = await pool.query<{ locked: boolean }>(
      "SELECT locked FROM public.migrations_control WHERE id = 'control';",
    );
    expect(row.rows[0]?.locked).toBe(false);
  });

  it('exposes the pool on ctx so users can do multi-statement work', async () => {
    const migrations = createPostgresMigrations({ pool, log: false });
    let receivedPool: unknown;
    migrations.add({
      version: 1,
      up: async (_m, ctx) => {
        receivedPool = ctx.pool;
        await ctx.query('CREATE TABLE noop (id INT);');
      },
    });
    await migrations.migrateTo('latest');
    expect(receivedPool).toBe(pool);
  });

  it('second migrateTo while first holds the lock returns success:false', async () => {
    // pg-mem is single-threaded JS — we simulate contention by manually locking
    // the row before a second migrateTo runs, and asserting the second call
    // sees "control is locked".
    const backend = new PostgresBackend({ pool });
    await backend.init();
    expect(await backend.tryLock()).toBe(true);

    const migrations = createPostgresMigrations({ pool, log: false });
    migrations.add({ version: 1, up: async () => {} });
    const blocked = await migrations.migrateTo('latest');
    expect(blocked.success).toBe(false);
    expect(blocked.error?.message).toBe('Migration control is locked');

    await backend.unlock();
    const ok = await migrations.migrateTo('latest');
    expect(ok.success).toBe(true);
  });
});
