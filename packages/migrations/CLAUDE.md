# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — compile TypeScript from `src/` to `dist/` via `tsc`.
- `npm run dev` — `tsc --watch` for incremental builds.
- `npm test` — run the Jest suite (requires MongoDB on `mongodb://localhost:27017`; the tests connect to a real DB named `migrations_test` and call `db.dropDatabase()` between cases).
- `npm test -- -t "should migrate up to latest version"` — run a single test by name.
- `npm test -- src/__tests__/migrations.test.ts` — run a single test file.
- `npm run lint` / `npm run lint:fix` — ESLint over `src/**/*.ts`.
- `npm run clean` — remove `dist/`. `prepublishOnly` does `clean && build`.

## Architecture

This is a single-package TypeScript library (`@quave/migrations`) — an async/await MongoDB migration runner. Published entry is `dist/index.js` / `dist/index.d.ts`; source of truth is `src/`.

Core flow lives in `src/migrations.ts`:

- `Migrations` is instantiated with options, then bound to a DB via `setDatabase(db)`. It stores state in a single control document (`_id: 'control'`) inside a configurable collection (default `migrations`) holding `{ version, locked, lockedAt? }`.
- Migrations are registered with `add({ version, name?, up, down? })`. The array is kept sorted by `version`, and each entry is `Object.freeze`d on add.
- `migrateTo(command)` accepts a number, `'latest'`, or comma-forms `'<v>,rerun'` / `'<v>,exit'` (parsed in `parseCommand`). `'exit'` calls `process.exit(0)` after the run.
- Direction is decided by comparing `currentVersion` to the target: up walks `startIdx+1..endIdx` calling `up`; down walks `startIdx..endIdx+1` (in reverse) calling `down`. Version `0` is represented as index `-1` in `findIndexByVersion` so fully rolling back works.
- Concurrency is enforced via an atomic `updateOne({ _id: 'control', locked: false }, { $set: { locked: true, lockedAt } })` in `lock()`. `modifiedCount === 1` means the caller owns the lock. The lock is released in `finally`-style paths on both success and failure; `unlock()` is exposed publicly for recovery after a crash that left `locked: true`.
- Errors inside a migration never throw out of `migrateTo` — they unlock and return `{ success: false, error, fromVersion, toVersion, migrationsRun }`. Callers must inspect `result.success`. The only thrown errors are programmer errors (missing DB, bad command, unknown version, invalid migration shape).
- `reset()` is test-only: it wipes the control collection but intentionally does **not** clear the in-memory `migrations` array (tests add migrations before or after `reset` and expect them to persist across the reset).

`src/logger.ts` wraps either a user-supplied `LoggerFunction` or `console.*`. `shouldLogIfLatest()` gates the "already at version X" message. All public types are re-exported from `src/index.ts` and defined in `src/types.ts`.

## Repo layout notes

- There are stale duplicate files at the repo root (`migrations.ts`, `logger.ts`, `types.ts`, `index.ts`, `migrations.test.ts`, `__tests__/migrations.test.ts`) that mirror files under `src/`. The build (`tsconfig.json` `include: ["src/**/*"]`) and tests (`jest.config.js` `roots: ['<rootDir>/src']`) both ignore the root copies. Treat `src/` as authoritative and prefer deleting root duplicates over editing them.
- `tsconfig.json` is strict: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride` are all on — array lookups return `T | undefined` and must be narrowed.
