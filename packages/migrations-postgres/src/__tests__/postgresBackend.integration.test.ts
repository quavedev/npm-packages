import { Pool } from 'pg';
import { runBackendContract } from '@quave/migrations/testing';
import { PostgresBackend } from '../postgresBackend';

const connectionString =
  process.env['POSTGRES_URL'] ??
  process.env['DATABASE_URL'] ??
  (process.env['PGHOST'] ? `postgres://${process.env['PGUSER'] ?? 'postgres'}@${process.env['PGHOST']}:${process.env['PGPORT'] ?? '5432'}/${process.env['PGDATABASE'] ?? 'postgres'}` : '');

const describeOrSkip = connectionString ? describe : describe.skip;

describeOrSkip('PostgresBackend real-cluster integration', () => {
  let pool: Pool;
  const tableName = `migrations_control_test_${process.pid}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS public."${tableName}";`);
    await pool.end();
  });

  runBackendContract(
    'PostgresBackend (real)',
    () => new PostgresBackend({ pool, tableName }),
  );

  it('exactly one of N concurrent tryLock calls wins (distributed lock)', async () => {
    const backends = Array.from(
      { length: 10 },
      () => new PostgresBackend({ pool, tableName }),
    );
    await backends[0]!.init();
    await backends[0]!.reset();
    await Promise.all(backends.map((b) => b.init()));

    const results = await Promise.all(backends.map((b) => b.tryLock()));
    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);

    for (const b of backends) {
      await b.unlock();
    }
  }, 30_000);
});
