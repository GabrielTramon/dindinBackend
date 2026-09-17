import 'dotenv/config';
import { CATEGORIAS } from '../src/shared/motor/categorias';
import { createPrismaClient } from '../src/shared/infra/database/prisma';
import type { GrupoCategoria } from '../src/generated/prisma/client';

/*
  Reaplica o catálogo de gastos fixos.

  A migration já semeia as categorias na criação do banco; este script existe
  pra quando o catálogo muda depois — nome corrigido, ícone trocado, categoria
  nova. É upsert por slug, então rodar duas vezes não duplica nada.

  A lista vem do motor vendorado (src/shared/motor/categorias.ts), que por sua
  vez vem do frontend via `yarn motor:sync`: uma fonte só, sem cópia à mão.

  Só mexe no catálogo global (subscriber_id nulo). Categoria criada por uma
  pessoa não tem slug e nunca é tocada aqui.
*/

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida. Configure o .env.');
  const prisma = createPrismaClient(url);

  try {
    const ordemNoGrupo = new Map<string, number>();
    let criadas = 0;
    let atualizadas = 0;

    for (const c of CATEGORIAS) {
      const ordem = (ordemNoGrupo.get(c.grupo) ?? 0) + 10;
      ordemNoGrupo.set(c.grupo, ordem);
      const grupo = c.grupo.toUpperCase() as GrupoCategoria;

      const existente = await prisma.categoriaGastoFixo.findUnique({ where: { slug: c.slug } });
      await prisma.categoriaGastoFixo.upsert({
        where: { slug: c.slug },
        create: { slug: c.slug, nome: c.nome, grupo, icone: c.icone, ordem },
        update: { nome: c.nome, grupo, icone: c.icone, ordem },
      });
      if (existente) atualizadas++;
      else criadas++;
    }

    const orfas = await prisma.categoriaGastoFixo.findMany({
      where: { subscriberId: null, slug: { notIn: CATEGORIAS.map((c) => c.slug) } },
      select: { slug: true, nome: true },
    });

    console.log(`Catálogo: ${criadas} criada(s), ${atualizadas} atualizada(s).`);
    if (orfas.length > 0) {
      // Apagar quebraria os gastos que apontam pra ela (a FK é Restrict, de propósito).
      console.warn(
        `Atenção: ${orfas.length} categoria(s) no banco não estão mais no catálogo: ` +
          orfas.map((o: { slug: string | null; nome: string }) => o.slug ?? o.nome).join(', '),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
