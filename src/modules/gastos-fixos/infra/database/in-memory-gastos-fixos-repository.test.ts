import { CATEGORIAS } from '../../../../shared/motor/categorias';
import { describeGastosFixosRepositoryContract } from './gastos-fixos-repository.contract';
import { InMemoryGastosFixosRepository } from './in-memory-gastos-fixos-repository';

describeGastosFixosRepositoryContract('em memória', async () => {
  const perfis = new Set<string>();
  // as FKs emuladas precisam de um "banco" de categorias: o catálogo do motor + as personalizadas criadas no teste
  const categorias = new Set(CATEGORIAS.map((c) => `categoria-${c.slug}`));
  const repo = new InMemoryGastosFixosRepository({
    perfilExists: async (subscriberId) => perfis.has(subscriberId),
    categoriaExists: async (categoriaId) => categorias.has(categoriaId),
  });
  let sequencia = 0;
  return {
    repo,
    criarPerfil: async () => {
      const subscriberId = `sub-${++sequencia}`;
      perfis.add(subscriberId);
      return subscriberId;
    },
    criarSubscriberSemPerfil: async () => `sub-${++sequencia}`,
    idDoCatalogo: async (slug) => `categoria-${slug}`,
    criarCategoriaPersonalizada: async (subscriberId) => {
      const id = `categoria-${subscriberId}-${++sequencia}`;
      categorias.add(id);
      return id;
    },
  };
});
