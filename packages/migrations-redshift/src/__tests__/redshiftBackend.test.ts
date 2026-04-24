import { runBackendContract } from '@quave/migrations/testing';
import { RedshiftBackend } from '../redshiftBackend';
import { createRedshiftMigrations } from '../index';
import { createHarness, createSimState } from './harness';

runBackendContract('RedshiftBackend', () => {
  const harness = createHarness(createSimState());
  return new RedshiftBackend({
    database: 'dev',
    workgroupName: 'test-wg',
    client: harness.client,
    pollIntervalMs: 1,
    pollMaxIntervalMs: 2,
  });
});

describe('RedshiftBackend auth validation', () => {
  it('requires database', () => {
    expect(() =>
      new RedshiftBackend({
        database: '',
        workgroupName: 'wg',
      }),
    ).toThrow(/database.*required/i);
  });

  it('rejects both cluster + workgroup', () => {
    expect(() =>
      new RedshiftBackend({
        database: 'dev',
        clusterIdentifier: 'c1',
        workgroupName: 'wg',
        dbUser: 'u',
      }),
    ).toThrow(/exactly one/i);
  });

  it('rejects neither cluster nor workgroup', () => {
    expect(() =>
      new RedshiftBackend({
        database: 'dev',
      }),
    ).toThrow(/exactly one/i);
  });

  it('requires dbUser or secretArn for provisioned clusters', () => {
    expect(() =>
      new RedshiftBackend({
        database: 'dev',
        clusterIdentifier: 'c1',
      }),
    ).toThrow(/dbUser.*secretArn/i);
  });

  it('accepts serverless workgroup config', () => {
    expect(() =>
      new RedshiftBackend({
        database: 'dev',
        workgroupName: 'wg',
      }),
    ).not.toThrow();
  });
});

describe('RedshiftBackend lock semantics', () => {
  it('returns false when UPDATE fails with a serialization error', async () => {
    const harness = createHarness();
    const backend = new RedshiftBackend({
      database: 'dev',
      workgroupName: 'wg',
      client: harness.client,
      pollIntervalMs: 1,
      pollMaxIntervalMs: 2,
    });
    await backend.init();
    harness.injectSerializationOn((sql) => /SET locked = TRUE/i.test(sql));
    expect(await backend.tryLock()).toBe(false);
  });

  it('returns false when another caller won (nonce mismatch)', async () => {
    const harness = createHarness();
    const backend = new RedshiftBackend({
      database: 'dev',
      workgroupName: 'wg',
      client: harness.client,
      pollIntervalMs: 1,
      pollMaxIntervalMs: 2,
    });
    await backend.init();
    // Simulate another process already holding the lock with a different nonce.
    harness.state.locked = true;
    harness.state.lock_nonce = 'someone-elses-nonce';
    expect(await backend.tryLock()).toBe(false);
  });
});

describe('DataApiExecutor throttling', () => {
  it('retries on ThrottlingException then succeeds', async () => {
    const harness = createHarness();
    const backend = new RedshiftBackend({
      database: 'dev',
      workgroupName: 'wg',
      client: harness.client,
      pollIntervalMs: 1,
      pollMaxIntervalMs: 2,
      maxThrottleRetries: 3,
    });
    harness.injectThrottle(2);
    await expect(backend.init()).resolves.toBeUndefined();
  });

  it('surfaces the error after exhausting retries', async () => {
    const harness = createHarness();
    const backend = new RedshiftBackend({
      database: 'dev',
      workgroupName: 'wg',
      client: harness.client,
      pollIntervalMs: 1,
      pollMaxIntervalMs: 2,
      maxThrottleRetries: 1,
    });
    harness.injectThrottle(5);
    await expect(backend.init()).rejects.toThrow(/rate exceeded/);
  });
});

describe('createRedshiftMigrations end-to-end', () => {
  it('runs up and down migrations that use ctx.execute', async () => {
    const harness = createHarness();
    const migrations = createRedshiftMigrations({
      database: 'dev',
      workgroupName: 'wg',
      client: harness.client,
      pollIntervalMs: 1,
      pollMaxIntervalMs: 2,
      log: false,
    });

    const calls: string[] = [];
    migrations.add({
      version: 1,
      name: 'create widgets',
      up: async (_m, ctx) => {
        calls.push('up1');
        await ctx.execute('CREATE TABLE widgets (id INT);');
      },
      down: async (_m, ctx) => {
        calls.push('down1');
        await ctx.execute('DROP TABLE widgets;');
      },
    });
    migrations.add({
      version: 2,
      name: 'add index',
      up: async () => { calls.push('up2'); },
      down: async () => { calls.push('down2'); },
    });

    const up = await migrations.migrateTo('latest');
    expect(up.success).toBe(true);
    expect(up.migrationsRun).toBe(2);
    expect(calls).toEqual(['up1', 'up2']);
    expect(await migrations.getVersion()).toBe(2);

    const down = await migrations.migrateTo(0);
    expect(down.success).toBe(true);
    expect(calls).toEqual(['up1', 'up2', 'down2', 'down1']);
    expect(await migrations.getVersion()).toBe(0);
  });

  it('unlocks after a migration throws', async () => {
    const harness = createHarness();
    const migrations = createRedshiftMigrations({
      database: 'dev',
      workgroupName: 'wg',
      client: harness.client,
      pollIntervalMs: 1,
      pollMaxIntervalMs: 2,
      log: false,
    });
    migrations.add({
      version: 1,
      up: async () => { throw new Error('boom'); },
    });
    const result = await migrations.migrateTo('latest');
    expect(result.success).toBe(false);
    expect(harness.state.locked).toBe(false);
  });
});
