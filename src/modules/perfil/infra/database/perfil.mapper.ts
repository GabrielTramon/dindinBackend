import {
  Prisma,
  type MetaTipo as MetaTipoDb,
  type Moradia as MoradiaDb,
  type Profile as ProfileRow,
  type RendaInformada as RendaInformadaDb,
  type Ritmo as RitmoDb,
  type TipoRenda as TipoRendaDb,
} from '../../../../generated/prisma/client';
import { decimalToNumber, numberToDecimal } from '../../../../shared/infra/database/decimal';
import type {
  GuardadoNaMeta,
  Meta,
  MetaTipo,
  Moradia,
  RendaInformada,
  Ritmo,
  TipoRenda,
} from '../../../../shared/motor/types';
import { Perfil } from '../../domain/perfil';

/*
  Linha do Prisma ⇄ entidade. Enums MAIÚSCULOS no banco (CLT, PAIS, ACELERADO)
  e minúsculos no domínio e na API, como o frontend manda; dinheiro
  Decimal(12,2) ⇄ number. A chave do perfil é o próprio subscriber_id.

  Coluna nula ⇄ campo ausente, nos dois sentidos. Na ida a chave é OMITIDA em
  vez de vir com `undefined`: `structuredClone` preserva chave com undefined, e
  o snapshot de quem respondeu antes destes campos passaria a ter chaves que
  ele nunca teve — é justamente o que faria o inputSnap mudar de forma.
*/

export function tipoRendaToDomain(tipo: TipoRendaDb): TipoRenda {
  return tipo.toLowerCase() as TipoRenda;
}

export function tipoRendaToDb(tipo: TipoRenda): TipoRendaDb {
  return tipo.toUpperCase() as TipoRendaDb;
}

export function moradiaToDomain(moradia: MoradiaDb): Moradia {
  return moradia.toLowerCase() as Moradia;
}

export function moradiaToDb(moradia: Moradia): MoradiaDb {
  return moradia.toUpperCase() as MoradiaDb;
}

export function rendaInformadaToDomain(renda: RendaInformadaDb): RendaInformada {
  return renda.toLowerCase() as RendaInformada;
}

export function rendaInformadaToDb(renda: RendaInformada): RendaInformadaDb {
  return renda.toUpperCase() as RendaInformadaDb;
}

export function ritmoToDomain(ritmo: RitmoDb): Ritmo {
  return ritmo.toLowerCase() as Ritmo;
}

export function ritmoToDb(ritmo: Ritmo): RitmoDb {
  return ritmo.toUpperCase() as RitmoDb;
}

export function metaTipoToDomain(tipo: MetaTipoDb): MetaTipo {
  return tipo.toLowerCase() as MetaTipo;
}

export function metaTipoToDb(tipo: MetaTipo): MetaTipoDb {
  return tipo.toUpperCase() as MetaTipoDb;
}

/*
  Os potes da meta (meta_guardados, JSONB) ⇄ Meta.guardados. Na volta, cada pote
  é remontado campo a campo, na ordem do tipo do motor: o JSONB reordena as
  chaves e devolveria qualquer campo que alguém tivesse posto ali. Como todo
  restaurar, não revalida — o que entrou saiu de Perfil.criar. Coluna que não é
  lista é defeito: vira "não respondeu" em vez de derrubar o GET do perfil.
*/
function guardadosToDomain(json: Prisma.JsonValue | null): GuardadoNaMeta[] | undefined {
  if (!Array.isArray(json)) return undefined;
  return json.map((item) => {
    const pote = item as Record<string, unknown>;
    return {
      id: pote.id as string,
      nome: pote.nome as string,
      valor: pote.valor as number,
      ...(typeof pote.rendimentoMensal === 'number' ? { rendimentoMensal: pote.rendimentoMensal } : {}),
    };
  });
}

function guardadosToDb(guardados: GuardadoNaMeta[] | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  // DbNull (NULL na coluna), não JsonNull (o valor JSON `null`): "não respondeu" é coluna vazia
  if (guardados === undefined) return Prisma.DbNull;
  return guardados.map((pote) => ({
    id: pote.id,
    nome: pote.nome,
    valor: pote.valor,
    ...(pote.rendimentoMensal !== undefined ? { rendimentoMensal: pote.rendimentoMensal } : {}),
  }));
}

/*
  A meta mora em quatro colunas do perfil (meta_tipo, meta_nome, meta_valor_alvo
  e meta_guardados) e vira UM objeto no domínio e na API. São gravadas juntas:
  tipo ou valor faltando é linha pela metade — defeito, não meta. Ignorar em vez
  de explodir mantém o GET do perfil inteiro funcionando pra pessoa. Sem meta,
  potes que sobrassem na coluna também são ignorados: vivem dentro da meta.
*/
function metaToDomain(row: ProfileRow): Meta | undefined {
  if (row.metaTipo === null || row.metaValorAlvo === null) return undefined;
  const guardados = guardadosToDomain(row.metaGuardados);
  return {
    tipo: metaTipoToDomain(row.metaTipo),
    ...(row.metaNome !== null ? { nome: row.metaNome } : {}),
    valorAlvo: decimalToNumber(row.metaValorAlvo),
    ...(guardados !== undefined ? { guardados } : {}),
  };
}

export function toDomain(row: ProfileRow): Perfil {
  const meta = metaToDomain(row);
  return Perfil.restaurar({
    subscriberId: row.subscriberId,
    rendaMensal: decimalToNumber(row.rendaMensal),
    ...(row.rendaInformada !== null ? { rendaInformada: rendaInformadaToDomain(row.rendaInformada) } : {}),
    ...(row.salarioBruto !== null ? { salarioBruto: decimalToNumber(row.salarioBruto) } : {}),
    ...(row.dependentes !== null ? { dependentes: row.dependentes } : {}),
    ...(row.competenciaTabela !== null ? { competenciaTabela: row.competenciaTabela } : {}),
    ...(row.ritmo !== null ? { ritmo: ritmoToDomain(row.ritmo) } : {}),
    ...(row.aporteEscolhido !== null ? { aporteEscolhido: decimalToNumber(row.aporteEscolhido) } : {}),
    ...(meta !== undefined ? { meta } : {}),
    tipoRenda: tipoRendaToDomain(row.tipoRenda),
    idade: row.idade,
    moradia: moradiaToDomain(row.moradia),
    custoMoradia: decimalToNumber(row.custoMoradia),
    guardado: decimalToNumber(row.guardado),
    atualizadoEm: row.atualizadoEm,
  });
}

export function toPersistence(perfil: Perfil) {
  const p = perfil.toSnapshot();
  const meta = p.meta;
  return {
    subscriberId: p.subscriberId,
    rendaMensal: numberToDecimal(p.rendaMensal),
    // null explícito (e não a chave ausente): no UPDATE do upsert é o que APAGA
    // a coluna quando a pessoa tira o ritmo ou a meta num PUT
    rendaInformada: p.rendaInformada !== undefined ? rendaInformadaToDb(p.rendaInformada) : null,
    salarioBruto: numberToDecimal(p.salarioBruto ?? null),
    dependentes: p.dependentes ?? null,
    competenciaTabela: p.competenciaTabela ?? null,
    ritmo: p.ritmo !== undefined ? ritmoToDb(p.ritmo) : null,
    aporteEscolhido: p.aporteEscolhido !== undefined ? numberToDecimal(p.aporteEscolhido) : null,
    metaTipo: meta !== undefined ? metaTipoToDb(meta.tipo) : null,
    metaNome: meta?.nome ?? null,
    metaValorAlvo: meta !== undefined ? numberToDecimal(meta.valorAlvo) : null,
    // sem meta, sem potes: trocar ou tirar a meta leva os guardados junto
    metaGuardados: guardadosToDb(meta?.guardados),
    tipoRenda: tipoRendaToDb(p.tipoRenda),
    idade: p.idade,
    moradia: moradiaToDb(p.moradia),
    custoMoradia: numberToDecimal(p.custoMoradia),
    guardado: numberToDecimal(p.guardado),
    // explícito: sem ele o @updatedAt do Prisma gravaria a hora do servidor, e a memória a do Clock
    atualizadoEm: p.atualizadoEm,
  };
}
