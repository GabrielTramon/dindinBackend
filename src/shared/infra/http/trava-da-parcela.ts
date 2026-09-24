import type { z } from 'zod';
import { dividaSchema } from '../../motor/schema';

/**
 * A trava parcela × saldo da dívida DIGITADA (dividaSchema do motor), para
 * quem valida um perfil inteiro com o perfilSchema (PUT /perfil/completo,
 * POST /planos/simular).
 *
 * O perfilSchema não tem mais a trava: no frontend ele valida o perfil já
 * salvo, e um plano antigo com a parcela maior que o saldo não pode sumir no
 * F5. O que chega na API é sempre resposta nova, então aqui ela continua.
 * Os campos já passaram pelo perfilSchema; o que sobra é a trava.
 */
export function travaDaParcela(perfil: { dividas: readonly unknown[] }, ctx: z.RefinementCtx): void {
  perfil.dividas.forEach((divida, i) => {
    for (const issue of dividaSchema.safeParse(divida).error?.issues ?? []) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['dividas', i, ...issue.path] });
    }
  });
}
