import { UnauthorizedError } from '../../../../shared/domain/errors';

/*
  O erro que a FK profiles.subscriber_id vira, num lugar só: a versão Prisma
  converte a violação do banco, a em memória emula — e as duas respondem igual.
*/

/**
 * A sessão foi conferida no começo do pedido, mas a conta foi excluída antes
 * de o perfil ser gravado. Mesma resposta do requireAuth pra conta excluída:
 * a sessão acabou.
 */
export function contaInexistente(): UnauthorizedError {
  return new UnauthorizedError('Sua sessão expirou. Entre de novo pelo link no seu e-mail.');
}
