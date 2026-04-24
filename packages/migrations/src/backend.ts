export interface ControlState {
  version: number;
  locked: boolean;
  lockedAt?: Date;
}

export interface MigrationBackend<TContext = unknown> {
  init(): Promise<void>;
  getControl(): Promise<ControlState>;
  tryLock(): Promise<boolean>;
  unlock(): Promise<void>;
  setVersion(version: number): Promise<void>;
  getContext(): TContext;
  reset(): Promise<void>;
}
