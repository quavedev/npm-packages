import { Migrations } from '../migrations';
import { MongoClient, Db } from 'mongodb';

describe('Migrations', () => {
  let client: MongoClient;
  let db: Db;
  let migrations: Migrations;

  beforeAll(async () => {
    client = new MongoClient('mongodb://localhost:27017');
    await client.connect();
    db = client.db('migrations_test');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    migrations = new Migrations({ log: false });
    migrations.setDatabase(db);
    await migrations.reset();
  });

  afterEach(async () => {
    await db.dropDatabase();
  });

  describe('Basic functionality', () => {
    it('should add migrations and sort them by version', () => {
      const runOrder: number[] = [];

      migrations.add({
        version: 3,
        name: 'Third',
        up: async () => { runOrder.push(3); },
      });

      migrations.add({
        version: 1,
        name: 'First',
        up: async () => { runOrder.push(1); },
      });

      migrations.add({
        version: 2,
        name: 'Second',
        up: async () => { runOrder.push(2); },
      });

      expect(migrations['migrations'].map(m => m.version)).toEqual([1, 2, 3]);
    });

    it('should migrate up to latest version', async () => {
      const runOrder: number[] = [];

      migrations.add({
        version: 1,
        name: 'First',
        up: async () => { runOrder.push(1); },
      });

      migrations.add({
        version: 2,
        name: 'Second',
        up: async () => { runOrder.push(2); },
      });

      const result = await migrations.migrateTo('latest');

      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(2);
      expect(runOrder).toEqual([1, 2]);
      expect(await migrations.getVersion()).toBe(2);
    });

    it('should not run migrations if already at target version', async () => {
      const runCount = { count: 0 };

      migrations.add({
        version: 1,
        name: 'First',
        up: async () => { runCount.count++; },
      });

      await migrations.migrateTo(1);
      expect(runCount.count).toBe(1);

      await migrations.migrateTo(1);
      expect(runCount.count).toBe(1); // Should not run again
    });

    it('should migrate down to specific version', async () => {
      const runOrder: string[] = [];

      migrations.add({
        version: 1,
        name: 'First',
        up: async () => { runOrder.push('up1'); },
        down: async () => { runOrder.push('down1'); },
      });

      migrations.add({
        version: 2,
        name: 'Second',
        up: async () => { runOrder.push('up2'); },
        down: async () => { runOrder.push('down2'); },
      });

      await migrations.migrateTo('latest');
      expect(runOrder).toEqual(['up1', 'up2']);

      const result = await migrations.migrateTo(0);
      expect(result.success).toBe(true);
      expect(runOrder).toEqual(['up1', 'up2', 'down2', 'down1']);
      expect(await migrations.getVersion()).toBe(0);
    });
  });

  describe('Error handling', () => {
    it('should handle migration errors gracefully', async () => {
      migrations.add({
        version: 1,
        name: 'Failing migration',
        up: async () => {
          throw new Error('Migration failed');
        },
      });

      const result = await migrations.migrateTo('latest');

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('Migration failed');
    });

    it('should unlock when migration fails', async () => {
      migrations.add({
        version: 1,
        name: 'Failing migration',
        up: async () => {
          throw new Error('Migration failed');
        },
      });

      const firstResult = await migrations.migrateTo('latest');
      expect(firstResult.success).toBe(false);
      
      // Check current version after failure
      const currentVersion = await migrations.getVersion();
      expect(currentVersion).toBe(0);
      
      // Re-instantiate migrations to avoid retrying the failing migration
      migrations = new Migrations({ log: false });
      migrations.setDatabase(db);
      
      migrations.add({
        version: 2,
        name: 'Working migration',
        up: async () => {},
      });

      const result = await migrations.migrateTo('latest');
      expect(result.success).toBe(true);
    });

    it('should throw error when database is not set', async () => {
      const migrationsWithoutDb = new Migrations();
      
      await expect(migrationsWithoutDb.migrateTo('latest')).rejects.toThrow(
        'Database connection not set. Call setDatabase() first.'
      );
    });
  });

  describe('Locking mechanism', () => {
    it('should prevent concurrent migrations', async () => {
      let migrationStarted = false;

      migrations.add({
        version: 1,
        name: 'Slow migration',
        up: async () => {
          migrationStarted = true;
          await new Promise(resolve => setTimeout(resolve, 100));
        },
      });

      // Start first migration
      const firstMigration = migrations.migrateTo('latest');

      // Wait for migration to start
      while (!migrationStarted) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Try to start second migration
      const secondMigration = migrations.migrateTo('latest');

      const firstResult = await firstMigration;
      const secondResult = await secondMigration;

      expect(firstResult.success).toBe(true);
      expect(secondResult.success).toBe(false);
      expect(secondResult.error?.message).toBe('Migration control is locked');
    });
  });

  describe('Rerun functionality', () => {
    it('should rerun a specific migration', async () => {
      let runCount = 0;

      migrations.add({
        version: 1,
        name: 'Rerun test',
        up: async () => { runCount++; },
      });

      await migrations.migrateTo(1);
      expect(runCount).toBe(1);

      await migrations.migrateTo('1,rerun');
      expect(runCount).toBe(2);
    });
  });

  describe('Command parsing', () => {
    it('should parse numeric commands', async () => {
      migrations.add({
        version: 1,
        name: 'Test',
        up: async () => {},
      });

      const result = await migrations.migrateTo(1);
      expect(result.success).toBe(true);
    });

    it('should parse string commands with subcommands', async () => {
      migrations.add({
        version: 1,
        name: 'Test',
        up: async () => {},
      });

      const result = await migrations.migrateTo('1,rerun');
      expect(result.success).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should allow configuration updates', () => {
      const logger = jest.fn();
      
      migrations.config({
        log: true,
        logger,
        collectionName: 'custom_migrations'
      });

      expect(migrations['options'].logger).toBe(logger);
      expect(migrations['options'].collectionName).toBe('custom_migrations');
    });
  });
}); 