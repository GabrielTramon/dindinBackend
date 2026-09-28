import { decodeIntCursor, encodeCursor, type Page, type PageRequest } from '../../../../shared/application/pagination';
import { ConflictError } from '../../../../shared/domain/errors';
import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isUniqueViolation } from '../../../../shared/infra/database/prisma-errors';
import { MAX_VERSAO, type VersaoPlano } from '../../domain/versao-plano';
import type { VersoesPlanoRepository } from '../../domain/versoes-plano-repository';
import { toDomain, toPersistence } from './versao-plano.mapper';

export class PrismaVersoesPlanoRepository implements VersoesPlanoRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async findLatest(subscriberId: string): Promise<VersaoPlano | null> {
    const row = await this.db.client.plan.findFirst({ where: { subscriberId }, orderBy: { versao: 'desc' } });
    return row ? toDomain(row) : null;
  }

  async findByVersion(subscriberId: string, versao: number): Promise<VersaoPlano | null> {
    // fora do INTEGER o Postgres recusaria a consulta (500); uma versão assim não existe
    if (!Number.isInteger(versao) || versao < 1 || versao > MAX_VERSAO) return null;
    const row = await this.db.client.plan.findUnique({ where: { subscriberId_versao: { subscriberId, versao } } });
    return row ? toDomain(row) : null;
  }

  async findEmVigorEm(subscriberId: string, ate: Date): Promise<VersaoPlano | null> {
    // versao e criadoEm são monotônicos juntos: o where filtra por data e o
    // orderBy é por versão, que é única por pessoa e não tem empate a desempatar
    const vigente = await this.db.client.plan.findFirst({
      where: { subscriberId, criadoEm: { lt: ate } },
      orderBy: { versao: 'desc' },
    });
    if (vigente) return toDomain(vigente);
    // nenhuma versão até lá (cadastro depois do mês perguntado): a mais antiga
    const primeira = await this.db.client.plan.findFirst({ where: { subscriberId }, orderBy: { versao: 'asc' } });
    return primeira ? toDomain(primeira) : null;
  }

  async list(subscriberId: string, page: PageRequest): Promise<Page<VersaoPlano>> {
    const antesDe = decodeIntCursor(page.cursor);
    const rows = await this.db.client.plan.findMany({
      // cursor acima do INTEGER (editado à mão) significa "do topo": limita pra não estourar o parâmetro
      where: { subscriberId, ...(antesDe !== undefined ? { versao: { lt: Math.min(antesDe, MAX_VERSAO) } } : {}) },
      // versão é única por pessoa: não há empate a desempatar
      orderBy: { versao: 'desc' },
      take: page.limit + 1,
    });
    const items = rows.slice(0, page.limit);
    const ultima = items.at(-1);
    return {
      items: items.map(toDomain),
      nextCursor: rows.length > page.limit && ultima ? encodeCursor(ultima.versao) : null,
    };
  }

  async nextVersion(subscriberId: string): Promise<number> {
    const { _max } = await this.db.client.plan.aggregate({ where: { subscriberId }, _max: { versao: true } });
    return (_max.versao ?? 0) + 1;
  }

  async save(versao: VersaoPlano): Promise<void> {
    // versões são imutáveis: save só insere, nunca atualiza
    try {
      await this.db.client.plan.create({ data: toPersistence(versao) });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Essa versão do plano já foi gravada.');
      throw error;
    }
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    await this.db.client.plan.deleteMany({ where: { subscriberId } });
  }
}
