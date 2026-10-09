export type SqlResult<Row> = { rows: Row[]; rowCount: number | null };

export interface SqlClient {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<Row>>;
  release(): void;
}

export interface SqlPool {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<Row>>;
  connect(): Promise<SqlClient>;
}
