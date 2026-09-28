import { describeGruposRepositoryContract } from './grupos-repository.contract';
import { InMemoryGruposRepository } from './in-memory-grupos-repository';

describeGruposRepositoryContract('em memória', async () => {
  const repo = new InMemoryGruposRepository();
  let subscribers = 0;
  return {
    repo,
    criarSubscriber: async () => `sub-${++subscribers}`,
  };
});
