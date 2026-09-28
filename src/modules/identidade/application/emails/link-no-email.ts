/*
  Peças comuns dos e-mails com link. Funções puras: sem I/O, fáceis de testar e
  de ver o texto final.

  O token vai no FRAGMENTO (#token=…), nunca na query: o que vem depois do "#"
  não sai do navegador — não chega em servidor, log de proxy, Referer nem em
  script de anúncio ou analytics carregado na página.
*/

export function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** `${appUrl}${caminho}#token=…`, sem barra dobrada e com o token codificado. */
export function linkComToken(appUrl: string, caminho: `/${string}`, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}${caminho}#token=${encodeURIComponent(token)}`;
}

/** 15 → "15 minutos"; 60 → "1 hora"; 2880 → "48 horas". */
export function textoDaValidade(minutos: number): string {
  if (minutos % 60 === 0) {
    const horas = minutos / 60;
    return horas === 1 ? '1 hora' : `${horas} horas`;
  }
  return minutos === 1 ? '1 minuto' : `${minutos} minutos`;
}
