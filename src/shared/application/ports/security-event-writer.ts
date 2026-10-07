export interface SecurityEvent {
  id: string;
  eventType: string;
  outcome: 'succeeded' | 'rejected' | 'failed';
  occurredAt: Date;
  correlationId: string;
  tenantId?: string;
  actorUserId?: string;
  challengeId?: string;
  sessionId?: string;
  reasonCode?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}
export interface SecurityEventWriter {
  write(event: SecurityEvent): Promise<void>;
}
