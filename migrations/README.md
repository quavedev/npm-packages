# @quave/migrations

A modern migration system using raw MongoDB driver and async/await. This package provides a TypeScript-first approach to database migrations with full type safety and modern JavaScript features.

## Features

- 🚀 **Modern**: Built with TypeScript and ES2022 features
- 🔒 **Type Safe**: Full TypeScript support with comprehensive type definitions
- 🗄️ **Raw MongoDB**: Uses the official MongoDB driver directly
- ⚡ **Async/Await**: Modern async/await patterns throughout
- 🔐 **Locking**: Built-in locking mechanism to prevent concurrent migrations
- 📝 **Logging**: Configurable logging with custom logger support
- 🧪 **Testable**: Designed with testing in mind

## Installation

```bash
npm install @quave/migrations
```

## Quick Start

```typescript
import { Migrations } from '@quave/migrations';
import { MongoClient } from 'mongodb';

// Create migrations instance
const migrations = new Migrations({
  log: true,
  collectionName: 'migrations'
});

// Set up database connection
const client = new MongoClient('mongodb://localhost:27017');
await client.connect();
const db = client.db('myapp');

// Set the database
migrations.setDatabase(db);

// Add migrations
migrations.add({
  version: 1,
  name: 'Create users collection',
  up: async (migration) => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
  },
  down: async (migration) => {
    await db.collection('users').drop();
  }
});

migrations.add({
  version: 2,
  name: 'Add user roles',
  up: async (migration) => {
    await db.collection('users').updateMany({}, { $set: { role: 'user' } });
  },
  down: async (migration) => {
    await db.collection('users').updateMany({}, { $unset: { role: 1 } });
  }
});

// Run migrations
const result = await migrations.migrateTo('latest');
console.log(`Migration completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
```

## API Reference

### Migrations Class

#### Constructor

```typescript
new Migrations(options?: MigrationOptions)
```

#### Methods

##### `config(options: MigrationOptions): void`

Configure the migrations system.

```typescript
migrations.config({
  log: false,
  collectionName: 'my_migrations'
});
```

##### `setDatabase(db: Db): void`

Set the MongoDB database connection.

```typescript
migrations.setDatabase(db);
```

##### `add(migration: Migration): void`

Add a new migration.

```typescript
migrations.add({
  version: 1,
  name: 'My Migration',
  up: async (migration) => {
    // Migration logic
  },
  down: async (migration) => {
    // Rollback logic
  }
});
```

##### `migrateTo(command: string | number): Promise<MigrationResult>`

Run migrations to a specific version.

```typescript
// Migrate to latest
const result = await migrations.migrateTo('latest');

// Migrate to specific version
const result = await migrations.migrateTo(5);

// Migrate and exit (useful for scripts)
const result = await migrations.migrateTo('latest,exit');

// Rerun a specific migration
const result = await migrations.migrateTo('3,rerun');
```

##### `getVersion(): Promise<number>`

Get the current migration version.

```typescript
const version = await migrations.getVersion();
```

##### `unlock(): Promise<void>`

Unlock migrations (useful when migrations fail and leave the system locked).

```typescript
await migrations.unlock();
```

##### `reset(): Promise<void>`

Reset migrations (mainly for testing).

```typescript
await migrations.reset();
```

### Types

#### Migration

```typescript
interface Migration {
  version: number;
  name?: string;
  up: (migration: Migration) => Promise<void> | void;
  down?: (migration: Migration) => Promise<void> | void;
}
```

#### MigrationOptions

```typescript
interface MigrationOptions {
  log?: boolean;
  logger?: LoggerFunction | null;
  logIfLatest?: boolean;
  collectionName?: string;
}
```

#### MigrationResult

```typescript
interface MigrationResult {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  migrationsRun: number;
  error?: Error;
}
```

## Configuration

### Logging

You can configure custom logging:

```typescript
const migrations = new Migrations({
  logger: (opts) => {
    console.log(`[${opts.level.toUpperCase()}] ${opts.message}`);
  }
});
```

### Collection Name

Customize the collection name used to store migration state:

```typescript
const migrations = new Migrations({
  collectionName: 'my_app_migrations'
});
```

## Error Handling

The migration system includes comprehensive error handling:

```typescript
try {
  const result = await migrations.migrateTo('latest');
  if (!result.success) {
    console.error('Migration failed:', result.error);
  }
} catch (error) {
  console.error('Migration error:', error);
}
```

## Locking

The system uses database-level locking to prevent concurrent migrations. If a migration fails and leaves the system locked, you can unlock it:

```typescript
await migrations.unlock();
```

## Testing

The package is designed to be easily testable:

```typescript
// Reset before tests
await migrations.reset();

// Add test migrations
migrations.add({
  version: 1,
  name: 'Test migration',
  up: async () => {
    // Test logic
  }
});

// Run migrations
const result = await migrations.migrateTo('latest');
```

## Migration Best Practices

1. **Always include down migrations** when possible for rollback capability
2. **Use descriptive names** for your migrations
3. **Test migrations** in a development environment first
4. **Keep migrations small and focused** on a single change
5. **Use transactions** when available for complex migrations
6. **Document breaking changes** in migration names or comments

## Examples

### Basic User Management Migration

```typescript
migrations.add({
  version: 1,
  name: 'Create users collection with indexes',
  up: async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ createdAt: 1 });
  },
  down: async () => {
    await db.collection('users').drop();
  }
});
```

### Data Migration

```typescript
migrations.add({
  version: 2,
  name: 'Migrate user roles to new format',
  up: async () => {
    await db.collection('users').updateMany(
      { role: 'admin' },
      { $set: { role: 'administrator' } }
    );
  },
  down: async () => {
    await db.collection('users').updateMany(
      { role: 'administrator' },
      { $set: { role: 'admin' } }
    );
  }
});
```

### Schema Migration

```typescript
migrations.add({
  version: 3,
  name: 'Add user preferences field',
  up: async () => {
    await db.collection('users').updateMany(
      {},
      { $set: { preferences: { theme: 'light', notifications: true } } }
    );
  },
  down: async () => {
    await db.collection('users').updateMany(
      {},
      { $unset: { preferences: 1 } }
    );
  }
});
```

## License

MIT 