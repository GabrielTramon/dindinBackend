import { invalid } from '../../../shared/domain/guards';

/*
  Regras da senha — as MESMAS do frontend (mesmos limites e mensagens), que
  valida antes de mandar. Mudou aqui, muda lá.

  A senha nunca é trimada nem normalizada: " abc" e "abc" são senhas
  diferentes, e o que a pessoa digitou é exatamente o que vai pro hash. Aqui
  ela só é validada.

  O tamanho conta unidades UTF-16 (`length`), o mesmo que o `maxLength` do
  campo no navegador conta — senão um emoji no fim passaria de um lado e não
  do outro.
*/

export const SENHA_MIN = 8;
export const SENHA_MAX = 128;

export const MENSAGEM_SENHA_CURTA = `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
export const MENSAGEM_SENHA_LONGA = `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;

/** A mensagem do problema da senha, ou null quando ela vale. Só espaços não vale. */
export function problemaDaSenha(senha: string): string | null {
  if (senha.length > SENHA_MAX) return MENSAGEM_SENHA_LONGA;
  if (senha.length < SENHA_MIN || senha.trim() === '') return MENSAGEM_SENHA_CURTA;
  return null;
}

/**
 * Senha nova (cadastro, redefinição, troca).
 * @param campo a chave em `details` (ex.: "senhaNova" no POST /me/senha)
 * @throws ValidationError com a mensagem pra tela
 */
export function validarSenhaNova(senha: string, campo = 'senha'): void {
  const problema = problemaDaSenha(senha);
  if (problema) invalid(campo, problema);
}
