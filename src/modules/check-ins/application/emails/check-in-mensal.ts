import type { EmailMessage } from '../../../../shared/application/ports';

/*
  E-mail mensal do check-in. Função pura: sem I/O, fácil de testar e de ver o
  texto final.

  O token de descadastro vai no FRAGMENTO (#token=…), nunca na query: o que vem
  depois do "#" não sai do navegador — não chega em servidor, log de proxy,
  Referer nem em script de anúncio ou analytics carregado na página.

  Nenhum nome de banco, corretora ou produto financeiro: o e-mail só pergunta
  como foi o mês.
*/

export const MESES_POR_EXTENSO = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** "2026-09" → "setembro". Competência fora do formato volta como veio. */
export function mesPorExtenso(competencia: string): string {
  return MESES_POR_EXTENSO[Number(competencia.slice(5, 7)) - 1] ?? competencia;
}

export function assuntoCheckInMensal(competencia: string): string {
  return `Como foi ${mesPorExtenso(competencia)} com o seu dinheiro?`;
}

export interface EmailCheckInMensalInput {
  para: string;
  /** base do frontend, com ou sem barra no fim (ex.: https://dindin.app) */
  appUrl: string;
  /** "2026-09" */
  competencia: string;
  /** token assinado de descadastro (AuthTokenService.issueUnsubscribe) */
  tokenDescadastro: string;
}

function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function linksDoCheckInMensal(appUrl: string, competencia: string, tokenDescadastro: string) {
  const base = appUrl.replace(/\/+$/, '');
  return {
    checkIn: `${base}/check-in/${competencia}`,
    descadastro: `${base}/descadastrar#token=${encodeURIComponent(tokenDescadastro)}`,
  };
}

export function emailCheckInMensal({ para, appUrl, competencia, tokenDescadastro }: EmailCheckInMensalInput): EmailMessage {
  const links = linksDoCheckInMensal(appUrl, competencia, tokenDescadastro);
  const mes = mesPorExtenso(competencia);
  const Mes = mes.charAt(0).toUpperCase() + mes.slice(1);

  const text = [
    'Oi!',
    '',
    `${Mes} acabou. Leva um minuto: conte quanto entrou, quanto saiu e quanto ficou guardado, e veja se o mês bateu com o seu plano.`,
    '',
    'Responder agora:',
    links.checkIn,
    '',
    'Não quer mais receber este lembrete? Descadastre-se com um clique:',
    links.descadastro,
  ].join('\n');

  const html = [
    '<p>Oi!</p>',
    `<p>${escaparHtml(Mes)} acabou. Leva um minuto: conte quanto entrou, quanto saiu e quanto ficou guardado, e veja se o mês bateu com o seu plano.</p>`,
    `<p><a href="${escaparHtml(links.checkIn)}">Contar como foi ${escaparHtml(mes)}</a></p>`,
    `<p>Se o link não abrir, copie e cole no navegador:<br>${escaparHtml(links.checkIn)}</p>`,
    `<p style="font-size:12px;color:#666">Não quer mais receber este lembrete? <a href="${escaparHtml(links.descadastro)}">Descadastre-se com um clique</a>.</p>`,
  ].join('\n');

  return { to: para, subject: assuntoCheckInMensal(competencia), text, html };
}
