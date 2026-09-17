import { z } from 'zod';
import { commonSchemas } from '../../../../shared/infra/http/validation';
import { MORADIAS, perfilSchema, TIPOS_RENDA } from '../../../../shared/motor/schema';

/*
  Formato da entrada HTTP. Tipos e tetos de banco aqui; os limites do produto
  (idade de 14 a 100, renda até 1 milhão, moradia sem custo) são do domínio
  (Perfil), com as mensagens do onboarding. Enums em minúsculo, como o
  frontend manda. Chave extra no corpo (subscriberId) é descartada.
*/

const tipoRenda = z.enum(TIPOS_RENDA, { error: 'Escolha como é a sua renda' });
const moradia = z.enum(MORADIAS, { error: 'Escolha onde você mora' });
const idade = z.number({ error: 'Informe sua idade' });

export const salvarPerfilBody = z.object({
  rendaMensal: commonSchemas.money,
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
    tipoRenda: tipoRenda.optional(),
    idade: idade.optional(),
    moradia: moradia.optional(),
    custoMoradia: commonSchemas.moneyOrZero.optional(),
    guardado: commonSchemas.moneyOrZero.optional(),
  })
  .refine((body) => Object.values(body).some((valor) => valor !== undefined), {
    error: 'Informe pelo menos um campo pra alterar',
  });

/** O perfil completo é validado com o schema do motor: o mesmo que o onboarding do frontend usa. */
export const perfilCompletoBody = perfilSchema;
