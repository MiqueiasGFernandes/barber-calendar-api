import { ApplicationError } from '../../../../shared/application/application-error.js';
import type { TimeZoneConverter } from '../ports/time-zone.js';
import { availableSlots } from '../../domain/availability.js';
import type { AvailabilityPort, PublicCatalogPort } from '../ports/scheduling-repository.js';
import type { Clock } from '../../../../shared/application/ports/clock.js';

export class GetPublicAvailabilityUseCase {
  constructor(private readonly catalog:PublicCatalogPort,private readonly availability:AvailabilityPort,private readonly zones:TimeZoneConverter,private readonly clock:Clock){}
  async execute(input:{tenantSlug:string;serviceId:string;date:string;professionalId?:string}){
    const tenantId=await this.catalog.tenantId(input.tenantSlug);
    const now=this.clock.now();
    const snapshot=await this.availability.load(tenantId,input.serviceId,input.date);
    if(!snapshot)throw new ApplicationError(404,'not_found','Service not found');
    const candidates=availableSlots({date:input.date,now,timeZone:snapshot.timeZone,slotIntervalMinutes:snapshot.slotIntervalMinutes,minimumAdvanceMinutes:snapshot.minimumAdvanceMinutes,durationMinutes:snapshot.service.duration_minutes,professionals:snapshot.professionals,converter:this.zones, ...(input.professionalId?{selectedProfessionalId:input.professionalId}:{})});
    const names=new Map(snapshot.service.professionals.map((professional)=>[professional.id,professional.display_name]));
    return {date:input.date,time_zone:snapshot.timeZone,service:snapshot.service,slots:candidates.map((slot)=>({starts_at:slot.startsAt.toISOString(),ends_at:slot.endsAt.toISOString(),professional_id:slot.professionalId,professional_name:names.get(slot.professionalId)??''}))};
  }
}
