import { z } from 'zod';
import { commonSchemas } from '../../../../shared/infra/http/validation';

/*
  Formato da entrada HTTP. O teto do valor aqui é o do banco; o limite do
  produto (o mesmo do onboarding) e a existência da categoria são regra do
  domínio e do caso de uso. Chave extra no corpo (subscriberId, id) é descartada.
*/

export const gastoFixoParams = z.object({ id: commonSchemas.id });

export const adicionarGastoFixoBody = z.object({
  categoriaId: commonSchemas.id,
  valor: commonSchemas.money,
});

export const alterarGastoFixoBody = z.object({
  valor: commonSchemas.money,
});
