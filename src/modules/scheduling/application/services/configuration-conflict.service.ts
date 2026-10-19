import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { TransactionContext } from '../../../../shared/application/ports/transaction.js';
import type { ConfigurationConflict, ConfigurationConflictRepositoryPort } from '../ports/configuration-conflicts.js';

export class ConfigurationConflictService {
  constructor(private readonly repository:ConfigurationConflictRepositoryPort){}
  async rejectIfAny(context:TransactionContext,tenantId:string,change:ConfigurationConflict):Promise<void>{
    const ids=await this.repository.findConfirmedAppointments(context,tenantId,change);
    if(ids.length)throw new ApplicationError(409,'has_bookings','Confirmed appointments conflict with this change',undefined,ids);
  }
}
