import { ConflictError } from '../../../../shared/domain/errors';
import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isUniqueViolation } from '../../../../shared/infra/database/prisma-errors';
import type { Meta } from '../../domain/meta';
import type { MetasRepository } from '../../domain/metas-repository';
import { toDomain, toPersistence } from './meta.mapper';

export class PrismaMetasRepository implements MetasRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async listBySubscriber(subscriberId: string): Promise<Meta[]> {
    const rows = await this.db.client.goal.findMany({
      where: { subscriberId },
      // id desempata metas criadas no mesmo milissegundo; a versão em memória ordena igual
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toDomain);
  }

  async findById(id: string, subscriberId: string): Promise<Meta | null> {
    const row = await this.db.client.goal.findFirst({ where: { id, subscriberId } });
    return row ? toDomain(row) : null;
  }

  async findByPublicSlug(slug: string): Promise<Meta | null> {
    const row = await this.db.client.goal.findUnique({ where: { publicSlug: slug } });
    return row ? toDomain(row) : null;
  }

  async isPublicSlugTaken(slug: string): Promise<boolean> {
    const row = await this.db.client.goal.findUnique({ where: { publicSlug: slug }, select: { id: true } });
    return row !== null;
  }

  countBySubscriber(subscriberId: string): Promise<number> {
    return this.db.client.goal.count({ where: { subscriberId } });
  }

  async save(meta: Meta): Promise<void> {
    const { id, ...data } = toPersistence(meta);
    try {
      await this.db.client.goal.upsert({ where: { id }, create: { id, ...data }, update: data });
    } catch (error) {
      // o único unique da tabela além da chave é public_slug
      if (isUniqueViolation(error)) {
        throw new ConflictError('Esse endereço público já está em uso.', { publicSlug: 'Endereço já usado' });
      }
      throw error;
    }
  }

  async delete(id: string, subscriberId: string): Promise<void> {
    // deleteMany com o dono no filtro: de outra pessoa ou inexistente apaga 0 linhas, sem erro
    await this.db.client.goal.deleteMany({ where: { id, subscriberId } });
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    await this.db.client.goal.deleteMany({ where: { subscriberId } });
  }
}
