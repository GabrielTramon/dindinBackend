import { NotFoundError } from '../../../shared/domain/errors';

/** Todo caso de uso que precisa de um perfil gravado responde igual quando ele não existe. */
export function perfilNaoRespondido(): NotFoundError {
  return new NotFoundError('Você ainda não respondeu o perfil.');
}
