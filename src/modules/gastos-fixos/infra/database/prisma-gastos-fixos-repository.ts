import type { Prisma } from '../../../../generated/prisma/client';
import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isForeignKeyViolation, isUniqueViolation } from '../../../../shared/infra/database/prisma-errors';
import type { GastoFixo } from '../../domain/gasto-fixo';
import type { GastosFixosRepository } from '../../domain/gastos-fixos-repository';
import { toDomain, toPersistence } from './gasto-fixo.mapper';
import {
  categoriaInexistente,
  garantirMesmoDono,
  gastoRepetido,
  perfilInexistente,
} from './gastos-fixos-repository-errors';

/*
  gastos_fixos tem duas FKs, e cada uma vira um erro diferente pra tela. O
  código P2003 é o mesmo pras duas: quem diz qual foi é o nome da constraint,
  que com o driver adapter chega em meta.driverAdapterError.cause.constraint
  e também na mensagem ("violated on the constraint: `gastos_fixos_categoria_id_fkey`").
*/
const FK_DA_CATEGORIA = 'gastos_fixos_categoria_id_fkey';

const ORDEM: Prisma.GastoFixoOrderByWithRelationInput[] = [{ valor: 'desc' }, { criadoEm: 'asc' }, { id: 'asc' }];

/** só depois de isForeignKeyViolation, que já conferiu o tipo do erro */
function violouFkDaCategoria(error: unknown): boolean {
  const { message, meta } = error as Prisma.PrismaClientKnownRequestError;
  return `${message} ${JSON.stringify(meta ?? {})}`.includes(FK_DA_CATEGORIA);
}

function traduzirViolacao(error: unknown): unknown {
  if (isUniqueViolation(error)) return gastoRepetido();
  if (isForeignKeyViolation(error)) return violouFkDaCategoria(error) ? categoriaInexistente() : perfilInexistente();
  return error;
}

export class PrismaGastosFixosRepository implements GastosFixosRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async listBySubscriber(subscriberId: string): Promise<GastoFixo[]> {
    const rows = await this.db.client.gastoFixo.findMany({ where: { profileId: subscriberId }, orderBy: ORDEM });
    return rows.map(toDomain);
  }

  async findById(id: string, subscriberId: string): Promise<GastoFixo | null> {
    const row = await this.db.client.gastoFixo.findFirst({ where: { id, profileId: subscriberId } });
    return row ? toDomain(row) : null;
  }

  countBySubscriber(subscriberId: string): Promise<number> {
    return this.db.client.gastoFixo.count({ where: { profileId: subscriberId } });
  }

  async existsInCategory(subscriberId: string, categoriaId: string, ignoreId?: string): Promise<boolean> {
    const gasto = await this.db.client.gastoFixo.findFirst({
      where: { profileId: subscriberId, categoriaId, ...(ignoreId !== undefined ? { id: { not: ignoreId } } : {}) },
      select: { id: true },
    });
    return gasto !== null;
  }

  async existsForCategory(categoriaId: string): Promise<boolean> {
    const gasto = await this.db.client.gastoFixo.findFirst({ where: { categoriaId }, select: { id: true } });
    return gasto !== null;
  }

  async save(gasto: GastoFixo): Promise<void> {
    const { id, ...data } = toPersistence(gasto);
    try {
      // Update escopado pelo dono; sem linha dele, insere. Com o id de um gasto de outra pessoa o
      // update não acha nada e o insert bate na chave primária: nunca transfere o gasto de dono.
      // Não é upsert: com filtro extra no where ele vira ON CONFLICT DO UPDATE ... WHERE, que
      // ignora o conflito calado (provado no contrato).
      const { count } = await this.db.client.gastoFixo.updateMany({ where: { id, profileId: data.profileId }, data });
      if (count === 0) await this.db.client.gastoFixo.create({ data: { id, ...data } });
    } catch (error) {
      throw traduzirViolacao(error);
    }
  }

  async delete(id: string, subscriberId: string): Promise<void> {
    // deleteMany com o dono no filtro: id alheio não apaga nada e id inexistente não lança P2025
    await this.db.client.gastoFixo.deleteMany({ where: { id, profileId: subscriberId } });
  }

  async replaceAll(subscriberId: string, gastos: GastoFixo[]): Promise<void> {
    garantirMesmoDono(subscriberId, gastos);
    const data = gastos.map(toPersistence);

    try {
      await this.db.transaction(async () => {
        const client = this.db.client;
        // Trava a linha do perfil ANTES do delete. Sem ela, em READ COMMITTED, dois replaceAll
        // simultâneos (duas abas, retry) somam as listas ou batem no unique de categoria: o DELETE
        // do segundo não enxerga o que o primeiro inseriu. PGlite (uma sessão) não reproduz a corrida.
        await client.$queryRaw`SELECT 1 FROM profiles WHERE subscriber_id = ${subscriberId} FOR NO KEY UPDATE`;
        await client.gastoFixo.deleteMany({ where: { profileId: subscriberId } });
        if (data.length > 0) await client.gastoFixo.createMany({ data });
      });
    } catch (error) {
      // a transação já foi desfeita (ou a de fora vai ser, com este erro): só traduz, nunca segue
      throw traduzirViolacao(error);
    }
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    await this.db.client.gastoFixo.deleteMany({ where: { profileId: subscriberId } });
  }
}
