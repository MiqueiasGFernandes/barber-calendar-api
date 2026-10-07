export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}
export interface EmailSender {
  send(message: EmailMessage): Promise<{ messageId: string }>;
}
