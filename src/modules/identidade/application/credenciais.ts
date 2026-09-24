import { ValidationError } from '../../../shared/domain/errors';
import { invalid } from '../../../shared/domain/guards';
import { MENSAGEM_SENHA_LONGA, SENHA_MAX, validarSenhaNova } from '../domain/senha';
import { normalizarEmail } from '../domain/subscriber';

/*
  Validação de e-mail + senha na entrada dos casos de uso. Os dois campos são
  conferidos juntos: com os dois errados, a tela marca os dois de uma vez em vez
  de um por tentativa.
*/

export const MENSAGEM_INFORME_A_SENHA = 'Informe a sua senha.';

/** Roda cada validação e junta os `details` numa ValidationError só. */
export function validarJuntos(...validacoes: Array<() => void>): void {
  const details: Record<string, string> = {};
  const mensagens: string[] = [];
  for (const validar of validacoes) {
    try {
      validar();
    } catch (erro) {
      if (!(erro instanceof ValidationError)) throw erro;
      Object.assign(details, erro.details);
      mensagens.push(erro.message);
    }
  }
  if (mensagens.length === 0) return;
  // um campo só: a mensagem dele; mais de um: a mesma frase do parseBody
  throw new ValidationError(mensagens.length === 1 ? mensagens[0]! : 'Confira os campos destacados.', details);
}

/** Cadastro: e-mail válido e senha nova dentro das regras. Devolve o e-mail normalizado. */
export function credenciaisDeCadastro(email: string, senha: string): string {
  let endereco = '';
  validarJuntos(
    () => {
      endereco = normalizarEmail(email);
    },
    () => validarSenhaNova(senha),
  );
  return endereco;
}

/**
 * Entrar: e-mail válido e alguma senha. As regras de senha NOVA não valem aqui:
 * se um dia o mínimo subir, quem já tem senha continua entrando. O teto vale —
 * é ele que impede mandar um texto enorme pro hash.
 */
export function credenciaisDeEntrada(email: string, senha: string): string {
  let endereco = '';
  validarJuntos(
    () => {
      endereco = normalizarEmail(email);
    },
    () => {
      if (senha === '') invalid('senha', MENSAGEM_INFORME_A_SENHA);
      if (senha.length > SENHA_MAX) invalid('senha', MENSAGEM_SENHA_LONGA);
    },
  );
  return endereco;
}
