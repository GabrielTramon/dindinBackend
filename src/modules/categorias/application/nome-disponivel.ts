import { ConflictError } from '../../../shared/domain/errors';
import type { CategoriasRepository } from '../domain/categorias-repository';

/*
  Um nome de categoria personalizada precisa ser único entre as da pessoa E
  não pode repetir um nome do catálogo — "Mercado" personalizado ao lado do
  "Mercado" do catálogo vira duas linhas iguais na tela e ninguém sabe qual usar.
  Comparação sem diferenciar maiúsculas.
*/

export async function garantirNomeDisponivel(
  categorias: CategoriasRepository,
  subscriberId: string,
  nome: string,
  ignorarId?: string,
): Promise<void> {
  const chave = nome.toLocaleLowerCase('pt-BR');

  const doCatalogo = (await categorias.listVisible(null)).find((c) => c.nome.toLocaleLowerCase('pt-BR') === chave);
  if (doCatalogo) {
    throw new ConflictError(`"${doCatalogo.nome}" já existe no catálogo. Use a categoria de lá.`, {
      nome: 'Já existe no catálogo',
    });
  }

  const propria = await categorias.findCustomByName(subscriberId, nome);
  if (propria && propria.id !== ignorarId) {
    throw new ConflictError(`Você já tem uma categoria chamada "${propria.nome}".`, {
      nome: 'Você já tem uma categoria com esse nome',
    });
  }
}
