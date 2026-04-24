export function qualify(schema: string, table: string): string {
  return `"${schema}"."${table}"`;
}

export const createTableSql = (q: string): string => `
  CREATE TABLE IF NOT EXISTS ${q} (
    id          VARCHAR(16) NOT NULL,
    version     INTEGER     NOT NULL DEFAULT 0,
    locked      BOOLEAN     NOT NULL DEFAULT FALSE,
    lock_nonce  VARCHAR(64),
    locked_at   TIMESTAMP,
    PRIMARY KEY (id)
  );
`;

export const seedRowSql = (q: string): string => `
  INSERT INTO ${q} (id, version, locked)
  SELECT 'control', 0, FALSE
  WHERE NOT EXISTS (SELECT 1 FROM ${q} WHERE id = 'control');
`;

export const tryLockSql = (q: string): string => `
  UPDATE ${q}
     SET locked = TRUE, lock_nonce = :nonce, locked_at = SYSDATE
   WHERE id = 'control' AND locked = FALSE;
`;

export const readNonceSql = (q: string): string =>
  `SELECT lock_nonce FROM ${q} WHERE id = 'control';`;

export const unlockSql = (q: string): string =>
  `UPDATE ${q} SET locked = FALSE, lock_nonce = NULL WHERE id = 'control';`;

export const setVersionSql = (q: string): string =>
  `UPDATE ${q} SET version = :version WHERE id = 'control';`;

export const getControlSql = (q: string): string =>
  `SELECT version, locked, locked_at FROM ${q} WHERE id = 'control';`;

export const resetSql = (q: string): string => `DELETE FROM ${q};`;
