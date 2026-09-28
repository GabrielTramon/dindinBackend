import { BusinessRuleError, ConflictError, NotFoundError } from '../../../../shared/domain/errors';

/*
  Os erros que as constraints de gastos_fixos viram, num lugar só: a versão
  Prisma converte a violação do banco, a em memória emula — e as duas precisam
  responder com a mesma mensagem.
*/

/** @@unique (profile_id, categoria_id), ou chave primária repetida */
export function gastoRepetido(): ConflictError {
  return new ConflictError('Você já tem um gasto nessa categoria. Altere o valor dele.', {
    categoriaId: 'Você já tem um gasto nessa categoria',
  });
}

/** FK gastos_fixos.profile_id → profiles */
export function perfilInexistente(): BusinessRuleError {
  return new BusinessRuleError('Crie seu perfil antes de adicionar gastos.');
}

/** FK gastos_fixos.categoria_id → categorias_gasto_fixo (categoria excluída entre a checagem e a gravação) */
export function categoriaInexistente(): NotFoundError {
  return new NotFoundError('Categoria não encontrada.');
}

/**
 * replaceAll grava na lista de UMA pessoa. Gasto de outro dono na lista é defeito
 * de quem chamou: gravar mudaria o dono em silêncio, então falha alto (500).
 */
export function garantirMesmoDono(subscriberId: string, gastos: readonly { id: string; subscriberId: string }[]): void {
  const alheio = gastos.find((g) => g.subscriberId !== subscriberId);
  if (alheio) throw new Error(`replaceAll(${subscriberId}) recebeu o gasto ${alheio.id}, que é de outro perfil`);
}
