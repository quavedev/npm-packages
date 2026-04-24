import { MongoClient, Db } from 'mongodb';
import { runBackendContract } from '@quave/migrations/testing';
import { MongoBackend, createMongoMigrations } from '../index';

const MONGO_URL = process.env['MONGO_URL'] ?? 'mongodb://localhost:27017';
const DB_NAME = process.env['MONGO_DB'] ?? 'migrations_test';

let client: MongoClient;
let db: Db;

beforeAll(async () => {
  client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
});

afterAll(async () => {
  await client.close();
});

runBackendContract('MongoBackend', async () => {
  await db.collection('migrations').deleteMany({});
  return new MongoBackend(db);
});

describe('createMongoMigrations end-to-end', () => {
  beforeEach(async () => {
    await db.collection('migrations').deleteMany({});
  });

  afterEach(async () => {
    await db.dropDatabase();
  });

  it('runs migrations that use the injected ctx.db', async () => {
    const migrations = createMongoMigrations(db, { log: false });
    migrations.add({
      version: 1,
      name: 'Create widgets',
      up: async (_m, ctx) => {
        await ctx.db.collection('widgets').insertOne({ name: 'foo' });
      },
      down: async (_m, ctx) => {
        await ctx.db.collection('widgets').drop();
      },
    });

    const up = await migrations.migrateTo('latest');
    expect(up.success).toBe(true);
    expect(await db.collection('widgets').countDocuments()).toBe(1);

    const down = await migrations.migrateTo(0);
    expect(down.success).toBe(true);
    expect(await db.listCollections({ name: 'widgets' }).toArray()).toHaveLength(0);
  });

  it('respects collectionName option', async () => {
    const migrations = createMongoMigrations(db, {
      log: false,
      collectionName: 'custom_migrations',
    });
    migrations.add({ version: 1, up: async () => {} });
    await migrations.migrateTo('latest');

    const control = await db
      .collection<{ _id: string; version: number }>('custom_migrations')
      .findOne({ _id: 'control' });
    expect(control?.version).toBe(1);
  });

  it('unlocks after a migration fails', async () => {
    const first = createMongoMigrations(db, { log: false });
    first.add({
      version: 1,
      up: async () => { throw new Error('boom'); },
    });
    const result = await first.migrateTo('latest');
    expect(result.success).toBe(false);

    const control = await db
      .collection<{ _id: string; locked: boolean }>('migrations')
      .findOne({ _id: 'control' });
    expect(control?.locked).toBe(false);
  });

  it('prevents concurrent migrations across instances', async () => {
    const a = createMongoMigrations(db, { log: false });
    const b = createMongoMigrations(db, { log: false });

    a.add({
      version: 1,
      up: async () => { await new Promise((r) => setTimeout(r, 100)); },
    });
    b.add({ version: 1, up: async () => {} });

    // Kick off A, wait a tick so it acquires the lock, then start B.
    const aPromise = a.migrateTo('latest');
    await new Promise((r) => setTimeout(r, 20));
    const bResult = await b.migrateTo('latest');
    expect(bResult.success).toBe(false);
    expect(bResult.error?.message).toBe('Migration control is locked');

    const aResult = await aPromise;
    expect(aResult.success).toBe(true);
  });
});
