import type { PublicCatalogPort } from '../ports/scheduling-repository.js';
export class ListPublicServicesUseCase {
  constructor(private readonly catalog: PublicCatalogPort) {}
  execute(tenantSlug:string){return this.catalog.listServices(tenantSlug);}
}
