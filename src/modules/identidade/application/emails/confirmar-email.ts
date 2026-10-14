import type { EmailMessage } from '../../../../shared/application/ports';
import { escaparHtml, linkComToken, textoDaValidade } from './link-no-email';

/*
  "Confirme seu e-mail", mandado no cadastro (e no "Mandar de novo"). A conta só
  passa a valer quando a pessoa abre o link: ele prova que o endereço é dela.
  Abre /entrar#token=…, que confirma e já entra.
*/

export const ASSUNTO_CONFIRMAR_EMAIL = 'Confirme seu e-mail no dindin';

export interface EmailConfirmarEmailInput {
  para: string;
  /** base do frontend, sem barra no fim (ex.: https://dindin.app) */
  appUrl: string;
  token: string;
  validadeEmMinutos: number;
}

export function emailConfirmarEmail({ para, appUrl, token, validadeEmMinutos }: EmailConfirmarEmailInput): EmailMessage {
  const link = linkComToken(appUrl, '/entrar', token);
  const validade = textoDaValidade(validadeEmMinutos);

  const text = [
    'Oi!',
    '',
    'Falta só um passo pra sua conta no dindin valer: confirmar que este e-mail é seu. Abra este link:',
    '',
    link,
    '',
    `Ele vale por ${validade} e funciona uma vez só.`,
    '',
    'Se não foi você que pediu, ignore este e-mail: sem a confirmação, a conta não passa a valer.',
  ].join('\n');

  const html = [
    '<p>Oi!</p>',
    '<p>Falta só um passo pra sua conta no dindin valer: confirmar que este e-mail é seu. Abra este link:</p>',
    `<p><a href="${escaparHtml(link)}">Confirmar meu e-mail</a></p>`,
    `<p>Ele vale por ${validade} e funciona uma vez só.</p>`,
    `<p>Se o link não abrir, copie e cole no navegador:<br>${escaparHtml(link)}</p>`,
    '<p>Se não foi você que pediu, ignore este e-mail: sem a confirmação, a conta não passa a valer.</p>',
  ].join('\n');

  return { to: para, subject: ASSUNTO_CONFIRMAR_EMAIL, text, html };
}
