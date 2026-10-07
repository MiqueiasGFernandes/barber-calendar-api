import type {
  EmailMessage,
  EmailSender,
} from '../../../../shared/application/ports/email-sender.js';
export class BrevoEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly sender: { email: string; name: string },
  ) {}
  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': this.apiKey,
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({
        sender: this.sender,
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
      }),
    });
    if (!response.ok) throw new Error(`email provider failed with ${String(response.status)}`);
    const data = (await response.json()) as { messageId?: string };
    return { messageId: data.messageId ?? message.idempotencyKey };
  }
}
