import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export class PostgresPool implements Queryable {
  readonly pool: Pool;
  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, [...values]);
  }
  connect(): Promise<PoolClient> {
    return this.pool.connect();
  }
  close(): Promise<void> {
    return this.pool.end();
  }
}
