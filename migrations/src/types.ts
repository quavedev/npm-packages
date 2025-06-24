import { Db, Collection } from 'mongodb';

export interface Migration {
  version: number;
  name?: string;
  up: (migration: Migration) => Promise<void> | void;
  down?: (migration: Migration) => Promise<void> | void;
}

export interface MigrationOptions {
  log?: boolean;
  logger?: LoggerFunction | null;
  logIfLatest?: boolean;
  collectionName?: string;
}

export interface LoggerFunction {
  (opts: LoggerOptions): void;
}

export interface LoggerOptions {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  tag: string;
}

export interface ControlDocument {
  _id: string;
  version: number;
  locked: boolean;
  lockedAt?: Date;
}

export interface MigrationCommand {
  version: number | 'latest';
  subcommand?: 'exit' | 'rerun';
}

export interface MigrationResult {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  migrationsRun: number;
  error?: Error;
}

export interface DatabaseConnection {
  db: Db;
  collection: Collection<ControlDocument>;
} 