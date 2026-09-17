import { createAbrirCheckInsDoMes, type AbrirCheckInsDoMesUseCase } from '../../modules/check-ins/infra';
import type { Container } from '../container';

/*
  Os jobs, montados com as mesmas peças do container que a API usa. Quem roda
  é o CLI de cada job (main/jobs/<job>.ts, agendado fora do processo da API) —
  e o teste ponta a ponta, que chama o caso de uso direto.
*/

export interface Jobs {
  /** dia 1: abre o check-in do mês que acabou e manda o e-mail (idempotente) */
  abrirCheckIns: AbrirCheckInsDoMesUseCase;
}

export function createJobs(container: Container): Jobs {
  const { config, repositories: r, services: s } = container;
  return {
    abrirCheckIns: createAbrirCheckInsDoMes({
      checkIns: r.checkIns,
      subscribers: r.subscribers,
      mailer: s.mailer,
      authTokens: s.authTokens,
      ids: s.ids,
      clock: s.clock,
      config: { appUrl: config.appUrl },
    }),
  };
}
