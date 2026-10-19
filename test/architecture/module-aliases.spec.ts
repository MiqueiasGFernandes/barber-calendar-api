import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('ESM module aliases', () => {
  it('resolves scheduling and audit modules at runtime', async () => {
    expect(() =>
      execFileSync('node', [
        '--input-type=module',
        '-e',
        "await import('#scheduling/scheduling.module.js'); await import('#audit/infrastructure/postgres-security-event-writer.js')",
      ]),
    ).not.toThrow();
  });
  it('registers scheduling lifecycle and observability providers in the compiled module', () => {
    const script = `
      await import('reflect-metadata');
      const {SchedulingModule}=await import('#scheduling/scheduling.module.js');
      const registered=Reflect.getMetadata('providers',SchedulingModule).map(value=>typeof value==='function'?value:value.provide);
      for(const [path,name] of [
        ['application/services/appointment-lifecycle.service.js','AppointmentLifecycleService'],
        ['application/services/scheduling-observability.service.js','SchedulingObservabilityService'],
        ['application/use-cases/list-appointments.use-case.js','ListAppointmentsUseCase'],
        ['application/use-cases/cancel-appointment.use-case.js','CancelAppointmentUseCase'],
        ['application/use-cases/reschedule-appointment.use-case.js','RescheduleAppointmentUseCase'],
        ['application/use-cases/record-appointment-outcome.use-case.js','RecordAppointmentOutcomeUseCase'],
      ]){
        const module=await import('#scheduling/'+path);
        if(!registered.includes(module[name]))throw new Error('Missing provider '+name);
      }
    `;
    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script]),
    ).not.toThrow();
  });
});
