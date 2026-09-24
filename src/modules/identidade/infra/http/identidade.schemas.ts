import { z } from 'zod';

/*
  Formato da entrada HTTP. Se o e-mail é válido e se a senha cumpre as regras
  (8 a 128, não só espaços) é regra do domínio (normalizarEmail, domain/senha.ts),
  com as mensagens da tela; aqui só tipo e um teto largo, pra não aceitar corpo
  absurdo. A senha NUNCA passa por trim aqui: o que a pessoa digitou é o que vale.
*/

const email = z.string({ error: 'Informe um e-mail válido' }).max(320, { error: 'E-mail longo demais' });

// o teto de verdade (128) é do domínio, com a mensagem da tela; este só barra lixo
const senha = (mensagem: string) =>
  z.string({ error: mensagem }).max(4096, { error: 'A senha pode ter no máximo 128 caracteres.' });

export const cadastrarBody = z.object({
  email,
  senha: senha('Crie uma senha.'),
});

export const entrarBody = z.object({
  email,
  senha: senha('Informe a sua senha.'),
});

export const esqueciSenhaBody = z.object({ email });

const tokenDoLink = z
  .string({ error: 'Link inválido. Abra o link do e-mail de novo.' })
  .min(1, { error: 'Link inválido. Abra o link do e-mail de novo.' })
  // o token tem 43 caracteres; o teto só barra lixo
  .max(512, { error: 'Link inválido. Abra o link do e-mail de novo.' });

export const redefinirSenhaBody = z.object({
  token: tokenDoLink,
  senha: senha('Crie uma senha.'),
});

export const verificarLinkBody = z.object({ token: tokenDoLink });

export const trocarSenhaBody = z.object({
  // ausente só na conta antiga, sem senha (o caso de uso decide)
  senhaAtual: senha('Informe a sua senha atual.').optional(),
  senhaNova: senha('Crie uma senha.'),
});

// JWT de descadastro: algumas centenas de caracteres
export const descadastrarPorTokenBody = z.object({
  token: z
    .string({ error: 'Link de descadastro inválido.' })
    .min(1, { error: 'Link de descadastro inválido.' })
    .max(2048, { error: 'Link de descadastro inválido.' }),
});
