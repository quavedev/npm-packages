import {
  RedshiftDataClient,
  ExecuteStatementCommand,
  DescribeStatementCommand,
  GetStatementResultCommand,
  StatusString,
} from '@aws-sdk/client-redshift-data';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';

/**
 * Minimal SQL simulator for the exact statements the adapter issues.
 * Just enough to exercise init/getControl/tryLock/unlock/setVersion/reset
 * plus serialized concurrent tryLocks.
 */
export interface SimState {
  exists: boolean;
  version: number;
  locked: boolean;
  lock_nonce: string | null;
  locked_at: string | null;
}

export function createSimState(): SimState {
  return { exists: false, version: 0, locked: false, lock_nonce: null, locked_at: null };
}

interface StoredResult {
  hasResultSet: boolean;
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  numberOfRecordsUpdated?: number;
  error?: string;
  failed?: boolean;
}

let nextStatementId = 1;

export interface Harness {
  client: RedshiftDataClient;
  mock: AwsClientStub<RedshiftDataClient>;
  state: SimState;
  /** Force the next (or a specific Nth) matching UPDATE tryLock to fail with a serialization error. */
  injectSerializationOn: (predicate: (sql: string) => boolean) => void;
  /** Force the next command invocation to throw a throttling error. */
  injectThrottle: (nTimes: number) => void;
}

export function createHarness(initialState: SimState = createSimState()): Harness {
  const state = initialState;
  const client = new RedshiftDataClient({ region: 'us-east-1' });
  const mock = mockClient(client);

  const statementResults = new Map<string, StoredResult>();
  let serializationPredicate: ((sql: string) => boolean) | null = null;
  let throttleRemaining = 0;

  const resolveStatement = (sql: string, params?: Array<{ name?: string; value?: string }>) => {
    const id = `stmt-${nextStatementId++}`;
    let result: StoredResult = { hasResultSet: false, numberOfRecordsUpdated: 0 };
    const p = (name: string) => params?.find((x) => x.name === name)?.value;

    if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) {
      state.exists = true;
      result = { hasResultSet: false };
    } else if (/INSERT INTO.*SELECT 'control'.*WHERE NOT EXISTS/is.test(sql)) {
      if (!state.exists) throw new Error('table does not exist');
      // idempotent seed
      result = { hasResultSet: false, numberOfRecordsUpdated: 0 };
    } else if (/UPDATE.*SET locked = TRUE/is.test(sql)) {
      if (serializationPredicate && serializationPredicate(sql)) {
        serializationPredicate = null;
        result = { hasResultSet: false, failed: true, error: 'ERROR: 1023 Serializable isolation violation on table' };
      } else if (!state.locked) {
        state.locked = true;
        state.lock_nonce = p('nonce') ?? null;
        state.locked_at = new Date().toISOString();
        result = { hasResultSet: false, numberOfRecordsUpdated: 1 };
      } else {
        result = { hasResultSet: false, numberOfRecordsUpdated: 0 };
      }
    } else if (/SELECT lock_nonce FROM.*WHERE id = 'control'/is.test(sql)) {
      result = {
        hasResultSet: true,
        columns: ['lock_nonce'],
        rows: [{ lock_nonce: state.lock_nonce }],
      };
    } else if (/UPDATE.*SET locked = FALSE/is.test(sql)) {
      state.locked = false;
      state.lock_nonce = null;
      result = { hasResultSet: false, numberOfRecordsUpdated: 1 };
    } else if (/UPDATE.*SET version = :version/is.test(sql)) {
      state.version = Number(p('version') ?? 0);
      result = { hasResultSet: false, numberOfRecordsUpdated: 1 };
    } else if (/SELECT version, locked, locked_at FROM/is.test(sql)) {
      if (!state.exists) {
        result = { hasResultSet: true, columns: ['version', 'locked', 'locked_at'], rows: [] };
      } else {
        result = {
          hasResultSet: true,
          columns: ['version', 'locked', 'locked_at'],
          rows: [
            {
              version: state.version,
              locked: state.locked,
              locked_at: state.locked_at,
            },
          ],
        };
      }
    } else if (/^\s*DELETE FROM/is.test(sql)) {
      state.exists = false;
      state.version = 0;
      state.locked = false;
      state.lock_nonce = null;
      state.locked_at = null;
      result = { hasResultSet: false };
    }

    statementResults.set(id, result);
    return id;
  };

  const maybeThrottle = () => {
    if (throttleRemaining > 0) {
      throttleRemaining--;
      const err: Error & { name?: string } = new Error('rate exceeded');
      err.name = 'ThrottlingException';
      throw err;
    }
  };

  mock.on(ExecuteStatementCommand).callsFake((input) => {
    maybeThrottle();
    const id = resolveStatement(input.Sql ?? '', input.Parameters);
    return { Id: id };
  });

  mock.on(DescribeStatementCommand).callsFake((input) => {
    maybeThrottle();
    const id = input.Id as string;
    const r = statementResults.get(id);
    if (!r) throw new Error(`Unknown statement ${id}`);
    if (r.failed) {
      return {
        Id: id,
        Status: StatusString.FAILED,
        Error: r.error ?? 'failed',
      };
    }
    return {
      Id: id,
      Status: StatusString.FINISHED,
      HasResultSet: r.hasResultSet,
      NumberOfRecordsUpdated: r.numberOfRecordsUpdated,
    };
  });

  mock.on(GetStatementResultCommand).callsFake((input) => {
    maybeThrottle();
    const id = input.Id as string;
    const r = statementResults.get(id);
    if (!r || !r.hasResultSet) {
      return { ColumnMetadata: [], Records: [] };
    }
    const columns = r.columns ?? [];
    const records = (r.rows ?? []).map((row) =>
      columns.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return { isNull: true };
        if (typeof v === 'boolean') return { booleanValue: v };
        if (typeof v === 'number') return { longValue: v };
        return { stringValue: String(v) };
      }),
    );
    return {
      ColumnMetadata: columns.map((name) => ({ name })),
      Records: records,
    };
  });

  return {
    client,
    mock,
    state,
    injectSerializationOn: (pred) => { serializationPredicate = pred; },
    injectThrottle: (n) => { throttleRemaining = n; },
  };
}
