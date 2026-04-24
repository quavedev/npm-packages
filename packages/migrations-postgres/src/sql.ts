export function qualify(schema: string, table: string): string {
  return `"${schema}"."${table}"`;
}

export const createTableSql = (q: string): string => `
  CREATE TABLE IF NOT EXISTS ${q} (
    id         TEXT PRIMARY KEY,
    version    INTEGER NOT NULL DEFAULT 0,
    locked     BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at  TIMESTAMPTZ
  );
`;

export const seedRowSql = (q: string): string => `
  INSERT INTO ${q} (id, version, locked)
  VALUES ('control', 0, FALSE)
  ON CONFLICT (id) DO NOTHING;
`;

export const tryLockSql = (q: string): string => `
  UPDATE ${q}
     SET locked = TRUE, locked_at = NOW()
   WHERE id = 'control' AND locked = FALSE
  RETURNING id;
`;

export const unlockSql = (q: string): string =>
  `UPDATE ${q} SET locked = FALSE WHERE id = 'control';`;

export const setVersionSql = (q: string): string =>
  `UPDATE ${q} SET version = $1 WHERE id = 'control';`;

export const getControlSql = (q: string): string =>
  `SELECT version, locked, locked_at FROM ${q} WHERE id = 'control';`;

export const resetSql = (q: string): string => `DELETE FROM ${q};`;
