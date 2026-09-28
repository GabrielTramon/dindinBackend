import type { SessaoAberta } from '../../application/sessao-aberta';
import type { Subscriber } from '../../domain/subscriber';

/*
  A conta como o cliente vê. Nunca sai: hash da senha, hash do token, validade
  do link nem atualizadoEm — os dois primeiros são segredo, os outros não servem
  pra tela. Da senha, só `temSenha` (a página da conta decide entre "Trocar
  senha" e "Criar senha").
*/

export function presentSubscriber(subscriber: Subscriber) {
  return {
    id: subscriber.id,
    email: subscriber.email,
    emailVerificadoEm: subscriber.emailVerificadoEm?.toISOString() ?? null,
    ativo: subscriber.ativo,
    temSenha: subscriber.temSenha,
    criadoEm: subscriber.criadoEm.toISOString(),
  };
}

export function presentSessao({ subscriber, sessao }: SessaoAberta) {
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
