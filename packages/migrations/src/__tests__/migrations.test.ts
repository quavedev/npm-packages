import { Migrations } from '../migrations';
import { FakeBackend, runBackendContract, createFakeBackend } from '../testing';

runBackendContract('FakeBackend', () => new FakeBackend());

describe('Migrations (core orchestrator)', () => {
  let backend: FakeBackend;
  let migrations: Migrations<{ calls: string[] }>;

  beforeEach(async () => {
    backend = createFakeBackend();
    migrations = new Migrations(backend, { log: false });
  });

  describe('Basic functionality', () => {
    it('adds migrations and sorts them by version', () => {
      migrations.add({ version: 3, name: 'Third', up: async () => {} });
      migrations.add({ version: 1, name: 'First', up: async () => {} });
      migrations.add({ version: 2, name: 'Second', up: async () => {} });

      expect((migrations as any).migrations.map((m: any) => m.version)).toEqual([1, 2, 3]);
    });

    it('freezes migrations on add', () => {
      const m = { version: 1, up: async () => {} };
      migrations.add(m);
      expect(Object.isFrozen(m)).toBe(true);
    });

    it('rejects invalid migrations', () => {
      expect(() => migrations.add({ version: 1 } as any)).toThrow('must supply an up function');
      expect(() => migrations.add({ up: async () => {} } as any)).toThrow('must supply a version number');
      expect(() => migrations.add({ version: 0, up: async () => {} })).toThrow('must be greater than 0');
    });

    it('migrates up to latest version', async () => {
      const runOrder: number[] = [];
      migrations.add({ version: 1, up: async () => { runOrder.push(1); } });
      migrations.add({ version: 2, up: async () => { runOrder.push(2); } });

      const result = await migrations.migrateTo('latest');

      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(2);
      expect(runOrder).toEqual([1, 2]);
      expect(await migrations.getVersion()).toBe(2);
    });

    it('passes backend context to up/down functions', async () => {
      let upCtx: unknown;
      let downCtx: unknown;
      migrations.add({
        version: 1,
        up: async (_m, ctx) => {
          upCtx = ctx;
          ctx.calls.push('up1');
        },
        down: async (_m, ctx) => {
          downCtx = ctx;
          ctx.calls.push('down1');
        },
      });

      await migrations.migrateTo(1);
      await migrations.migrateTo(0);

      expect(upCtx).toBe(backend.getContext());
      expect(downCtx).toBe(backend.getContext());
      expect(backend.getContext().calls).toEqual(['up1', 'down1']);
    });

    it('does not run migrations if already at target version', async () => {
      const runCount = { n: 0 };
      migrations.add({ version: 1, up: async () => { runCount.n++; } });

      await migrations.migrateTo(1);
      expect(runCount.n).toBe(1);

      await migrations.migrateTo(1);
      expect(runCount.n).toBe(1);
    });

    it('migrates down to specific version', async () => {
      const order: string[] = [];
      migrations.add({
        version: 1,
        up: async () => { order.push('up1'); },
        down: async () => { order.push('down1'); },
      });
      migrations.add({
        version: 2,
        up: async () => { order.push('up2'); },
        down: async () => { order.push('down2'); },
      });

      await migrations.migrateTo('latest');
      expect(order).toEqual(['up1', 'up2']);

      const result = await migrations.migrateTo(0);
      expect(result.success).toBe(true);
      expect(order).toEqual(['up1', 'up2', 'down2', 'down1']);
      expect(await migrations.getVersion()).toBe(0);
    });

    it('migrates down to intermediate version', async () => {
      const order: string[] = [];
      migrations.add({
        version: 1,
        up: async () => { order.push('up1'); },
        down: async () => { order.push('down1'); },
      });
      migrations.add({
        version: 2,
        up: async () => { order.push('up2'); },
        down: async () => { order.push('down2'); },
      });
      migrations.add({
        version: 3,
        up: async () => { order.push('up3'); },
        down: async () => { order.push('down3'); },
      });

      await migrations.migrateTo('latest');
      await migrations.migrateTo(1);
      expect(order).toEqual(['up1', 'up2', 'up3', 'down3', 'down2']);
      expect(await migrations.getVersion()).toBe(1);
    });

    it('throws when a referenced version does not exist', async () => {
      migrations.add({ version: 1, up: async () => {} });
      const result = await migrations.migrateTo(99);
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/Can't find migration version 99/);
    });

    it('throws when migrating down on a migration without a down fn', async () => {
      migrations.add({ version: 1, up: async () => {} });
      await migrations.migrateTo('latest');
      const result = await migrations.migrateTo(0);
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/Cannot migrate down/);
    });
  });

  describe('Error handling', () => {
    it('catches migration errors and returns success:false', async () => {
      migrations.add({
        version: 1,
        up: async () => { throw new Error('Migration failed'); },
      });
      const result = await migrations.migrateTo('latest');
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('Migration failed');
    });

    it('unlocks after a failed migration', async () => {
      migrations.add({
        version: 1,
        up: async () => { throw new Error('Migration failed'); },
      });

      const first = await migrations.migrateTo('latest');
      expect(first.success).toBe(false);
      expect((await backend.getControl()).locked).toBe(false);

      const other = new Migrations(backend, { log: false });
      other.add({ version: 2, up: async () => {} });
      const second = await other.migrateTo('latest');
      expect(second.success).toBe(true);
    });

    it('throws for invalid command', async () => {
      migrations.add({ version: 1, up: async () => {} });
      await expect(migrations.migrateTo('')).rejects.toThrow(/invalid command/);
    });

    it('throws for migrateTo when no migrations added', async () => {
      await expect(migrations.migrateTo('latest')).rejects.toThrow(/invalid command/);
    });
  });

  describe('Locking mechanism', () => {
    it('prevents concurrent migrations', async () => {
      let started = false;
      migrations.add({
        version: 1,
        up: async () => {
          started = true;
          await new Promise((r) => setTimeout(r, 50));
        },
      });

      const first = migrations.migrateTo('latest');
      while (!started) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const second = migrations.migrateTo('latest');

      const [a, b] = await Promise.all([first, second]);
      expect(a.success).toBe(true);
      expect(b.success).toBe(false);
      expect(b.error?.message).toBe('Migration control is locked');
    });
  });

  describe('Rerun functionality', () => {
    it('reruns a specific migration', async () => {
      let runCount = 0;
      migrations.add({ version: 1, up: async () => { runCount++; } });

      await migrations.migrateTo(1);
      expect(runCount).toBe(1);

      await migrations.migrateTo('1,rerun');
      expect(runCount).toBe(2);
    });
  });

  describe('Command parsing', () => {
    it('parses numeric commands', async () => {
      migrations.add({ version: 1, up: async () => {} });
      expect((await migrations.migrateTo(1)).success).toBe(true);
    });

    it('parses string commands with subcommands', async () => {
      migrations.add({ version: 1, up: async () => {} });
      expect((await migrations.migrateTo('1,rerun')).success).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('allows configuration updates', () => {
      const logger = jest.fn();
      migrations.config({ log: true, logger });
      expect((migrations as any).options.logger).toBe(logger);
    });
  });

  describe('Init', () => {
    it('calls backend.init once, lazily', async () => {
      const spy = jest.spyOn(backend, 'init');
      migrations.add({ version: 1, up: async () => {} });
      expect(spy).not.toHaveBeenCalled();

      await migrations.getVersion();
      expect(spy).toHaveBeenCalledTimes(1);

      await migrations.migrateTo(1);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
