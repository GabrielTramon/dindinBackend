import type { EmailMessage, Mailer } from '../../application/ports';

/*
  Envio real via API HTTP do Resend. fetch nativo do Node 22 — sem SDK, sem
  dependência a mais. Falha de envio vira exceção: quem chama decide se
  derruba a requisição ou só registra.
*/

export interface ResendMailerOptions {
  apiKey: string;
  from: string;
  /** injetável pra teste */
  fetchImpl?: typeof fetch;
}

export class ResendMailer implements Mailer {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResendMailerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const corpo = await response.text().catch(() => '');
      throw new Error(`Resend respondeu ${response.status}: ${corpo.slice(0, 300)}`);
    }
  }
}
