import { InMemoryPerfisRepository } from './in-memory-perfis-repository';
import { describePerfisRepositoryContract } from './perfis-repository.contract';

describePerfisRepositoryContract('em memória', async () => {
  const contas = new Set<string>();
  const repo = new InMemoryPerfisRepository({ subscriberExists: async (id) => contas.has(id) });
  let subscribers = 0;
  return {
    repo,
    criarSubscriber: async () => {
      const id = `sub-${++subscribers}`;
      contas.add(id);
      return id;
    },
  };
});
