export interface QueryResult<R extends object = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}

export interface TransactionContext {
  query<R extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface TransactionManager {
  run<T>(operation: (context: TransactionContext) => Promise<T>): Promise<T>;
}
