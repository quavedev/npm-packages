import { MigrationBackend, ControlState } from '../backend';

export interface FakeContext {
  calls: string[];
}

/**
 * In-memory backend for unit-testing the core orchestrator and user migrations
 * without a real database. Serializes tryLock via a JS-level mutex so concurrent
 * callers behave like they would against a real distributed store.
 */
export class FakeBackend implements MigrationBackend<FakeContext> {
  private control: ControlState = { version: 0, locked: false };
  private hasControl = false;
  private lockMutex: Promise<void> = Promise.resolve();
  readonly context: FakeContext = { calls: [] };

  async init(): Promise<void> {
    if (!this.hasControl) {
      this.hasControl = true;
      this.control = { version: 0, locked: false };
    }
  }

  async getControl(): Promise<ControlState> {
    return { ...this.control };
  }

  async tryLock(): Promise<boolean> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.lockMutex;
    this.lockMutex = prev.then(() => next);
    await prev;
    try {
      if (this.control.locked) {
        return false;
      }
      this.control = { ...this.control, locked: true, lockedAt: new Date() };
      return true;
    } finally {
      release();
    }
  }

  async unlock(): Promise<void> {
    const next: ControlState = { version: this.control.version, locked: false };
    this.control = next;
  }

  async setVersion(version: number): Promise<void> {
    this.control = { ...this.control, version };
  }

  getContext(): FakeContext {
    return this.context;
  }

  async reset(): Promise<void> {
    this.control = { version: 0, locked: false };
    this.context.calls.length = 0;
  }
}

export function createFakeBackend(): FakeBackend {
  return new FakeBackend();
}
