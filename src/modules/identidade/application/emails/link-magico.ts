import type { EmailMessage } from '../../../../shared/application/ports';

/*
  E-mail do link mágico. Função pura: sem I/O, fácil de testar e de ver o texto final.

  O token vai no FRAGMENTO (#token=…), nunca na query: o que vem depois do "#"
  não sai do navegador — não chega em servidor, log de proxy, Referer nem em
  script de anúncio ou analytics carregado na página /entrar.
*/

export const ASSUNTO_LINK_MAGICO = 'Seu link pra entrar no dindin';

export interface EmailLinkMagicoInput {
  para: string;
  /** base do frontend, sem barra no fim (ex.: https://dindin.app) */
  appUrl: string;
  token: string;
  validadeEmMinutos: number;
}

function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function linkDeEntrada(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/entrar#token=${encodeURIComponent(token)}`;
}

export function emailLinkMagico({ para, appUrl, token, validadeEmMinutos }: EmailLinkMagicoInput): EmailMessage {
  const link = linkDeEntrada(appUrl, token);
  const validade = validadeEmMinutos === 1 ? '1 minuto' : `${validadeEmMinutos} minutos`;

  const text = [
    'Oi!',
    '',
    'Pra entrar no dindin, abra este link:',
    '',
    link,
    '',
    `Ele vale por ${validade} e funciona uma vez só.`,
    '',
    'Se não foi você, ignore este e-mail. Ninguém entra na sua conta sem este link.',
  ].join('\n');

  const html = [
    '<p>Oi!</p>',
    '<p>Pra entrar no dindin, abra este link:</p>',
    `<p><a href="${escaparHtml(link)}">Entrar no dindin</a></p>`,
    `<p>Ele vale por ${validade} e funciona uma vez só.</p>`,
    `<p>Se o link não abrir, copie e cole no navegador:<br>${escaparHtml(link)}</p>`,
    '<p>Se não foi você, ignore este e-mail. Ninguém entra na sua conta sem este link.</p>',
  ].join('\n');

  return { to: para, subject: ASSUNTO_LINK_MAGICO, text, html };
}
