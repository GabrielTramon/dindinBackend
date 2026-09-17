import { InMemoryMetasRepository } from './in-memory-metas-repository';
import { describeMetasRepositoryContract } from './metas-repository.contract';

describeMetasRepositoryContract('em memória', async () => {
  let subscribers = 0;
  return {
    repo: new InMemoryMetasRepository(),
    criarSubscriber: async () => `sub-${++subscribers}`,
  };
});
