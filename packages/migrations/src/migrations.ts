import { MigrationBackend } from './backend';
import {
  Migration,
  MigrationOptions,
  MigrationCommand,
  MigrationResult,
} from './types';
import { Logger } from './logger';

export class Migrations<TContext = unknown> {
  private migrations: Migration<TContext>[] = [];
  private options: Required<MigrationOptions>;
  private logger: Logger;
  private backend: MigrationBackend<TContext>;
  private initialized = false;

  constructor(
    backend: MigrationBackend<TContext>,
    options: MigrationOptions = {},
  ) {
    this.backend = backend;
    this.options = {
      log: true,
      logger: null,
      logIfLatest: true,
      ...options,
    };
    this.logger = new Logger(this.options);
  }

  config(options: MigrationOptions): void {
    this.options = { ...this.options, ...options };
    this.logger = new Logger(this.options);
  }

  add(migration: Migration<TContext>): void {
    if (typeof migration.up !== 'function') {
      throw new Error('Migration must supply an up function.');
    }

    if (typeof migration.version !== 'number') {
      throw new Error('Migration must supply a version number.');
    }

    if (migration.version <= 0) {
      throw new Error('Migration version must be greater than 0');
    }

    Object.freeze(migration);

    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
  }

  async migrateTo(command: string | number): Promise<MigrationResult> {
    if (typeof command === 'undefined' || command === '' || this.migrations.length === 0) {
      throw new Error(`Cannot migrate using invalid command: ${command}`);
    }

    await this.ensureInit();

    const parsedCommand = this.parseCommand(command);
    const targetVersion =
      parsedCommand.version === 'latest'
        ? this.migrations[this.migrations.length - 1]?.version ?? 0
        : parsedCommand.version;

    const result = await this.runMigrateTo(
      targetVersion,
      parsedCommand.subcommand === 'rerun',
    );

    if (parsedCommand.subcommand === 'exit') {
      process.exit(0);
    }

    return result;
  }

  async getVersion(): Promise<number> {
    await this.ensureInit();
    const control = await this.backend.getControl();
    return control.version;
  }

  async unlock(): Promise<void> {
    await this.ensureInit();
    await this.backend.unlock();
  }

  async reset(): Promise<void> {
    await this.ensureInit();
    await this.backend.reset();
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.backend.init();
    this.initialized = true;
  }

  private parseCommand(command: string | number): MigrationCommand {
    if (typeof command === 'number') {
      return { version: command };
    }

    const parts = command.split(',');
    const version = parts[0]?.trim() ?? '';
    const subcommand = parts[1]?.trim() as 'exit' | 'rerun' | undefined;

    return {
      version: version === 'latest' ? 'latest' : parseInt(version, 10),
      subcommand,
    };
  }

  private async runMigrateTo(version: number, rerun = false): Promise<MigrationResult> {
    const control = await this.backend.getControl();
    let currentVersion = control.version;
    let migrationsRun = 0;

    if (!rerun && currentVersion === version) {
      if (this.logger.shouldLogIfLatest()) {
        this.logger.info(`Not migrating, already at version ${version}`);
      }
      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: version,
        migrationsRun: 0,
      };
    }

    if (!(await this.backend.tryLock())) {
      this.logger.info('Not migrating, control is locked.');
      return {
        success: false,
        fromVersion: currentVersion,
        toVersion: version,
        migrationsRun: 0,
        error: new Error('Migration control is locked'),
      };
    }

    try {
      if (rerun) {
        this.logger.info(`Rerunning version ${version}`);
        await this.runMigration('up', this.findIndexByVersion(version));
        migrationsRun = 1;
      } else {
        const startIdx = this.findIndexByVersion(currentVersion);
        const endIdx = this.findIndexByVersion(version);

        this.logger.info(
          `Migrating from version ${this.migrations[startIdx]?.version ?? 0} -> ${this.migrations[endIdx]?.version ?? 0}`,
        );

        if (currentVersion < version) {
          for (let i = startIdx + 1; i <= endIdx; i++) {
            await this.runMigration('up', i);
            const migration = this.migrations[i];
            if (migration) {
              currentVersion = migration.version;
              await this.backend.setVersion(currentVersion);
            }
            migrationsRun++;
          }
        } else {
          const targetIdx = endIdx === -1 ? -1 : endIdx;
          for (let i = startIdx; i > targetIdx; i--) {
            await this.runMigration('down', i);
            const prevMigration = this.migrations[i - 1];
            currentVersion = prevMigration?.version ?? 0;
            await this.backend.setVersion(currentVersion);
            migrationsRun++;
          }
        }
      }

      await this.backend.unlock();
      this.logger.info('Finished migrating.');

      return {
        success: true,
        fromVersion: control.version,
        toVersion: version,
        migrationsRun,
      };
    } catch (error) {
      await this.backend.unlock();
      this.logger.error(
        `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        success: false,
        fromVersion: control.version,
        toVersion: version,
        migrationsRun,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private async runMigration(direction: 'up' | 'down', idx: number): Promise<void> {
    const migration = this.migrations[idx];
    if (!migration) {
      throw new Error(`Migration at index ${idx} not found`);
    }

    const fn = migration[direction];
    if (typeof fn !== 'function') {
      throw new Error(`Cannot migrate ${direction} on version ${migration.version}`);
    }

    const name = migration.name ? ` (${migration.name})` : '';
    this.logger.info(`Running ${direction}() on version ${migration.version}${name}`);

    await fn(migration, this.backend.getContext());
  }

  private findIndexByVersion(version: number): number {
    if (version === 0) {
      return -1;
    }
    const index = this.migrations.findIndex((m) => m.version === version);
    if (index === -1) {
      throw new Error(`Can't find migration version ${version}`);
    }
    return index;
  }
}
