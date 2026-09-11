import { prisma } from "../src/lib/prisma";
import { CATEGORIAS } from "./categorias";

/*
  Reaplica o catálogo de gastos fixos.

  A migration já semeia as categorias na criação do banco; este script existe
  pra quando o catálogo muda depois — nome corrigido, ícone trocado, categoria
  nova. É upsert por slug, então rodar duas vezes não duplica nada.

  Só mexe no catálogo global (subscriber_id nulo). Categoria que a pessoa criou
  não tem slug e nunca é tocada aqui.
*/

async function main() {
  let criadas = 0;
  let atualizadas = 0;

  for (const [i, c] of CATEGORIAS.entries()) {
    const ordem = (i + 1) * 10;
    const existente = await prisma.categoriaGastoFixo.findUnique({ where: { slug: c.slug } });

    await prisma.categoriaGastoFixo.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, nome: c.nome, grupo: c.grupo, icone: c.icone, ordem },
      update: { nome: c.nome, grupo: c.grupo, icone: c.icone, ordem },
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
        orfas.map((o) => o.slug ?? o.nome).join(", "),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
