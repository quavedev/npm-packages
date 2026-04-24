export interface Migration<TContext = unknown> {
  version: number;
  name?: string;
  up: (migration: Migration<TContext>, ctx: TContext) => Promise<void> | void;
  down?: (migration: Migration<TContext>, ctx: TContext) => Promise<void> | void;
}

export interface MigrationOptions {
  log?: boolean;
  logger?: LoggerFunction | null;
  logIfLatest?: boolean;
}

export interface LoggerFunction {
  (opts: LoggerOptions): void;
}

export interface LoggerOptions {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  tag: string;
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
