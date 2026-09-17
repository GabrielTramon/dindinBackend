import { z } from 'zod';
import { TIPOS_DIVIDA } from '../../../../shared/motor/schema';
import { commonSchemas } from '../../../../shared/infra/http/validation';

/*
  Formato da entrada HTTP. Os tetos são os do motor; as regras finas (4 casas na
  taxa, limite de saldo do motor) são do domínio (Divida). Tipos em minúsculo,
  como o frontend manda.
*/

const tipo = z.enum(TIPOS_DIVIDA, { error: 'Escolha o tipo da dívida' });

/** 0.45 = 45% ao ano */
const taxaAnual = z
  .number({ error: 'Informe a taxa anual como número (0.45 = 45% ao ano)' })
  .min(0, { error: 'A taxa não pode ser negativa' })
  .max(20, { error: 'Taxa acima de 2.000% ao ano? Confere o valor' });

export const dividaParams = z.object({ id: commonSchemas.id });

/** parcela e taxa ausentes ou null: sem parcela fixa / taxa padrão do tipo */
export const adicionarDividaBody = z.object({
  tipo,
  saldo: commonSchemas.money,
  parcela: commonSchemas.money.nullable().optional(),
  taxaAnual: taxaAnual.nullable().optional(),
});

/** ausente não mexe; null limpa parcela e taxa */
export const alterarDividaBody = z
  .object({
    tipo: tipo.optional(),
    saldo: commonSchemas.money.optional(),
    parcela: commonSchemas.money.nullable().optional(),
    taxaAnual: taxaAnual.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((valor) => valor !== undefined), {
    error: 'Informe pelo menos um campo pra alterar',
  });
