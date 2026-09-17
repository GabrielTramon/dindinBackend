import { InMemoryCategoriasRepository } from './in-memory-categorias-repository';
import { describeCategoriasRepositoryContract } from './categorias-repository.contract';

describeCategoriasRepositoryContract('em memória', async () => {
  const emUso = new Set<string>();
  const repo = new InMemoryCategoriasRepository({ withCatalog: true, isInUse: async (id) => emUso.has(id) });
  let subscribers = 0;
  return {
    repo,
    criarSubscriber: async () => `sub-${++subscribers}`,
    colocarEmUso: async (categoriaId) => void emUso.add(categoriaId),
    idDoCatalogo: async (slug) => InMemoryCategoriasRepository.catalogId(slug),
  };
});
