# @quave/migrations-redshift

AWS Redshift adapter for [`@quave/migrations`](../migrations), built on the [Redshift Data API](https://docs.aws.amazon.com/redshift/latest/mgmt/data-api.html). No persistent connection pool — each statement is executed via `ExecuteStatement` and polled with `DescribeStatement`.

Works with both **Serverless workgroups** and **provisioned clusters**, authenticating via `DbUser` or a Secrets Manager `SecretArn`.

## Install

```bash
npm install @quave/migrations-redshift @aws-sdk/client-redshift-data
```

## Usage

### Serverless

```ts
import { createRedshiftMigrations } from '@quave/migrations-redshift';

const migrations = createRedshiftMigrations({
  database: 'dev',
  workgroupName: 'my-wg',
  region: 'us-east-1',
});
```

### Provisioned

```ts
const migrations = createRedshiftMigrations({
  database: 'dev',
  clusterIdentifier: 'my-cluster',
  dbUser: 'admin',            // OR secretArn: 'arn:aws:secretsmanager:...'
  region: 'us-east-1',
});
```

### Writing migrations

```ts
migrations.add({
  version: 1,
  name: 'create events table',
  up: async (_m, { execute }) => {
    await execute(`
      CREATE TABLE events (
        id        BIGINT IDENTITY,
        payload   SUPER,
        created_at TIMESTAMP DEFAULT SYSDATE
      );
    `);
  },
});

await migrations.migrateTo('latest');
```

The `ctx.execute(sql, params?)` helper submits a statement, polls to completion, and returns `{ rows, columnMetadata, numberOfRecordsUpdated }`. Parameters use the Data API format: `[{ name: 'foo', value: '42' }]` and are referenced in SQL as `:foo`.

## Options

`createRedshiftMigrations(opts)` accepts all [`MigrationOptions`](../migrations) plus:

| Option | Purpose |
|---|---|
| `database` (required) | Redshift database name. |
| `workgroupName` **xor** `clusterIdentifier` | Pick Serverless vs. provisioned. |
| `dbUser` | Required for provisioned unless using `secretArn`. |
| `secretArn` | Secrets Manager ARN for IAM-less auth. |
| `region` | AWS region (falls back to SDK defaults). |
| `schemaName` / `tableName` | Control-table identifier. Defaults `"public"."migrations_control"`. |
| `pollIntervalMs` / `pollMaxIntervalMs` | DescribeStatement polling cadence. Defaults 100 ms → 2000 ms. |
| `statementTimeoutMs` | Max wait per statement. Default 300 000 ms. |
| `maxThrottleRetries` | Retry budget for `ThrottlingException` / `TooManyRequestsException`. Default 5. |
| `client` | Inject a pre-built `RedshiftDataClient` (useful for custom credentials or mocking). |

## Distributed lock

Each `tryLock()` call:

1. Generates a fresh UUID nonce.
2. `UPDATE ... SET locked = TRUE, lock_nonce = :nonce WHERE id = 'control' AND locked = FALSE;`
3. `SELECT lock_nonce FROM ...` — we own the lock iff the returned nonce matches ours.

Under concurrent attempts, Redshift's serializable isolation guarantees exactly one winner: the other caller either sees `locked = TRUE` (updates zero rows) or aborts with a serialization error (SQLSTATE `40001`, matched by message), both of which return `false` from `tryLock()`.

The read-back is chosen over `NumberOfRecordsUpdated` because that count is unreliable under Data API transient-error retry. The nonce is idempotent under retry.

## Control table

```sql
CREATE TABLE IF NOT EXISTS "public"."migrations_control" (
  id          VARCHAR(16) NOT NULL,
  version     INTEGER     NOT NULL DEFAULT 0,
  locked      BOOLEAN     NOT NULL DEFAULT FALSE,
  lock_nonce  VARCHAR(64),
  locked_at   TIMESTAMP,
  PRIMARY KEY (id)
);
```

Created automatically on first operation.

## Testing

- Unit tests use `aws-sdk-client-mock` + an in-memory SQL simulator — no AWS credentials needed.
- Integration tests in `src/__tests__/redshiftBackend.integration.test.ts` are skipped unless environment variables are set:

  ```bash
  REDSHIFT_DATABASE=dev \
  REDSHIFT_WORKGROUP=my-wg \
  AWS_REGION=us-east-1 \
  npm test -w @quave/migrations-redshift
  ```

## License

MIT
