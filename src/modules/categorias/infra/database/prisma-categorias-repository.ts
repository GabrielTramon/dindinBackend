import { ConflictError } from '../../../../shared/domain/errors';
import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isForeignKeyViolation, isRecordNotFound, isUniqueViolation } from '../../../../shared/infra/database/prisma-errors';
import type { Categoria } from '../../domain/categoria';
import type { CategoriasRepository } from '../../domain/categorias-repository';
import { toDomain, toPersistence } from './categoria.mapper';

export class PrismaCategoriasRepository implements CategoriasRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async listVisible(subscriberId: string | null): Promise<Categoria[]> {
    const rows = await this.db.client.categoriaGastoFixo.findMany({
      where: subscriberId === null ? { subscriberId: null } : { OR: [{ subscriberId: null }, { subscriberId }] },
      // enum do Postgres ordena pela ordem de declaração: MORADIA, CASA, … OUTROS
      orderBy: [{ grupo: 'asc' }, { ordem: 'asc' }, { nome: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<Categoria | null> {
    const row = await this.db.client.categoriaGastoFixo.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Categoria | null> {
    const row = await this.db.client.categoriaGastoFixo.findUnique({ where: { slug } });
    return row ? toDomain(row) : null;
  }

  async findCustomByName(subscriberId: string, nome: string): Promise<Categoria | null> {
    // NÃO use `equals` + `mode: 'insensitive'`: o Prisma gera ILIKE sem escapar
    // curinga, e "C%" casava com "Clube" (provado contra Postgres). São no máximo
    // MAX_CATEGORIAS_PERSONALIZADAS linhas: comparar aqui é barato e igual à memória.
    const chave = nome.toLocaleLowerCase('pt-BR');
    const rows = await this.db.client.categoriaGastoFixo.findMany({ where: { subscriberId } });
    const row = rows.find((r) => r.nome.toLocaleLowerCase('pt-BR') === chave);
    return row ? toDomain(row) : null;
  }

  countCustom(subscriberId: string): Promise<number> {
    return this.db.client.categoriaGastoFixo.count({ where: { subscriberId } });
  }

  async isInUse(id: string): Promise<boolean> {
    const gasto = await this.db.client.gastoFixo.findFirst({ where: { categoriaId: id }, select: { id: true } });
    return gasto !== null;
  }

  async save(categoria: Categoria): Promise<void> {
    const { id, ...data } = toPersistence(categoria);
    try {
      await this.db.client.categoriaGastoFixo.upsert({ where: { id }, create: { id, ...data }, update: data });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Você já tem uma categoria com esse nome.', { nome: 'Nome já usado' });
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.client.categoriaGastoFixo.delete({ where: { id } });
    } catch (error) {
      if (isRecordNotFound(error)) return;
      if (isForeignKeyViolation(error)) {
        throw new ConflictError('Essa categoria tem gastos. Remova os gastos dela antes de excluir.');
      }
      throw error;
    }
  }

  async deleteAllCustom(subscriberId: string): Promise<void> {
    try {
      await this.db.client.categoriaGastoFixo.deleteMany({ where: { subscriberId } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictError('Essa categoria tem gastos. Remova os gastos dela antes de excluir.');
      }
      throw error;
    }
  }
}
