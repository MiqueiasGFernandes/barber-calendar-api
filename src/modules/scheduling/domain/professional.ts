export class Professional {
  readonly displayName: string;
  constructor(readonly id: string, readonly tenantId: string, displayName: string, readonly status: 'active' | 'inactive' = 'active') {
    this.displayName = displayName.trim();
    if (!id || !tenantId || this.displayName.length < 1 || this.displayName.length > 120) throw new Error('invalid professional name');
  }
}
