import { z } from 'zod';
import { MENSAGEM_CONFIRMACAO_EXCLUSAO } from '../../application/excluir-conta.use-case';

/*
  Formato da entrada HTTP. Se a confirmação é a palavra certa é regra do caso de
  uso (ExcluirContaUseCase); aqui só texto e um teto pra não aceitar corpo absurdo.
  Chave desconhecida (subscriberId, id) é descartada: o dono vem do token.
*/

export const excluirContaBody = z.object({
  confirmacao: z
    .string({ error: MENSAGEM_CONFIRMACAO_EXCLUSAO })
    .max(100, { error: MENSAGEM_CONFIRMACAO_EXCLUSAO }),
});
