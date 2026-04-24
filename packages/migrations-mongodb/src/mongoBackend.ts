import { Db, Collection } from 'mongodb';
import { MigrationBackend, ControlState } from '@quave/migrations';

export interface ControlDocument {
  _id: string;
  version: number;
  locked: boolean;
  lockedAt?: Date;
}

export interface MongoBackendOptions {
  collectionName?: string;
}

export interface MongoContext {
  db: Db;
}

const CONTROL_ID = 'control';

export class MongoBackend implements MigrationBackend<MongoContext> {
  private db: Db;
  private collection: Collection<ControlDocument>;

  constructor(db: Db, opts: MongoBackendOptions = {}) {
    const collectionName = opts.collectionName ?? 'migrations';
    this.db = db;
    this.collection = db.collection<ControlDocument>(collectionName);
  }

  async init(): Promise<void> {
    const existing = await this.collection.findOne({ _id: CONTROL_ID });
    if (!existing) {
      await this.collection.updateOne(
        { _id: CONTROL_ID },
        { $setOnInsert: { _id: CONTROL_ID, version: 0, locked: false } },
        { upsert: true },
      );
    }
  }

  async getControl(): Promise<ControlState> {
    const doc = await this.collection.findOne({ _id: CONTROL_ID });
    if (!doc) {
      return { version: 0, locked: false };
    }
    const result: ControlState = { version: doc.version, locked: doc.locked };
    if (doc.lockedAt) {
      result.lockedAt = doc.lockedAt;
    }
    return result;
  }

  async tryLock(): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: CONTROL_ID, locked: false },
      { $set: { locked: true, lockedAt: new Date() } },
    );
    return result.modifiedCount === 1;
  }

  async unlock(): Promise<void> {
    await this.collection.updateOne(
      { _id: CONTROL_ID },
      { $set: { locked: false } },
    );
  }

  async setVersion(version: number): Promise<void> {
    await this.collection.updateOne(
      { _id: CONTROL_ID },
      { $set: { version } },
    );
  }

  getContext(): MongoContext {
    return { db: this.db };
  }

  async reset(): Promise<void> {
    await this.collection.deleteMany({});
  }
}
