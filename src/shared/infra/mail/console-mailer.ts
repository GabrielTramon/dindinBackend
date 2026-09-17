import type { EmailMessage, Mailer } from '../../application/ports';

/**
 * Desenvolvimento: em vez de enviar, imprime no terminal — é assim que você
 * pega o link mágico sem configurar provedor nenhum.
 */
export class ConsoleMailer implements Mailer {
  async send(message: EmailMessage): Promise<void> {
    const linha = '─'.repeat(60);
    console.info(`\n${linha}\n✉  para: ${message.to}\n   assunto: ${message.subject}\n\n${message.text}\n${linha}\n`);
  }
}
