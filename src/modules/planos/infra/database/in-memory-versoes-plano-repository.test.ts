import { InMemoryVersoesPlanoRepository } from './in-memory-versoes-plano-repository';
import { describeVersoesPlanoRepositoryContract } from './versoes-plano-repository.contract';

describeVersoesPlanoRepositoryContract('em memória', async () => {
  const repo = new InMemoryVersoesPlanoRepository();
  let subscribers = 0;
  return {
    repo,
    criarSubscriber: async () => `sub-${++subscribers}`,
  };
});
