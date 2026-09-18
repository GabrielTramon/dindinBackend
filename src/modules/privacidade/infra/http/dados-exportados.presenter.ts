import { FUSO_DO_PRODUTO } from '../../../check-ins';
import type { DadosExportados, PerfilExportado } from '../../application/dados-exportados';

/*
  O arquivo de exportação como a pessoa baixa. Copia campo a campo, em vez de
  serializar o objeto do caso de uso direto: se a estrutura ganhar um campo
  interno no futuro, ele não vaza no arquivo sem alguém decidir.

  A exceção é o perfil — ver presentPerfilExportado logo abaixo: ali a lista
  campo a campo era o próprio defeito.

  Datas em ISO; enums já vêm minúsculos do domínio.
*/

const iso = (data: Date | null): string | null => data?.toISOString() ?? null;

/*
  A única tradução do perfil é a data: o resto são as respostas da pessoa, e
  `PerfilExportado` (DadosPerfil + atualizadoEm) já é uma lista fechada de coisas
  que a exportação DEVE trazer. Listar campo a campo aqui é justamente o que
  fazia o ritmo, a meta e o salário bruto sumirem do arquivo sem nenhum teste
  ficar vermelho — o bug que o checklist da especificação nomeia.

  Chave opcional ausente continua ausente: o domínio já omite (nunca manda null).
*/
function presentPerfilExportado(perfil: PerfilExportado) {
  const { atualizadoEm, ...respostas } = perfil;
  return { ...respostas, atualizadoEm: atualizadoEm.toISOString() };
}

export function presentDadosExportados(dados: DadosExportados) {
  const { conta, perfil } = dados;
  return {
    exportadoEm: dados.exportadoEm.toISOString(),
    conta: {
      email: conta.email,
      criadoEm: conta.criadoEm.toISOString(),
      emailVerificadoEm: iso(conta.emailVerificadoEm),
      ativo: conta.ativo,
    },
    perfil: perfil === null ? null : presentPerfilExportado(perfil),
    gastosFixos: dados.gastosFixos.map((g) => ({
      categoria: g.categoria,
      valor: g.valor,
      criadoEm: g.criadoEm.toISOString(),
    })),
    categoriasPersonalizadas: dados.categoriasPersonalizadas.map((c) => ({
      nome: c.nome,
      criadoEm: c.criadoEm.toISOString(),
    })),
    dividas: dados.dividas.map((d) => ({
      tipo: d.tipo,
      saldo: d.saldo,
      parcela: d.parcela,
      taxaAnual: d.taxaAnual,
      criadoEm: d.criadoEm.toISOString(),
    })),
    // entrada e resultado vão inteiros: é o plano no formato do motor, o mesmo que a tela mostra
    planos: dados.planos.map((p) => ({
      versao: p.versao,
      criadoEm: p.criadoEm.toISOString(),
      entrada: p.entrada,
      resultado: p.resultado,
    })),
    metas: dados.metas.map((m) => ({
      nome: m.nome,
      valorAlvo: m.valorAlvo,
      aporteMensal: m.aporteMensal,
      prazoMeses: m.prazoMeses,
      acumulado: m.acumulado,
      publicSlug: m.publicSlug,
      criadoEm: m.criadoEm.toISOString(),
      atualizadoEm: m.atualizadoEm.toISOString(),
    })),
    checkIns: dados.checkIns.map((c) => ({
      competencia: c.competencia,
      rendaReal: c.rendaReal,
      gastoReal: c.gastoReal,
      guardadoReal: c.guardadoReal,
      enviadoEm: iso(c.enviadoEm),
      respondidoEm: iso(c.respondidoEm),
      criadoEm: c.criadoEm.toISOString(),
    })),
    grupos: dados.grupos.map((g) => ({
      nome: g.nome,
      icone: g.icone,
      valor: g.valor,
      contaParaMeta: g.contaParaMeta,
      rendimentoMensal: g.rendimentoMensal,
      doSistema: g.doSistema,
      criadoEm: g.criadoEm.toISOString(),
      itens: g.itens.map((item) => ({ nome: item.nome, valor: item.valor })),
    })),
  };
}

export type DadosExportadosResponse = ReturnType<typeof presentDadosExportados>;

/**
 * "dindin-meus-dados-2026-09-17.json", com a data no fuso do produto: quem exporta
 * às 23h30 de São Paulo (02h30 UTC do dia seguinte) recebe o arquivo com a data de hoje.
 */
export function nomeDoArquivoExportado(exportadoEm: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DO_PRODUTO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(exportadoEm);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value;
  return `dindin-meus-dados-${parte('year')}-${parte('month')}-${parte('day')}.json`;
}
