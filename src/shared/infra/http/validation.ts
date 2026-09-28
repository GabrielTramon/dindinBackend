import type { Request } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../domain/errors';
import { hasAtMostTwoDecimals, MAX_MONEY } from '../../domain/guards';

/*
  Validação da entrada HTTP com zod.

  A camada HTTP só confere formato (tipos, obrigatórios, limites). Regra de
  negócio — "gasto precisa de perfil", "categoria do catálogo não se renomeia"
  — é do domínio e do caso de uso.

  Em Express 5 `req.query` é só leitura: os helpers devolvem o valor validado
  em vez de reescrever a requisição.
*/

// mensagens padrão do zod em pt-BR pra todo campo sem mensagem própria
z.config(z.locales.ptBR());

function toDetails(error: z.ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in details)) details[key] = issue.message;
  }
  return details;
}

export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new ValidationError('Confira os campos destacados.', toDetails(result.error));
}

export const parseBody = <S extends z.ZodType>(req: Request, schema: S): z.output<S> =>
  parseInput(schema, req.body ?? {});

export const parseParams = <S extends z.ZodType>(req: Request, schema: S): z.output<S> =>
  parseInput(schema, req.params);

export const parseQuery = <S extends z.ZodType>(req: Request, schema: S): z.output<S> =>
  parseInput(schema, req.query);

/** Blocos reaproveitados pelos schemas dos módulos. */
export const commonSchemas = {
  /**
   * Id opaco. Não exige formato UUID: o banco gera UUID, mas o modo em memória e
   * os testes usam ids legíveis — e um id malformado já responde 404 sozinho.
   */
  id: z.string({ error: 'Identificador inválido' }).min(1, { error: 'Identificador inválido' }).max(64, {
    error: 'Identificador inválido',
  }),
  /** dinheiro positivo com no máximo 2 casas, até o teto do Decimal(12,2) do banco */
  money: z
    .number({ error: 'Informe um valor em reais' })
    .positive({ error: 'O valor precisa ser maior que zero' })
    .max(MAX_MONEY, { error: 'Confere esse valor? Está muito alto' })
    .refine(hasAtMostTwoDecimals, { error: 'No máximo 2 casas decimais' }),
  moneyOrZero: z
    .number({ error: 'Informe um valor em reais' })
    .nonnegative({ error: 'Não pode ser negativo' })
    .max(MAX_MONEY, { error: 'Confere esse valor? Está muito alto' })
    .refine(hasAtMostTwoDecimals, { error: 'No máximo 2 casas decimais' }),
  /** cursor opaco; quem decodifica e valida é o repositório (ver shared/application/pagination.ts) */
  pagination: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
  }),
};
