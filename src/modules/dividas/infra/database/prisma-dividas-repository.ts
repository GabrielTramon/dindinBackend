import { BusinessRuleError, ConflictError } from '../../../../shared/domain/errors';
import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isForeignKeyViolation, isUniqueViolation } from '../../../../shared/infra/database/prisma-errors';
import type { Divida } from '../../domain/divida';
import type { DividasRepository } from '../../domain/dividas-repository';
import { toDomain, toPersistence } from './divida.mapper';

const SEM_PERFIL = 'Crie seu perfil antes de adicionar dívidas.';
const ID_EM_USO = 'Não deu pra salvar a dívida. Recarregue a página e tente de novo.';

/**
 * FK de profile_id → o perfil não existe; chave primária → o id já é de outra dívida.
 * Chamada FORA da transação (ou relançando): o erro nunca é engolido com a transação abortada.
 */
function traduzirErro(error: unknown): unknown {
  if (isForeignKeyViolation(error)) return new BusinessRuleError(SEM_PERFIL);
  if (isUniqueViolation(error)) return new ConflictError(ID_EM_USO);
  return error;
}

export class PrismaDividasRepository implements DividasRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async listBySubscriber(subscriberId: string): Promise<Divida[]> {
    const rows = await this.db.client.divida.findMany({
      where: { profileId: subscriberId },
      // depois de um replaceAll todas têm o mesmo criadoEm: o id desempata de forma estável
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findById(id: string, subscriberId: string): Promise<Divida | null> {
    const row = await this.db.client.divida.findFirst({ where: { id, profileId: subscriberId } });
    return row ? toDomain(row) : null;
  }

  countBySubscriber(subscriberId: string): Promise<number> {
    return this.db.client.divida.count({ where: { profileId: subscriberId } });
  }

  async save(divida: Divida): Promise<void> {
    const { id, profileId, ...campos } = toPersistence(divida);
    try {
      // Não é upsert por id: o UPDATE filtra pelo dono, então um id de outra pessoa nunca
      // é sobrescrito — cai no INSERT e bate na chave primária (ConflictError).
      const { count } = await this.db.client.divida.updateMany({ where: { id, profileId }, data: campos });
      if (count === 0) await this.db.client.divida.create({ data: { id, profileId, ...campos } });
    } catch (error) {
      throw traduzirErro(error);
    }
  }

  async delete(id: string, subscriberId: string): Promise<void> {
    // deleteMany: escopado pelo dono e sem erro quando não há linha (idempotente)
    await this.db.client.divida.deleteMany({ where: { id, profileId: subscriberId } });
  }

  async replaceAll(subscriberId: string, dividas: Divida[]): Promise<void> {
    const linhas = dividas.map(toPersistence);
    if (linhas.some((l) => l.profileId !== subscriberId)) {
      throw new Error(`replaceAll(${subscriberId}) recebeu dívida de outro subscriber`);
    }

    try {
      await this.db.transaction(async () => {
        const client = this.db.client;
        // Trava a linha do perfil antes do DELETE: sem isso, em READ COMMITTED, dois replaceAll
        // simultâneos somam as listas (o DELETE do segundo não enxerga o INSERT do primeiro).
        // Perfil inexistente não trava nada; o INSERT abaixo cai na FK.
        await client.$queryRaw`SELECT 1 FROM profiles WHERE subscriber_id = ${subscriberId} FOR NO KEY UPDATE`;
        await client.divida.deleteMany({ where: { profileId: subscriberId } });
        if (linhas.length > 0) await client.divida.createMany({ data: linhas });
      });
    } catch (error) {
      // a transação já foi desfeita (ou a de fora vai ser, porque o erro sobe): só traduz
      throw traduzirErro(error);
    }
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    await this.db.client.divida.deleteMany({ where: { profileId: subscriberId } });
  }
}
