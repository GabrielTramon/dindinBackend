import type { Prisma } from '../../../../generated/prisma/client';
import type { PrismaDatabase } from '../../../../shared/infra/database/prisma';
import { isUniqueViolation } from '../../../../shared/infra/database/prisma-errors';
import { garantirMesmoDono, grupoRepetido, itemRepetido, type Grupo } from '../../domain/grupo';
import type { GruposRepository } from '../../domain/grupos-repository';
import { toDomain, toPersistence } from './grupo.mapper';

/*
  A ordem da árvore é POSICIONAL e é conteúdo: `ordem` é o índice em que o grupo
  (ou o item) chegou no PUT. O desempate por id existe porque duas linhas podem
  acabar com a mesma `ordem` se alguém gravar direto no banco — sem ele, a lista
  voltaria embaralhada e mudaria a cada leitura.
*/
const ORDEM_GRUPO: Prisma.GrupoOrderByWithRelationInput[] = [{ ordem: 'asc' }, { id: 'asc' }];
const ORDEM_ITEM: Prisma.ItemGrupoOrderByWithRelationInput[] = [{ ordem: 'asc' }, { id: 'asc' }];

export class PrismaGruposRepository implements GruposRepository {
  constructor(private readonly db: PrismaDatabase) {}

  async listBySubscriber(subscriberId: string): Promise<Grupo[]> {
    const rows = await this.db.client.grupo.findMany({
      where: { subscriberId },
      orderBy: ORDEM_GRUPO,
      include: { itens: { orderBy: ORDEM_ITEM } },
    });
    return rows.map(toDomain);
  }

  countBySubscriber(subscriberId: string): Promise<number> {
    return this.db.client.grupo.count({ where: { subscriberId } });
  }

  async replaceAll(subscriberId: string, grupos: Grupo[]): Promise<void> {
    garantirMesmoDono(subscriberId, grupos);
    const dados = grupos.map(toPersistence);

    await this.db.transaction(async () => {
      const client = this.db.client;
      /*
        Trava a linha do subscriber ANTES do delete. Sem ela, em READ COMMITTED,
        dois PUTs simultâneos (duas abas abertas, ou um retry do cliente) somam as
        árvores: o DELETE do segundo não enxerga o que o primeiro acabou de
        inserir, e a pessoa fica com o dobro dos grupos — furando o limite de
        MAX_GRUPOS que o servidor validou uma linha antes. FOR NO KEY UPDATE trava
        a linha sem bloquear as FKs que apontam pra ela.

        PGlite é UMA sessão: não reproduz essa corrida, então não existe teste de
        integração pra ela. É o mesmo motivo documentado no replaceAll de gastos
        fixos, e a garantia mora aqui.
      */
      await client.$queryRaw`SELECT 1 FROM subscribers WHERE id = ${subscriberId} FOR NO KEY UPDATE`;
      // itens antes de grupos: o cascade faria sozinho, mas a ordem explícita é a mesma
      // do modo memória e a mesma que a exclusão da conta (LGPD) segue
      await client.itemGrupo.deleteMany({ where: { subscriberId } });
      await client.grupo.deleteMany({ where: { subscriberId } });

      if (dados.length === 0) return;

      /*
        Traduz a violação e SAI: depois de um erro a transação está abortada
        (25P02) e qualquer consulta seguinte falharia. Nada de capturar e seguir.
        Cada createMany tem o seu catch porque a chave primária violada diz coisas
        diferentes — grupo repetido na árvore, ou item repetido dentro do grupo.
      */
      try {
        await client.grupo.createMany({ data: dados.map((d) => d.grupo) });
      } catch (error) {
        throw isUniqueViolation(error) ? grupoRepetido() : error;
      }

      const itens = dados.flatMap((d) => d.itens);
      if (itens.length === 0) return;
      try {
        await client.itemGrupo.createMany({ data: itens });
      } catch (error) {
        throw isUniqueViolation(error) ? itemRepetido() : error;
      }
    });
  }

  async deleteAllBySubscriber(subscriberId: string): Promise<void> {
    await this.db.client.itemGrupo.deleteMany({ where: { subscriberId } });
    await this.db.client.grupo.deleteMany({ where: { subscriberId } });
  }
}
