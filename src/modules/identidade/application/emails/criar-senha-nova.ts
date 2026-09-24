import type { EmailMessage } from '../../../../shared/application/ports';
import { escaparHtml, linkComToken, textoDaValidade } from './link-no-email';

/*
  "Criar uma senha nova", mandado pelo Esqueci a senha. Abre
  /redefinir-senha#token=…, onde a pessoa escolhe a senha e já entra. Serve
  também pra conta antiga, do link mágico, que nunca teve senha.
*/

export const ASSUNTO_CRIAR_SENHA_NOVA = 'Criar uma senha nova no dindin';

export interface EmailCriarSenhaNovaInput {
  para: string;
  /** base do frontend, sem barra no fim (ex.: https://dindin.app) */
  appUrl: string;
  token: string;
  validadeEmMinutos: number;
}

export function emailCriarSenhaNova({ para, appUrl, token, validadeEmMinutos }: EmailCriarSenhaNovaInput): EmailMessage {
  const link = linkComToken(appUrl, '/redefinir-senha', token);
  const validade = textoDaValidade(validadeEmMinutos);

  const text = [
    'Oi!',
    '',
    'Pediram uma senha nova pra sua conta no dindin. Se foi você, abra este link e escolha a senha:',
    '',
    link,
    '',
    `Ele vale por ${validade} e funciona uma vez só.`,
    '',
    'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
  ].join('\n');

  const html = [
    '<p>Oi!</p>',
    '<p>Pediram uma senha nova pra sua conta no dindin. Se foi você, abra este link e escolha a senha:</p>',
    `<p><a href="${escaparHtml(link)}">Criar uma senha nova</a></p>`,
    `<p>Ele vale por ${validade} e funciona uma vez só.</p>`,
    `<p>Se o link não abrir, copie e cole no navegador:<br>${escaparHtml(link)}</p>`,
    '<p>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>',
  ].join('\n');

  return { to: para, subject: ASSUNTO_CRIAR_SENHA_NOVA, text, html };
}
