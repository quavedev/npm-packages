import { MigrationOptions } from './types';

export class Logger {
  private options: Required<MigrationOptions>;
  private prefix: string;

  constructor(options: MigrationOptions, prefix = 'Migrations') {
    this.options = {
      log: true,
      logger: null,
      logIfLatest: true,
      collectionName: 'migrations',
      ...options,
    };
    this.prefix = prefix;
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    if (!this.options.log) {
      return;
    }

    if (this.options.logger && typeof this.options.logger === 'function') {
      this.options.logger({
        level,
        message,
        tag: this.prefix,
      });
    } else {
      // Fallback to console logging
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] ${this.prefix}: ${message}`;
      
      switch (level) {
        case 'info':
          console.info(logMessage);
          break;
        case 'warn':
          console.warn(logMessage);
          break;
        case 'error':
          console.error(logMessage);
          break;
        case 'debug':
          console.debug(logMessage);
          break;
      }
    }
  }

  info(message: string): void {
    this.log('info', message);
  }

  warn(message: string): void {
    this.log('warn', message);
  }

  error(message: string): void {
    this.log('error', message);
  }

  debug(message: string): void {
    this.log('debug', message);
  }

  shouldLogIfLatest(): boolean {
    return this.options.logIfLatest;
  }
} 