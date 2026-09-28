import type { Categoria } from './categoria';

export interface CategoriasRepository {
  /**
   * Catálogo global + personalizadas do subscriber (null = só o catálogo).
   * Ordem: grupo (ORDEM_DOS_GRUPOS), depois `ordem`, depois nome.
   */
  listVisible(subscriberId: string | null): Promise<Categoria[]>;

  findById(id: string): Promise<Categoria | null>;
  findBySlug(slug: string): Promise<Categoria | null>;
  /**
   * Busca por nome sem diferenciar maiúsculas; só entre as personalizadas do subscriber.
   * Comparação literal: "%" e "_" no nome não são curingas.
   */
  findCustomByName(subscriberId: string, nome: string): Promise<Categoria | null>;
  countCustom(subscriberId: string): Promise<number>;
  isInUse(id: string): Promise<boolean>;

  /** @throws ConflictError quando a dona já tem outra categoria com esse nome */
  save(categoria: Categoria): Promise<void>;
  /** @throws ConflictError quando há gasto fixo usando a categoria */
  delete(id: string): Promise<void>;
  /**
   * Apaga as personalizadas da pessoa, todas ou nenhuma.
   * @throws ConflictError quando alguma tem gasto fixo (Restrict): apague os gastos antes
   */
  deleteAllCustom(subscriberId: string): Promise<void>;
}
