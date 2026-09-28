import { InMemoryDividasRepository } from './in-memory-dividas-repository';
import { describeDividasRepositoryContract } from './dividas-repository.contract';

describeDividasRepositoryContract('em memória', async () => {
  const perfis = new Set<string>();
  const repo = new InMemoryDividasRepository({ perfilExists: async (id) => perfis.has(id) });
  let subscribers = 0;
  return {
    repo,
    criarPerfil: async () => {
      const id = `sub-${++subscribers}`;
      perfis.add(id);
      return id;
    },
    criarSubscriberSemPerfil: async () => `sub-${++subscribers}`,
  };
});
