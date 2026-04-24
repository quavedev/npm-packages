import { MigrationBackend } from '../backend';

/**
 * Shared contract every MigrationBackend implementation must satisfy.
 * Adapter test suites should call this to guarantee invariants the core
 * depends on — especially the "exactly one winner under concurrent tryLock"
 * distributed-lock property.
 */
export function runBackendContract<TContext>(
  name: string,
  makeBackend: () => Promise<MigrationBackend<TContext>> | MigrationBackend<TContext>,
  teardown?: (backend: MigrationBackend<TContext>) => Promise<void> | void,
): void {
  describe(`MigrationBackend contract: ${name}`, () => {
    let backend: MigrationBackend<TContext>;

    beforeEach(async () => {
      backend = await makeBackend();
      await backend.init();
      await backend.reset();
      await backend.init();
    });

    afterEach(async () => {
      if (teardown) {
        await teardown(backend);
      }
    });

    it('init is idempotent; fresh backend reports version 0 and unlocked', async () => {
      await backend.init();
      await backend.init();
      const control = await backend.getControl();
      expect(control.version).toBe(0);
      expect(control.locked).toBe(false);
    });

    it('tryLock transitions unlocked -> locked and returns true on first win', async () => {
      expect(await backend.tryLock()).toBe(true);
      const locked = await backend.getControl();
      expect(locked.locked).toBe(true);
    });

    it('tryLock returns false when already locked', async () => {
      expect(await backend.tryLock()).toBe(true);
      expect(await backend.tryLock()).toBe(false);
    });

    it('unlock is idempotent', async () => {
      await backend.tryLock();
      await backend.unlock();
      await backend.unlock();
      const control = await backend.getControl();
      expect(control.locked).toBe(false);
    });

    it('after unlock, tryLock can succeed again', async () => {
      await backend.tryLock();
      await backend.unlock();
      expect(await backend.tryLock()).toBe(true);
    });

    it('setVersion persists across getControl', async () => {
      await backend.setVersion(7);
      const control = await backend.getControl();
      expect(control.version).toBe(7);
    });

    it('reset clears version back to 0', async () => {
      await backend.setVersion(5);
      await backend.reset();
      await backend.init();
      const control = await backend.getControl();
      expect(control.version).toBe(0);
      expect(control.locked).toBe(false);
    });

    it('concurrent tryLock produces exactly one winner', async () => {
      const N = 10;
      const results = await Promise.all(
        Array.from({ length: N }, () => backend.tryLock()),
      );
      const winners = results.filter((r) => r === true);
      expect(winners).toHaveLength(1);
    });
  });
}
