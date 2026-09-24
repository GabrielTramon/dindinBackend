import { z } from 'zod';
import { hasAtMostDecimals } from '../../../../shared/domain/guards';
import { commonSchemas } from '../../../../shared/infra/http/validation';
import { perfilSchema } from '../../../../shared/motor/schema';
import { travaDaParcela } from '../../../../shared/infra/http/trava-da-parcela';
import { MAX_VERSAO } from '../../domain/versao-plano';

/*
  Formato da entrada HTTP dos planos.
*/

const VERSAO_INVALIDA = 'Versão inválida';

/**
 * Só dígitos: z.coerce aceitaria " 1", "1e2" e "0x10". O teto é o INTEGER do
 * banco — acima dele a consulta estouraria em vez de responder 404.
 */
export const versaoParams = z.object({
  versao: z
    .string({ error: VERSAO_INVALIDA })
    .regex(/^\d{1,10}$/, { error: VERSAO_INVALIDA })
    .transform(Number)
    .pipe(z.number().int().min(1, { error: VERSAO_INVALIDA }).max(MAX_VERSAO, { error: VERSAO_INVALIDA })),
});

export const listarVersoesQuery = commonSchemas.pagination;

/**
 * O corpo da simulação é o perfil no formato do motor, validado com o MESMO
 * perfilSchema do frontend: mesmos limites, mesmas mensagens e as mesmas
 * chaves de erro ("gastosFixos.0.valor"). Chaves desconhecidas são descartadas.
 *
 * Por cima, a regra de produto do dinheiro: no máximo 2 casas (taxa: 4). O
 * motor não limita, mas o perfil salvo limita — uma simulação com R$ 10,005
 * mostraria um plano que a pessoa não consegue salvar depois.
 */
export const simularBody = perfilSchema.superRefine((perfil, ctx) => {
  // parcela maior que o saldo: recusada como no onboarding
  travaDaParcela(perfil, ctx);
  const casas = (valor: number | undefined, path: (string | number)[], maximo = 2) => {
    if (valor !== undefined && !hasAtMostDecimals(valor, maximo)) {
      ctx.addIssue({ code: 'custom', message: `No máximo ${maximo} casas decimais`, path });
    }
  };
  casas(perfil.rendaMensal, ['rendaMensal']);
  casas(perfil.custoMoradia, ['custoMoradia']);
  casas(perfil.guardado, ['guardado']);
  perfil.gastosFixos.forEach((g, i) => casas(g.valor, ['gastosFixos', i, 'valor']));
  perfil.dividas.forEach((d, i) => {
    casas(d.saldo, ['dividas', i, 'saldo']);
    casas(d.parcela, ['dividas', i, 'parcela']);
    casas(d.taxaAnual, ['dividas', i, 'taxaAnual'], 4);
  });
});
