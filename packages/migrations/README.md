# @quave/migrations

Backend-agnostic migration orchestrator. Install an adapter package alongside this one to pick a backend:

- [`@quave/migrations-mongodb`](../migrations-mongodb) — MongoDB
- [`@quave/migrations-redshift`](../migrations-redshift) — AWS Redshift (Data API)

Need a backend we don't ship? Implement the `MigrationBackend` interface exported from this package and pass it to `new Migrations(backend, options)`.

## Install

```bash
# Pick the adapter that matches your database. It depends on this package.
npm install @quave/migrations-mongodb
# or
npm install @quave/migrations-redshift
```

## Quick start (MongoDB)

```ts
import { MongoClient } from 'mongodb';
import { createMongoMigrations } from '@quave/migrations-mongodb';

const client = await new MongoClient('mongodb://localhost:27017').connect();
const db = client.db('myapp');

const migrations = createMongoMigrations(db, { log: true });

migrations.add({
  version: 1,
  name: 'Create users collection',
  up: async (_m, { db }) => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },
  down: async (_m, { db }) => {
    await db.collection('users').drop();
  },
});

const result = await migrations.migrateTo('latest');
if (!result.success) {
  throw result.error;
}
```

## Quick start (Redshift)

```ts
import { createRedshiftMigrations } from '@quave/migrations-redshift';

const migrations = createRedshiftMigrations({
  database: 'dev',
  workgroupName: 'my-serverless-wg',   // or clusterIdentifier + dbUser/secretArn
  region: 'us-east-1',
});

migrations.add({
  version: 1,
  name: 'Create events table',
  up: async (_m, { execute }) => {
    await execute('CREATE TABLE events (id BIGINT IDENTITY, payload VARCHAR(4000));');
  },
});

await migrations.migrateTo('latest');
```

## Commands

- `migrateTo('latest')` — run all pending migrations.
- `migrateTo(5)` — run up (or down) to a specific version.
- `migrateTo('3,rerun')` — rerun a single version's `up`.
- `migrateTo('latest,exit')` — migrate then `process.exit(0)` (script mode).
- `getVersion()` — current recorded version.
- `unlock()` — release a stuck lock after a crash.
- `reset()` — test-only: wipe persisted state.

## Distributed locking

Every adapter's `tryLock()` is enforced *by the database*, so concurrent migration processes are safe:

- **MongoDB**: atomic `updateOne({_id:'control', locked:false}, ...)`. The DB guarantees exactly one winner.
- **Redshift**: single-row serializable `UPDATE ... WHERE locked = FALSE` with a client-generated nonce, then a read-back `SELECT` to confirm ownership. Serialization failures (SQLSTATE `40001` / "Serializable isolation violation") are caught and treated as "did not win."

## Writing a custom backend

```ts
import { Migrations, MigrationBackend, ControlState } from '@quave/migrations';

interface MyCtx { /* whatever your migrations need */ }

class MyBackend implements MigrationBackend<MyCtx> {
  async init() { /* create control table/doc if missing */ }
  async getControl(): Promise<ControlState> { /* return {version, locked} */ }
  async tryLock(): Promise<boolean> { /* atomic false -> true, return true iff won */ }
  async unlock(): Promise<void> { /* unconditional release */ }
  async setVersion(version: number): Promise<void> { /* persist */ }
  getContext(): MyCtx { /* passed to user up/down */ }
  async reset(): Promise<void> { /* test-only wipe */ }
}
```

The `@quave/migrations/testing` subpath exports `runBackendContract(name, makeBackend)` — a jest suite every backend should pass.

## API surface

- `Migrations<TContext>` class
- `MigrationBackend<TContext>` interface + `ControlState`
- `Migration<TContext>`, `MigrationOptions`, `MigrationResult` types
- `Logger`, `LoggerFunction`, `LoggerOptions`
- `@quave/migrations/testing`: `FakeBackend`, `createFakeBackend`, `runBackendContract`

## License

MIT
