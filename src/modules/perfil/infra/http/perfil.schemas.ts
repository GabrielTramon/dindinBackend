import { z } from 'zod';
import { commonSchemas } from '../../../../shared/infra/http/validation';
import { travaDaParcela } from '../../../../shared/infra/http/trava-da-parcela';
import { metaSchema, MORADIAS, perfilSchema, RENDAS_INFORMADAS, RITMOS, TIPOS_RENDA } from '../../../../shared/motor/schema';

/*
  Formato da entrada HTTP. Tipos e tetos de banco aqui; os limites do produto
  (idade de 14 a 100, renda até 1 milhão, moradia sem custo, meta "outro" sem
  nome) são do domínio (Perfil), com as mensagens do onboarding. Enums em
  minúsculo, como o frontend manda. Chave extra no corpo (subscriberId) é
  descartada.

  As listas abaixo são escritas à mão de propósito (não derivadas do
  perfilSchema): é o que deixa o PUT/PATCH aceitar exatamente o que o módulo
  sabe gravar. O preço é que campo novo some daqui sem erro de compilação —
  todos são opcionais —, então campo novo do perfil entra NAS DUAS listas no
  mesmo commit.
*/

const tipoRenda = z.enum(TIPOS_RENDA, { error: 'Escolha como é a sua renda' });
const moradia = z.enum(MORADIAS, { error: 'Escolha onde você mora' });
const idade = z.number({ error: 'Informe sua idade' });
const rendaInformada = z.enum(RENDAS_INFORMADAS, { error: 'Escolha se o valor é o bruto ou o que cai na conta' });
const ritmo = z.enum(RITMOS, { error: 'Escolha o ritmo' });
const dependentes = z.number({ error: 'Informe quantos dependentes você tem' });
/** "2026-01" — a competência da tabela de folha que gerou o líquido */
const competenciaTabela = z
  .string({ error: 'Informe a competência da tabela' })
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Competência no formato AAAA-MM' });

export const salvarPerfilBody = z.object({
  rendaMensal: commonSchemas.money,
  rendaInformada: rendaInformada.optional(),
  salarioBruto: commonSchemas.money.optional(),
  dependentes: dependentes.optional(),
  competenciaTabela: competenciaTabela.optional(),
  ritmo: ritmo.optional(),
  aporteEscolhido: commonSchemas.moneyOrZero.optional(),
  // o mesmo objeto do onboarding; "outro" sem nome já é recusado aqui
  meta: metaSchema.optional(),
  tipoRenda,
  idade,
  moradia,
  custoMoradia: commonSchemas.moneyOrZero,
  guardado: commonSchemas.moneyOrZero,
});

/** ausente não mexe; precisa de pelo menos um campo */
export const atualizarPerfilBody = z
  .object({
    rendaMensal: commonSchemas.money.optional(),
    rendaInformada: rendaInformada.optional(),
    salarioBruto: commonSchemas.money.optional(),
    dependentes: dependentes.optional(),
    competenciaTabela: competenciaTabela.optional(),
    ritmo: ritmo.optional(),
    aporteEscolhido: commonSchemas.moneyOrZero.optional(),
    meta: metaSchema.optional(),
    tipoRenda: tipoRenda.optional(),
    idade: idade.optional(),
    moradia: moradia.optional(),
    custoMoradia: commonSchemas.moneyOrZero.optional(),
    guardado: commonSchemas.moneyOrZero.optional(),
  })
  .refine((body) => Object.values(body).some((valor) => valor !== undefined), {
    error: 'Informe pelo menos um campo pra alterar',
  });

/** O perfil completo é validado com o schema do motor (o mesmo do onboarding do frontend) + a trava da parcela. */
export const perfilCompletoBody = perfilSchema.superRefine(travaDaParcela);
