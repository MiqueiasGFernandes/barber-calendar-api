export const expectedSchemaRevision = '002-appointment-scheduling-v2';

export class SchemaCompatibilityError extends Error {
  constructor(readonly actualRevision: unknown) {
    super('Database schema is incompatible with this application');
    this.name = 'SchemaCompatibilityError';
  }
}
