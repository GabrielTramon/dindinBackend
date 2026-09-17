/*
  Erros que atravessam as camadas.

  Domínio e casos de uso lançam estes erros; a camada HTTP traduz cada código
  num status (shared/infra/http/error-handler.ts). Nenhum caso de uso conhece
  HTTP, e nenhum controller decide status por conta própria.

  A mensagem vai pro usuário final: pt-BR, direta, dizendo o que fazer.
*/

export type ErrorCode =
  | 'VALIDACAO'
  | 'REGRA_DE_NEGOCIO'
  | 'NAO_ENCONTRADO'
  | 'CONFLITO'
  | 'NAO_AUTENTICADO'
  | 'PROIBIDO';

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;

  constructor(
    message: string,
    /** mensagens por campo, com o caminho como chave (ex.: "gastosFixos.0.valor") */
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Entrada com formato ou valor inválido. */
export class ValidationError extends AppError {
  readonly code = 'VALIDACAO' as const;
}

/** Entrada válida, mas a regra do produto não permite (ex.: gasto sem perfil criado). */
export class BusinessRuleError extends AppError {
  readonly code = 'REGRA_DE_NEGOCIO' as const;
}

/** Não existe — ou existe e não é de quem pediu. As duas situações respondem igual, de propósito. */
export class NotFoundError extends AppError {
  readonly code = 'NAO_ENCONTRADO' as const;
}

/** Colide com algo que já existe (e-mail repetido, categoria em uso, versão concorrente). */
export class ConflictError extends AppError {
  readonly code = 'CONFLITO' as const;
}

export class UnauthorizedError extends AppError {
  readonly code = 'NAO_AUTENTICADO' as const;
}

export class ForbiddenError extends AppError {
  readonly code = 'PROIBIDO' as const;
}
