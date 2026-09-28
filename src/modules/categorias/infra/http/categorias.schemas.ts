import { z } from 'zod';
import { commonSchemas } from '../../../../shared/infra/http/validation';

/*
  Formato da entrada HTTP. Tamanho e conteúdo do nome são regra do domínio
  (normalizarNomeCategoria); aqui só um teto pra não aceitar corpo absurdo.
*/

export const categoriaParams = z.object({ id: commonSchemas.id });

export const nomeCategoriaBody = z.object({
  nome: z.string({ error: 'Dê um nome pra categoria' }).max(200, { error: 'Nome longo demais' }),
});
