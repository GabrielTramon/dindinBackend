import { z } from 'zod';
import { commonSchemas } from '../../../../shared/infra/http/validation';
import { PRAZO_MAXIMO_MESES } from '../../domain/meta';

/*
  Formato da entrada HTTP. Tamanho do nome, "aporte OU prazo" e o que mais for
  regra de negócio fica na entidade Meta; aqui só tipos, tetos e o formato
  do dinheiro. Chave desconhecida no corpo (subscriberId, publicSlug) é descartada.
*/

export const metaParams = z.object({ id: commonSchemas.id });

const SLUG_INVALIDO = 'Endereço público inválido';

/** Formato largo de propósito: slug bem formado que não existe responde 404, não 400. */
export const metaPublicaParams = z.object({
  slug: z
    .string({ error: SLUG_INVALIDO })
    .max(50, { error: SLUG_INVALIDO })
    .regex(/^[a-z0-9-]+$/, { error: SLUG_INVALIDO }),
});

const nome = z.string({ error: 'Dê um nome pra meta' }).max(200, { error: 'Nome longo demais' });

const prazoMeses = z
  .number({ error: 'Informe o prazo em meses' })
  .int({ error: 'O prazo é um número inteiro de meses' })
  .min(1, { error: `O prazo vai de 1 a ${PRAZO_MAXIMO_MESES} meses` })
  .max(PRAZO_MAXIMO_MESES, { error: `O prazo vai de 1 a ${PRAZO_MAXIMO_MESES} meses` });

export const criarMetaBody = z.object({
  nome,
  valorAlvo: commonSchemas.money,
  // null aceito como "não informado": formulário vazio costuma mandar null
  aporteMensal: commonSchemas.money.nullable().optional(),
  prazoMeses: prazoMeses.nullable().optional(),
  acumulado: commonSchemas.moneyOrZero.optional(),
});

export const atualizarMetaBody = z
  .object({
    nome: nome.optional(),
    valorAlvo: commonSchemas.money.optional(),
    // null limpa o campo: é assim que se troca de aporte pra prazo e vice-versa
    aporteMensal: commonSchemas.money.nullable().optional(),
    prazoMeses: prazoMeses.nullable().optional(),
    acumulado: commonSchemas.moneyOrZero.optional(),
  })
  .refine((corpo) => Object.values(corpo).some((valor) => valor !== undefined), {
    error: 'Mande pelo menos um campo pra alterar',
  });
