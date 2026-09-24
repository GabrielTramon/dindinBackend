import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors';
import { MENSAGEM_SENHA_CURTA, MENSAGEM_SENHA_LONGA, problemaDaSenha, validarSenhaNova } from './senha';

describe('regras da senha', () => {
  it('as mensagens são as da tela (as mesmas do frontend)', () => {
    expect(MENSAGEM_SENHA_CURTA).toBe('A senha precisa ter pelo menos 8 caracteres.');
    expect(MENSAGEM_SENHA_LONGA).toBe('A senha pode ter no máximo 128 caracteres.');
  });

  it.each([
    ['vazia', '', MENSAGEM_SENHA_CURTA],
    ['7 caracteres', '1234567', MENSAGEM_SENHA_CURTA],
    ['só espaços, mesmo longa', ' '.repeat(20), MENSAGEM_SENHA_CURTA],
    ['só tab e quebra de linha', '\t\n\t\n\t\n\t\n', MENSAGEM_SENHA_CURTA],
    ['129 caracteres', 'a'.repeat(129), MENSAGEM_SENHA_LONGA],
  ])('%s → %s', (_caso, senha, mensagem) => {
    expect(problemaDaSenha(senha)).toBe(mensagem);
  });

  it.each([
    ['8 caracteres', '12345678'],
    ['128 caracteres', 'b'.repeat(128)],
    ['espaços nas pontas contam (nunca há trim)', '  abcd  '],
    ['espaço no meio', 'minha senha'],
    ['acento e emoji', 'pão de queijo 🧀'],
  ])('%s vale', (_caso, senha) => {
    expect(problemaDaSenha(senha)).toBeNull();
  });

  it('conta unidades UTF-16, como o maxLength do navegador: 64 emojis são 128', () => {
    expect(problemaDaSenha('🧀'.repeat(64))).toBeNull();
    expect(problemaDaSenha(`${'🧀'.repeat(64)}a`)).toBe(MENSAGEM_SENHA_LONGA);
  });

  it('validarSenhaNova lança ValidationError com o campo pedido em details', () => {
    expect(() => validarSenhaNova('curta')).toThrow(new ValidationError(MENSAGEM_SENHA_CURTA, { senha: MENSAGEM_SENHA_CURTA }));
    try {
      validarSenhaNova('curta', 'senhaNova');
      expect.unreachable();
    } catch (erro) {
      expect((erro as ValidationError).details).toEqual({ senhaNova: MENSAGEM_SENHA_CURTA });
    }
    expect(() => validarSenhaNova('boa o bastante')).not.toThrow();
  });
});
