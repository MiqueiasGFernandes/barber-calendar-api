import { createConnection } from 'node:net';
import type {
  EmailMessage,
  EmailSender,
} from '../../../../shared/application/ports/email-sender.js';
export class MailpitEmailSender implements EmailSender {
  constructor(
    private readonly host = 'mailpit',
    private readonly port = 1025,
  ) {}
  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const id = `<${message.idempotencyKey}@barber-calendar.local>`;
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.port, this.host);
      let step = 0;
      const commands = [
        `EHLO barber-calendar.local\r\n`,
        `MAIL FROM:<no-reply@barber-calendar.local>\r\n`,
        `RCPT TO:<${message.to}>\r\n`,
        `DATA\r\n`,
        `Message-ID: ${id}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message.text}\r\n.\r\n`,
        `QUIT\r\n`,
      ];
      socket.setTimeout(5000);
      socket.on('data', () => {
        const command = commands[step++];
        if (command) socket.write(command);
        else {
          socket.end();
          resolve();
        }
      });
      socket.on('error', reject);
      socket.on('timeout', () => socket.destroy(new Error('SMTP timeout')));
    });
    return { messageId: id };
  }
}
