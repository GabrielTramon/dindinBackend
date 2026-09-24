import type { EmailMessage } from '../../../../shared/application/ports';
import { escaparHtml, linkComToken, textoDaValidade } from './link-no-email';

/*
  "Confirme seu e-mail", mandado no cadastro. A pessoa já entrou (a senha basta
  pra isso); o link só prova que o endereço é dela — sem essa prova o e-mail
  mensal nunca sai, porque o endereço pode ter sido digitado por outra pessoa.
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
    'Sua conta no dindin foi criada. Pra confirmar que este e-mail é seu, abra este link:',
    '',
    link,
    '',
    `Ele vale por ${validade} e funciona uma vez só.`,
    '',
    'Se não foi você que criou a conta, ignore este e-mail.',
  ].join('\n');

  const html = [
    '<p>Oi!</p>',
    '<p>Sua conta no dindin foi criada. Pra confirmar que este e-mail é seu, abra este link:</p>',
    `<p><a href="${escaparHtml(link)}">Confirmar meu e-mail</a></p>`,
    `<p>Ele vale por ${validade} e funciona uma vez só.</p>`,
    `<p>Se o link não abrir, copie e cole no navegador:<br>${escaparHtml(link)}</p>`,
    '<p>Se não foi você que criou a conta, ignore este e-mail.</p>',
  ].join('\n');

  return { to: para, subject: ASSUNTO_CONFIRMAR_EMAIL, text, html };
}
