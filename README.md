# @quave npm packages

npm monorepo for Quave's shared TypeScript packages.

## Packages

| Package | Description |
|---|---|
| [`@quave/migrations`](./packages/migrations) | Backend-agnostic migration orchestrator with a small pluggable `MigrationBackend` interface. |
| [`@quave/migrations-mongodb`](./packages/migrations-mongodb) | MongoDB adapter — distributed lock via atomic single-doc `updateOne`. |
| [`@quave/migrations-postgres`](./packages/migrations-postgres) | PostgreSQL adapter (`pg`) — distributed lock via conditional `UPDATE ... RETURNING` on a control row. |
| [`@quave/migrations-redshift`](./packages/migrations-redshift) | AWS Redshift Data API adapter — distributed lock via serializable UPDATE + nonce read-back. Works with Serverless workgroups and provisioned clusters. |

## Development

```bash
npm install          # install across workspaces
npm run build        # tsc in every package
npm test             # jest in every package
npm run lint         # flat-config eslint
```

## Publishing

```bash
npm login                         # one-time npm auth
npm run publish:all:dry-run       # preflight (clean + build + tarball preview, no upload)
npm run publish:all               # actually publish in dependency order
```

The script publishes `@quave/migrations` first, then the three adapters (which depend on it via `^2.0.0`). It refuses to run on a dirty working tree, skips versions already on the registry, and relies on each package's `prepublishOnly` to run `clean && build`. Versions are bumped by editing each package's `package.json` before running.

## Tests

Tests for `@quave/migrations-mongodb` expect a MongoDB instance on `mongodb://localhost:27017`. The `@quave/migrations-postgres` unit tests run against [`pg-mem`](https://github.com/oguimbal/pg-mem) and need no setup; its integration tests are skipped unless `POSTGRES_URL` is set. The `@quave/migrations-redshift` integration tests are skipped unless `REDSHIFT_*` env vars are present.
