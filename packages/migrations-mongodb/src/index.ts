import { Db } from 'mongodb';
import { Migrations, MigrationOptions } from '@quave/migrations';
import { MongoBackend, MongoBackendOptions, MongoContext } from './mongoBackend';

export { MongoBackend } from './mongoBackend';
export type { MongoBackendOptions, MongoContext, ControlDocument } from './mongoBackend';

export function createMongoMigrations(
  db: Db,
  opts: MigrationOptions & MongoBackendOptions = {},
): Migrations<MongoContext> {
  const { collectionName, ...migrationOpts } = opts;
  const backendOpts: MongoBackendOptions = {};
  if (collectionName !== undefined) {
    backendOpts.collectionName = collectionName;
  }
  return new Migrations(new MongoBackend(db, backendOpts), migrationOpts);
}
