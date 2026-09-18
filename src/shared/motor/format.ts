/*
  GERADO a partir de dindinFrontend/src/lib/format.ts — NÃO EDITE AQUI.
  Altere no frontend e rode `yarn motor:sync` no backend.
*/

/* Formatação pt-BR. Puro, sem dependências — usado no domínio e na UI. */

const brlInteiro = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const brlCentavos = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** R$ 1.234 (arredonda) ou, com `centavos`, R$ 1.234,56 */
export function formatBRL(valor: number, opts: { centavos?: boolean } = {}): string {
  const n = Number.isFinite(valor) ? valor : 0;
  return opts.centavos ? brlCentavos.format(n) : brlInteiro.format(n);
}

/** 0.4321 → "43%"; com `casas`, "43,2%" */
export function formatPct(fracao: number, casas = 0): string {
  const n = Number.isFinite(fracao) ? fracao * 100 : 0;
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`;
}

/** 1 → "1 mês", 14 → "1 ano e 2 meses", 24 → "2 anos" */
export function formatMeses(meses: number): string {
  const m = Math.max(0, Math.round(meses));
  if (m === 0) return "agora";
  if (m < 12) return m === 1 ? "1 mês" : `${m} meses`;
  const anos = Math.floor(m / 12);
  const resto = m % 12;
  const a = anos === 1 ? "1 ano" : `${anos} anos`;
  if (resto === 0) return a;
  const r = resto === 1 ? "1 mês" : `${resto} meses`;
  return `${a} e ${r}`;
}

/** "1.234,56" / "R$ 1.234" / "1234" → 1234.56 ; inválido → NaN */
export function parseBRL(texto: string): number {
  const limpo = texto.replace(/[^\d,.-]/g, "");
  if (!limpo) return NaN;
  // pt-BR: ponto é milhar, vírgula é decimal
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo.replace(/\.(?=\d{3}(\D|$))/g, "");
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : NaN;
}

/** Máscara de digitação: mantém só dígitos e devolve "1.234" */
export function mascaraInteiroBRL(texto: string): string {
  const digitos = texto.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digitos) return "";
  return Number(digitos).toLocaleString("pt-BR");
}

/**
 * Máscara de digitação com centavos: cada dígito entra pela direita, como na
 * maquininha e no app do banco — digitar 324780 mostra "3.247,80".
 *
 * Existe porque salário bruto e líquido calculado têm centavos: R$ 3.247,80 não
 * é digitável com a máscara de inteiro.
 */
export function mascaraCentavosBRL(texto: string): string {
  const digitos = texto.replace(/\D/g, "").replace(/^0+(?=\d{3})/, "");
  if (!digitos) return "";
  const centavos = Number(digitos.padStart(3, "0"));
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Máscara de digitação de uma taxa em porcentagem: só dígitos, uma vírgula e no
 * máximo duas casas, limitada a `maxPct`.
 *
 * Devolve o TEXTO limpo, não o número: "0" e "0," precisam continuar na tela
 * enquanto a pessoa digita, senão a tecla seguinte não tem onde cair. Foi
 * exatamente por isso que a primeira versão do campo de rendimento não pegava —
 * ela reaproveitava a máscara de dinheiro, que monta o número da direita pra
 * esquerda e transformava "0,8" em "0,08" e um "1" sozinho em 0,1%.
 */
export function mascaraTaxa(texto: string, maxPct: number): string {
  const soNumero = texto.replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const [inteira = "", ...resto] = soNumero.split(",");
  const limpo = resto.length === 0 ? inteira.slice(0, 2) : `${inteira.slice(0, 2)},${resto.join("").slice(0, 2)}`;
  const numero = Number(limpo.replace(",", "."));
  // acima do teto o campo para no teto, em vez de guardar um número e mostrar outro
  return Number.isFinite(numero) && numero > maxPct ? String(maxPct) : limpo;
}

/** "0,8" → 0.008. Devolve null enquanto ainda não é número ("", "0,", "," …). */
export function taxaDoTexto(texto: string, maxPct: number): number | null {
  const numero = Number(texto.replace(",", "."));
  if (texto.trim() === "" || !Number.isFinite(numero) || numero <= 0) return null;
  return arredondar(Math.min(numero, maxPct) / 100, 5);
}

/** 0.008 → "0,8". Vazio quando não há taxa. */
export function textoDaTaxa(fracao: number | undefined): string {
  if (fracao === undefined || !Number.isFinite(fracao)) return "";
  return (fracao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function arredondar(valor: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * f) / f;
}
