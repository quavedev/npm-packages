# @quave/migrations-postgres

PostgreSQL adapter for [`@quave/migrations`](../migrations), built on the official [`pg`](https://node-postgres.com/) driver.

The distributed lock is a conditional `UPDATE ... WHERE locked = FALSE RETURNING id`. Postgres's row-level write lock under `READ COMMITTED` guarantees exactly one winner across concurrent processes — a second caller either sees `locked = TRUE` on re-read and matches zero rows, or blocks on the row lock until the first commit and then sees the row already taken.

## Install

```bash
npm install @quave/migrations-postgres pg
```

## Usage

### With an existing Pool

```ts
import { Pool } from 'pg';
import { createPostgresMigrations } from '@quave/migrations-postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = createPostgresMigrations({ pool, log: true });

migrations.add({
  version: 1,
  name: 'create users',
  up: async (_m, { query }) => {
    await query(`
      CREATE TABLE users (
        id         SERIAL PRIMARY KEY,
        email      TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  },
  down: async (_m, { query }) => {
    await query('DROP TABLE users;');
  },
});

await migrations.migrateTo('latest');
await pool.end();
```

### With a connection string

```ts
const migrations = createPostgresMigrations({
  connectionString: 'postgres://user:pass@localhost:5432/myapp',
});
```

The adapter owns any pool it creates itself. You can close it via:

```ts
import { PostgresBackend } from '@quave/migrations-postgres';
const backend = new PostgresBackend({ connectionString: '...' });
// … later
await backend.close();
```

### Writing migrations

Every migration's `up`/`down` receives `ctx: { pool, query }`:

```ts
migrations.add({
  version: 2,
  name: 'backfill + index',
  up: async (_m, { query }) => {
    await query('UPDATE users SET role = $1 WHERE role IS NULL;', ['member']);
    await query('CREATE INDEX idx_users_role ON users (role);');
  },
});
```

Need a transaction? Use the pool directly:

```ts
up: async (_m, { pool }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('...');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
},
```

## Options

`createPostgresMigrations(opts)` accepts all [`MigrationOptions`](../migrations) plus:

| Option | Purpose |
|---|---|
| `pool` | Reuse an existing `pg.Pool`. The adapter will not end it. |
| `connectionString` | Postgres URL (e.g. `postgres://user:pass@host:5432/db`). |
| `host` / `port` / `user` / `password` / `database` | Individual connection fields (forwarded to `pg.Pool`). |
| `poolConfig` | Additional `pg.PoolConfig` options (SSL, `max`, idle timeouts, etc.). |
| `schemaName` / `tableName` | Control-table identifier. Defaults `"public"."migrations_control"`. |

## Control table

```sql
CREATE TABLE IF NOT EXISTS "public"."migrations_control" (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 0,
  locked     BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at  TIMESTAMPTZ
);
```

Created automatically on first operation.

## Testing

- Unit tests use [`pg-mem`](https://github.com/oguimbal/pg-mem) — no real Postgres needed, runs in CI without any setup.
- Integration tests in `src/__tests__/postgresBackend.integration.test.ts` are skipped unless a connection is configured:

  ```bash
  POSTGRES_URL=postgres://user@localhost:5432/test_db \
  npm test -w @quave/migrations-postgres
  ```

  The integration suite runs the full `runBackendContract` plus a distributed-lock contention test (10 concurrent `tryLock` calls, assert exactly one wins).

## License

MIT
