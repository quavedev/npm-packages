import {
  RedshiftDataClient,
  ExecuteStatementCommand,
  DescribeStatementCommand,
  GetStatementResultCommand,
  StatusString,
  SqlParameter,
  Field,
  ColumnMetadata,
} from '@aws-sdk/client-redshift-data';

export interface ExecuteResult {
  rows: Array<Record<string, unknown>>;
  columnMetadata: ColumnMetadata[];
  numberOfRecordsUpdated?: number;
  statementId: string;
  errorText?: string;
}

export interface AuthOpts {
  database: string;
  clusterIdentifier?: string;
  workgroupName?: string;
  dbUser?: string;
  secretArn?: string;
}

export interface ExecutorOpts {
  pollIntervalMs?: number;
  pollMaxIntervalMs?: number;
  statementTimeoutMs?: number;
  maxThrottleRetries?: number;
}

export class RedshiftStatementError extends Error {
  override readonly name = 'RedshiftStatementError';
  readonly statementId: string;
  readonly sql: string;
  readonly status?: StatusString;
  constructor(opts: { message: string; statementId: string; sql: string; status?: StatusString }) {
    super(opts.message);
    this.statementId = opts.statementId;
    this.sql = opts.sql;
    if (opts.status !== undefined) {
      this.status = opts.status;
    }
  }
}

const SERIALIZATION_ERROR_PATTERNS = [
  /serializable isolation violation/i,
  /1023/,
  /concurrent transaction/i,
];

export function isSerializationError(errorText: string | undefined): boolean {
  if (!errorText) return false;
  return SERIALIZATION_ERROR_PATTERNS.some((p) => p.test(errorText));
}

const THROTTLE_ERROR_NAMES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ActiveStatementsExceededException',
]);

function isThrottleError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return typeof name === 'string' && THROTTLE_ERROR_NAMES.has(name);
}

function jitter(ms: number): number {
  return Math.floor(ms * (0.5 + Math.random()));
}

export class DataApiExecutor {
  private client: RedshiftDataClient;
  private auth: AuthOpts;
  private pollIntervalMs: number;
  private pollMaxIntervalMs: number;
  private statementTimeoutMs: number;
  private maxThrottleRetries: number;

  constructor(client: RedshiftDataClient, auth: AuthOpts, opts: ExecutorOpts = {}) {
    this.client = client;
    this.auth = auth;
    this.pollIntervalMs = opts.pollIntervalMs ?? 100;
    this.pollMaxIntervalMs = opts.pollMaxIntervalMs ?? 2000;
    this.statementTimeoutMs = opts.statementTimeoutMs ?? 300_000;
    this.maxThrottleRetries = opts.maxThrottleRetries ?? 5;
  }

  async execute(sql: string, params?: SqlParameter[]): Promise<ExecuteResult> {
    const startCmd = new ExecuteStatementCommand({
      Sql: sql,
      Database: this.auth.database,
      ...(this.auth.clusterIdentifier ? { ClusterIdentifier: this.auth.clusterIdentifier } : {}),
      ...(this.auth.workgroupName ? { WorkgroupName: this.auth.workgroupName } : {}),
      ...(this.auth.dbUser ? { DbUser: this.auth.dbUser } : {}),
      ...(this.auth.secretArn ? { SecretArn: this.auth.secretArn } : {}),
      ...(params ? { Parameters: params } : {}),
    });

    const started = await this.sendWithRetry(() => this.client.send(startCmd));
    const statementId = started.Id;
    if (!statementId) {
      throw new Error('Redshift Data API ExecuteStatement returned no Id');
    }

    const description = await this.pollForCompletion(statementId, sql);

    const result: ExecuteResult = {
      rows: [],
      columnMetadata: [],
      statementId,
    };
    if (description.Error) {
      result.errorText = description.Error;
    }
    if (description.HasResultSet) {
      await this.collectRows(statementId, result);
    }
    if (typeof description.NumberOfRecordsUpdated === 'number') {
      result.numberOfRecordsUpdated = description.NumberOfRecordsUpdated;
    }
    return result;
  }

  private async pollForCompletion(
    statementId: string,
    sql: string,
  ): Promise<{
    Status?: StatusString;
    Error?: string;
    HasResultSet?: boolean;
    NumberOfRecordsUpdated?: number;
    ResultRows?: number;
  }> {
    const deadline = Date.now() + this.statementTimeoutMs;
    let interval = this.pollIntervalMs;
    while (true) {
      if (Date.now() > deadline) {
        throw new RedshiftStatementError({
          message: `Statement ${statementId} timed out after ${this.statementTimeoutMs}ms`,
          statementId,
          sql,
        });
      }
      const describe = await this.sendWithRetry(() =>
        this.client.send(new DescribeStatementCommand({ Id: statementId })),
      );
      const status = describe.Status;
      if (status === StatusString.FINISHED) {
        return describe;
      }
      if (status === StatusString.FAILED || status === StatusString.ABORTED) {
        const err = new RedshiftStatementError({
          message: describe.Error ?? `Statement ${statementId} ${status}`,
          statementId,
          sql,
          ...(status ? { status } : {}),
        });
        // Attach the raw error text so callers (lock path) can inspect it.
        (err as { errorText?: string }).errorText = describe.Error;
        throw err;
      }
      await new Promise((r) => setTimeout(r, interval));
      interval = Math.min(Math.floor(interval * 1.5), this.pollMaxIntervalMs);
    }
  }

  private async collectRows(statementId: string, result: ExecuteResult): Promise<void> {
    let nextToken: string | undefined;
    do {
      const page = await this.sendWithRetry(() =>
        this.client.send(
          new GetStatementResultCommand({
            Id: statementId,
            ...(nextToken ? { NextToken: nextToken } : {}),
          }),
        ),
      );
      if (page.ColumnMetadata && result.columnMetadata.length === 0) {
        result.columnMetadata = page.ColumnMetadata;
      }
      if (page.Records) {
        const columns = result.columnMetadata;
        for (const record of page.Records) {
          const row: Record<string, unknown> = {};
          record.forEach((field: Field, idx: number) => {
            const col = columns[idx];
            const name = col?.name ?? `col${idx}`;
            row[name] = fieldValue(field);
          });
          result.rows.push(row);
        }
      }
      nextToken = page.NextToken;
    } while (nextToken);
  }

  private async sendWithRetry<T>(send: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let delay = this.pollIntervalMs;
    while (true) {
      try {
        return await send();
      } catch (err) {
        if (!isThrottleError(err) || attempt >= this.maxThrottleRetries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, jitter(delay)));
        attempt++;
        delay = Math.min(delay * 2, this.pollMaxIntervalMs);
      }
    }
  }
}

function fieldValue(field: Field): unknown {
  if (field.isNull) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.longValue !== undefined) return field.longValue;
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.blobValue !== undefined) return field.blobValue;
  return null;
}
