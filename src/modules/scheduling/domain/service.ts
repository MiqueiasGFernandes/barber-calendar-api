export interface ServiceInput { name: string; description?: string; durationMinutes: number; priceMinor: number; currency: string; status?: 'active' | 'inactive'; }
export class Service {
  readonly name: string;
  readonly description?: string;
  readonly status: 'active' | 'inactive';
  constructor(readonly id: string, readonly tenantId: string, input: ServiceInput) {
    this.name = input.name.trim();
    if (!id || !tenantId || this.name.length < 1 || this.name.length > 120) throw new Error('invalid service name');
    if (input.description !== undefined && input.description.length > 1000) throw new Error('invalid service description');
    if(input.description!==undefined){for(let index=0;index<input.description.length;index++){const code=input.description.charCodeAt(index);if(code<32&&code!==9&&code!==10&&code!==13)throw new Error('invalid service description');}}
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 480) throw new Error('invalid service duration');
    if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) throw new Error('invalid service price');
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('invalid currency');
    if (input.status !== undefined && input.status !== 'active' && input.status !== 'inactive') throw new Error('invalid service status');
    if (input.description !== undefined) this.description = input.description;
    this.status = input.status ?? 'active';
  }
}
