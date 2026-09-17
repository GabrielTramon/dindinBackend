import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isForeignKeyViolation } from '../../../../shared/infra/database/prisma-errors';
import type { Perfil } from '../../domain/perfil';
import type { PerfisRepository } from '../../domain/perfis-repository';
import { toDomain, toPersistence } from './perfil.mapper';
import { contaInexistente } from './perfis-repository-errors';

export class PrismaPerfisRepository implements PerfisRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async findBySubscriberId(subscriberId: string): Promise<Perfil | null> {
    const row = await this.db.client.profile.findUnique({ where: { subscriberId } });
    return row ? toDomain(row) : null;
  }

  async exists(subscriberId: string): Promise<boolean> {
    const row = await this.db.client.profile.findUnique({ where: { subscriberId }, select: { subscriberId: true } });
    return row !== null;
  }

  async save(perfil: Perfil): Promise<void> {
    const { subscriberId, ...data } = toPersistence(perfil);
    try {
      // Upsert pela chave, sem filtro extra: vira INSERT ... ON CONFLICT DO UPDATE, que trava a
      // linha do perfil até o fim da transação — é o que põe PUTs simultâneos em fila.
      await this.db.client.profile.upsert({ where: { subscriberId }, create: { subscriberId, ...data }, update: data });
    } catch (error) {
      // só traduz e relança: dentro de uma transação, seguir depois do erro não é opção
      if (isForeignKeyViolation(error)) throw contaInexistente();
      throw error;
    }
  }

  async delete(subscriberId: string): Promise<void> {
    // deleteMany: inexistente apaga 0 linhas, sem P2025; gastos e dívidas saem por cascade
    await this.db.client.profile.deleteMany({ where: { subscriberId } });
  }
}
