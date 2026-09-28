import type {
  CategoriaGastoFixo as CategoriaRow,
  GrupoCategoria as GrupoCategoriaDb,
} from '../../../../generated/prisma/client';
import { Categoria, type GrupoCategoria } from '../../domain/categoria';

/*
  Linha do Prisma ⇄ entidade. O enum do banco é MAIÚSCULO; o domínio e a API
  usam minúsculo, como o frontend — o cliente nunca vê "CASA".
*/

export function grupoToDomain(grupo: GrupoCategoriaDb): GrupoCategoria {
  return grupo.toLowerCase() as GrupoCategoria;
}

export function grupoToDb(grupo: GrupoCategoria): GrupoCategoriaDb {
  return grupo.toUpperCase() as GrupoCategoriaDb;
}

export function toDomain(row: CategoriaRow): Categoria {
  return Categoria.restaurar({
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    grupo: grupoToDomain(row.grupo),
    icone: row.icone,
    ordem: row.ordem,
    subscriberId: row.subscriberId,
    criadoEm: row.criadoEm,
  });
}

export function toPersistence(categoria: Categoria) {
  const c = categoria.toSnapshot();
  return {
    id: c.id,
    slug: c.slug,
    nome: c.nome,
    grupo: grupoToDb(c.grupo),
    icone: c.icone,
    ordem: c.ordem,
    subscriberId: c.subscriberId,
    criadoEm: c.criadoEm,
  };
}
