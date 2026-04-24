# @quave npm packages

npm monorepo for Quave's shared TypeScript packages.

## Packages

| Package | Description |
|---|---|
| [`@quave/migrations`](./packages/migrations) | Backend-agnostic migration orchestrator with a small pluggable `MigrationBackend` interface. |
| [`@quave/migrations-mongodb`](./packages/migrations-mongodb) | MongoDB adapter — distributed lock via atomic single-doc `updateOne`. |
| [`@quave/migrations-redshift`](./packages/migrations-redshift) | AWS Redshift Data API adapter — distributed lock via serializable UPDATE + nonce read-back. Works with Serverless workgroups and provisioned clusters. |

## Development

```bash
npm install          # install across workspaces
npm run build        # tsc in every package
npm test             # jest in every package
npm run lint         # flat-config eslint
```

Tests for `@quave/migrations-mongodb` expect a MongoDB instance on `mongodb://localhost:27017`. The `@quave/migrations-redshift` integration tests are skipped unless `REDSHIFT_*` env vars are present.
