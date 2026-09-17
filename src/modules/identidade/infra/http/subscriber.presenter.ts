import type { IssuedToken } from '../../../../shared/application/ports';
import type { Subscriber } from '../../domain/subscriber';

/*
  A conta como o cliente vê. Nunca sai: hash do token, validade do link nem
  atualizadoEm — o primeiro é segredo, os outros não servem pra tela.
*/

export function presentSubscriber(subscriber: Subscriber) {
  return {
    id: subscriber.id,
    email: subscriber.email,
    emailVerificadoEm: subscriber.emailVerificadoEm?.toISOString() ?? null,
    ativo: subscriber.ativo,
    criadoEm: subscriber.criadoEm.toISOString(),
  };
}

export function presentSessao({ subscriber, sessao }: { subscriber: Subscriber; sessao: IssuedToken }) {
  return {
    accessToken: sessao.token,
    expiresAt: sessao.expiresAt.toISOString(),
    subscriber: {
      id: subscriber.id,
      email: subscriber.email,
      emailVerificadoEm: subscriber.emailVerificadoEm?.toISOString() ?? null,
      ativo: subscriber.ativo,
    },
  };
}

export type SubscriberResponse = ReturnType<typeof presentSubscriber>;
export type SessaoResponse = ReturnType<typeof presentSessao>;
