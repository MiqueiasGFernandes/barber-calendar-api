import type { PublicCatalogPort } from '../ports/scheduling-repository.js';
export class ListPublicServicesUseCase {
  constructor(private readonly catalog: PublicCatalogPort) {}
  async execute(tenantSlug:string){return { services: await this.catalog.listServices(tenantSlug) };}
}
