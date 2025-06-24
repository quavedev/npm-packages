import { Db } from 'mongodb';
import { Migration, MigrationOptions, ControlDocument, MigrationCommand, MigrationResult, DatabaseConnection } from './types';
import { Logger } from './logger';

export class Migrations {
  private migrations: Migration[] = [];
  private options: Required<MigrationOptions>;
  private logger: Logger;
  private dbConnection: DatabaseConnection | null = null;

  constructor(options: MigrationOptions = {}) {
    this.options = {
      log: true,
      logger: null,
      logIfLatest: true,
      collectionName: 'migrations',
      ...options,
    };
    this.logger = new Logger(this.options);
  }

  /**
   * Configure the migrations system
   */
  config(options: MigrationOptions): void {
    this.options = { ...this.options, ...options };
    this.logger = new Logger(this.options);
  }

  /**
   * Set the database connection
   */
  setDatabase(db: Db): void {
    this.dbConnection = {
      db,
      collection: db.collection<ControlDocument>(this.options.collectionName),
    };
  }

  /**
   * Add a new migration
   */
  add(migration: Migration): void {
    if (typeof migration.up !== 'function') {
      throw new Error('Migration must supply an up function.');
    }

    if (typeof migration.version !== 'number') {
      throw new Error('Migration must supply a version number.');
    }

    if (migration.version <= 0) {
      throw new Error('Migration version must be greater than 0');
    }

    // Freeze the migration object to make it immutable
    Object.freeze(migration);

    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Migrate to a specific version or 'latest'
   */
  async migrateTo(command: string | number): Promise<MigrationResult> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set. Call setDatabase() first.');
    }

    if (typeof command === 'undefined' || command === '' || this.migrations.length === 0) {
      throw new Error(`Cannot migrate using invalid command: ${command}`);
    }

    const parsedCommand = this.parseCommand(command);
    const targetVersion = parsedCommand.version === 'latest' 
      ? this.migrations[this.migrations.length - 1]?.version ?? 0
      : parsedCommand.version;

    const result = await this._migrateTo(targetVersion, parsedCommand.subcommand === 'rerun');

    if (parsedCommand.subcommand === 'exit') {
      process.exit(0);
    }

    return result;
  }

  /**
   * Get the current migration version
   */
  async getVersion(): Promise<number> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set. Call setDatabase() first.');
    }

    const control = await this._getControl();
    return control.version;
  }

  /**
   * Unlock the migrations (useful when migrations fail and leave the system locked)
   */
  async unlock(): Promise<void> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set. Call setDatabase() first.');
    }

    await this.dbConnection.collection.updateOne(
      { _id: 'control' },
      { $set: { locked: false } }
    );
  }

  /**
   * Reset migrations (mainly for testing)
   */
  async reset(): Promise<void> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set. Call setDatabase() first.');
    }

    await this.getVersion(); // Ensure control document exists
    // Don't clear migrations array - tests add migrations after reset
    await this.dbConnection.collection.deleteMany({});
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

  private async _migrateTo(version: number, rerun = false): Promise<MigrationResult> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set');
    }

    const control = await this._getControl();
    let currentVersion = control.version;
    let migrationsRun = 0;

    // Avoid unneeded locking, check if migration actually is going to run
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

    if (!(await this.lock())) {
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
          `Migrating from version ${this.migrations[startIdx]?.version ?? 0} -> ${this.migrations[endIdx]?.version ?? 0}`
        );

        if (currentVersion < version) {
          // Migrate up: run migrations from startIdx + 1 to endIdx
          for (let i = startIdx + 1; i <= endIdx; i++) {
            await this.runMigration('up', i);
            const migration = this.migrations[i];
            if (migration) {
              currentVersion = migration.version;
              await this.updateVersion(currentVersion);
            }
            migrationsRun++;
          }
        } else {
          // Migrate down: run migrations from startIdx down to endIdx + 1
          const targetIdx = endIdx === -1 ? -1 : endIdx; // Handle version 0
          for (let i = startIdx; i > targetIdx; i--) {
            await this.runMigration('down', i);
            const prevMigration = this.migrations[i - 1];
            currentVersion = prevMigration?.version ?? 0;
            await this.updateVersion(currentVersion);
            migrationsRun++;
          }
        }
      }

      await this.unlock();
      this.logger.info('Finished migrating.');

      return {
        success: true,
        fromVersion: control.version,
        toVersion: version,
        migrationsRun,
      };
    } catch (error) {
      await this.unlock();
      this.logger.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
      
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

    if (typeof migration[direction] !== 'function') {
      throw new Error(`Cannot migrate ${direction} on version ${migration.version}`);
    }

    const name = migration.name ? ` (${migration.name})` : '';
    this.logger.info(`Running ${direction}() on version ${migration.version}${name}`);

    await migration[direction](migration);
  }

  private async lock(): Promise<boolean> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set');
    }

    // This is atomic. The selector ensures only one caller at a time will see
    // the unlocked control, and locking occurs in the same update's modifier.
    const result = await this.dbConnection.collection.updateOne(
      { _id: 'control', locked: false },
      { $set: { locked: true, lockedAt: new Date() } }
    );

    return result.modifiedCount === 1;
  }

  private async updateVersion(version: number): Promise<void> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set');
    }

    await this.dbConnection.collection.updateOne(
      { _id: 'control' },
      { $set: { version } }
    );
  }

  private async _getControl(): Promise<ControlDocument> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set');
    }

    const control = await this.dbConnection.collection.findOne({ _id: 'control' });

    if (control) {
      return control;
    }

    return this._setControl({ version: 0, locked: false });
  }

  private async _setControl(control: Omit<ControlDocument, '_id'>): Promise<ControlDocument> {
    if (!this.dbConnection) {
      throw new Error('Database connection not set');
    }

    const controlDoc: ControlDocument = {
      _id: 'control',
      ...control,
    };

    await this.dbConnection.collection.updateOne(
      { _id: 'control' },
      { $set: controlDoc },
      { upsert: true }
    );

    return controlDoc;
  }

  private findIndexByVersion(version: number): number {
    if (version === 0) {
      return -1; // Version 0 means no migrations
    }
    const index = this.migrations.findIndex(m => m.version === version);
    if (index === -1) {
      throw new Error(`Can't find migration version ${version}`);
    }
    return index;
  }
} 