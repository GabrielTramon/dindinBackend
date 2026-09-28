import { z } from 'zod';
import { hasAtMostDecimals } from '../../../../shared/domain/guards';
import { commonSchemas } from '../../../../shared/infra/http/validation';
import { arredondar } from '../../../../shared/motor/format';
import {
  CASAS_RENDIMENTO,
  MAX_GRUPOS,
  MAX_ITENS_POR_GRUPO,
  MAX_RENDIMENTO_MENSAL,
  TAMANHO_MAXIMO_NOME,
} from '../../domain/grupo';

/*
  Formato da entrada HTTP: tipos, tetos e quantidades. A regra que precisa
  enxergar a árvore inteira (id repetido, um só grupo do sistema, soma dos itens
  dentro do valor do grupo) é do domínio, e a base — o excedente — não é
  validada em lugar nenhum do servidor: ela vem do plano e muda a cada
  recálculo. Chave extra no corpo (subscriberId, ordem, criadoEm) é descartada.

  O nome é aparado ANTES do teto, como `normalizeName` faz no domínio: " Casa "
  com 40 caracteres úteis não pode responder 400 por causa dos espaços.
*/

const nome = z
  .string({ error: 'Dê um nome pro grupo' })
  .trim()
  .max(TAMANHO_MAXIMO_NOME, { error: `No máximo ${TAMANHO_MAXIMO_NOME} caracteres` });

// nome de componente do lucide-react; o catálogo fechado é do cliente (ver domain/grupo.ts)
const icone = z
  .string({ error: 'Ícone inválido' })
  .trim()
  .max(TAMANHO_MAXIMO_NOME, { error: 'Ícone inválido' })
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, { error: 'Ícone inválido' })
  .optional();

const rendimentoMensal = z
  .number({ error: 'Informe o rendimento ao mês (0,8% = 0.008)' })
  .min(0, { error: 'O rendimento não pode ser negativo' })
  // `arredondar` na porcentagem: 0,07 × 100 dá 7.000000000000001 em ponto flutuante,
  // e a mensagem da tela não pode nascer com 15 casas se o teto mudar um dia
  .max(MAX_RENDIMENTO_MENSAL, { error: `O rendimento vai até ${arredondar(MAX_RENDIMENTO_MENSAL * 100)}% ao mês` })
  .refine((valor) => hasAtMostDecimals(valor, CASAS_RENDIMENTO), {
    error: `No máximo ${CASAS_RENDIMENTO} casas decimais`,
  })
  // null é "não rende": formulário vazio costuma mandar null, e o domínio só conhece undefined
  .nullish();

const itemBody = z.object({
  id: commonSchemas.id,
  nome,
  valor: commonSchemas.moneyOrZero,
});

const grupoBody = z.object({
  id: commonSchemas.id,
  nome,
  icone,
  valor: commonSchemas.moneyOrZero,
  contaParaMeta: z.boolean({ error: 'Responda se este grupo conta pra meta' }).optional(),
  rendimentoMensal,
  doSistema: z.boolean().optional(),
  itens: z
    .array(itemBody)
    .max(MAX_ITENS_POR_GRUPO, { error: `No máximo ${MAX_ITENS_POR_GRUPO} itens por grupo` })
    .optional(),
});

export const salvarOrganizacaoBody = z.object({
  grupos: z
    .array(grupoBody, { error: 'Mande a lista de grupos' })
    .max(MAX_GRUPOS, { error: `No máximo ${MAX_GRUPOS} grupos — o "Guardar" conta` }),
});

export type SalvarOrganizacaoBody = z.infer<typeof salvarOrganizacaoBody>;
