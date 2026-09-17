import { z } from 'zod';
import { commonSchemas } from '../../../../shared/infra/http/validation';
import { competenciaValida, MENSAGEM_COMPETENCIA_INVALIDA } from '../../domain/check-in';

/*
  Formato da entrada HTTP dos check-ins. Mês futuro é regra do domínio
  (CheckIn.abrir/responder dependem do relógio); aqui só o formato AAAA-MM.
*/

export const competenciaParams = z.object({
  competencia: z
    .string({ error: MENSAGEM_COMPETENCIA_INVALIDA })
    .refine(competenciaValida, { error: MENSAGEM_COMPETENCIA_INVALIDA }),
});

export const listarCheckInsQuery = commonSchemas.pagination;

/** Os três valores do mês, em reais: 0 é resposta válida (não entrou, não saiu, não sobrou). */
export const responderCheckInBody = z.object({
  rendaReal: commonSchemas.moneyOrZero,
  gastoReal: commonSchemas.moneyOrZero,
  guardadoReal: commonSchemas.moneyOrZero,
});
