# @quave/migrations-mongodb

MongoDB adapter for [`@quave/migrations`](../migrations).

The distributed lock is an atomic single-document `updateOne({ _id: 'control', locked: false }, { $set: { locked: true, lockedAt } })`. The database enforces "exactly one winner" across concurrent processes.

## Install

```bash
npm install @quave/migrations-mongodb mongodb
```

## Usage

```ts
import { MongoClient } from 'mongodb';
import { createMongoMigrations } from '@quave/migrations-mongodb';

const client = await new MongoClient('mongodb://localhost:27017').connect();
const db = client.db('myapp');

const migrations = createMongoMigrations(db, {
  log: true,
  collectionName: 'migrations', // default
});

migrations.add({
  version: 1,
  name: 'Create users',
  up: async (_m, { db }) => {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },
  down: async (_m, { db }) => {
    await db.collection('users').drop();
  },
});

await migrations.migrateTo('latest');
await client.close();
```

## Options

`createMongoMigrations(db, opts)` accepts all [`MigrationOptions`](../migrations) plus:

- `collectionName?: string` — name of the control collection (default `migrations`).

## Ctx type

Each migration's `up` / `down` receives `ctx: { db: Db }` — the `mongodb` `Db` you passed in.

## License

MIT
