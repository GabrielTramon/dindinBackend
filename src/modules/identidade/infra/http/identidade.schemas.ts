import { z } from 'zod';

/*
  Formato da entrada HTTP. Se o e-mail é válido é regra do domínio
  (normalizarEmail); aqui só tipo e teto, pra não aceitar corpo absurdo.
*/

export const solicitarLinkBody = z.object({
  email: z.string({ error: 'Informe um e-mail válido' }).max(320, { error: 'E-mail longo demais' }),
});

// o token do link mágico tem 43 caracteres; o teto só barra lixo
export const verificarLinkBody = z.object({
  token: z
    .string({ error: 'Link inválido. Abra o link do e-mail de novo.' })
    .min(1, { error: 'Link inválido. Abra o link do e-mail de novo.' })
    .max(512, { error: 'Link inválido. Abra o link do e-mail de novo.' }),
});

// JWT de descadastro: algumas centenas de caracteres
export const descadastrarPorTokenBody = z.object({
  token: z
    .string({ error: 'Link de descadastro inválido.' })
    .min(1, { error: 'Link de descadastro inválido.' })
    .max(2048, { error: 'Link de descadastro inválido.' }),
});
