import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, type ErrorCode } from '../../domain/errors';

/*
  Todo erro vira o mesmo formato de resposta:

    { "error": { "code": "NAO_ENCONTRADO", "message": "...", "details": {...}, "requestId": "..." } }

  O cliente decide pelo `code` (estável) e mostra a `message` (pt-BR, pronta
  pra tela). Erro inesperado nunca vaza stack nem mensagem interna.
*/

export type HttpErrorCode =
  | ErrorCode
  | 'JSON_INVALIDO'
  | 'CORPO_GRANDE_DEMAIS'
  | 'REQUISICAO_INVALIDA'
  | 'ROTA_NAO_ENCONTRADA'
  | 'MUITAS_REQUISICOES'
  | 'ERRO_INTERNO';

const STATUS: Record<ErrorCode, number> = {
  VALIDACAO: 400,
  NAO_AUTENTICADO: 401,
  PROIBIDO: 403,
  NAO_ENCONTRADO: 404,
  CONFLITO: 409,
  REGRA_DE_NEGOCIO: 422,
};

export interface ErrorBody {
  error: {
    code: HttpErrorCode;
    message: string;
    details?: Record<string, string>;
    requestId: string;
  };
}

export function errorBody(
  code: HttpErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, string>,
): ErrorBody {
  return { error: { code, message, requestId, ...(details ? { details } : {}) } };
}

export interface ErrorLogger {
  error(message: string, context: Record<string, unknown>): void;
}

export const consoleErrorLogger: ErrorLogger = {
  error: (message, context) => console.error(message, context),
};

/** Tipo dos erros que o body-parser do express.json lança. */
function bodyParserError(err: unknown): { type?: string; status?: number } | undefined {
  return typeof err === 'object' && err !== null && 'type' in err ? (err as { type?: string; status?: number }) : undefined;
}

/**
 * Erro 4xx do próprio Express/http-errors (URL com percent-encoding quebrado,
 * charset ou Content-Encoding não suportado). É culpa da requisição, não bug:
 * responde com o status dele, sem registrar como erro inesperado.
 */
function clientHttpError(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; expose?: unknown };
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined;
  return status !== undefined && status >= 400 && status < 500 && e.expose !== false ? status : undefined;
}

export function errorHandler(logger: ErrorLogger = consoleErrorLogger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const requestId = req.requestId ?? 'desconhecido';

    if (err instanceof AppError) {
      res.status(STATUS[err.code]).json(errorBody(err.code, err.message, requestId, err.details));
      return;
    }

    const parser = bodyParserError(err);
    if (parser?.type === 'entity.parse.failed') {
      res.status(400).json(errorBody('JSON_INVALIDO', 'O corpo da requisição não é um JSON válido.', requestId));
      return;
    }
    if (parser?.type === 'entity.too.large') {
      res.status(413).json(errorBody('CORPO_GRANDE_DEMAIS', 'O corpo da requisição é grande demais.', requestId));
      return;
    }
    const clientStatus = clientHttpError(err);
    if (clientStatus !== undefined) {
      res.status(clientStatus).json(errorBody('REQUISICAO_INVALIDA', 'A requisição não pôde ser entendida.', requestId));
      return;
    }

    logger.error('Erro não tratado', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });
    res.status(500).json(errorBody('ERRO_INTERNO', 'Algo deu errado do nosso lado. Tente de novo em instantes.', requestId));
  };
}

export function notFoundHandler(): RequestHandler {
  return (req, res) => {
    res
      .status(404)
      .json(errorBody('ROTA_NAO_ENCONTRADA', `Rota não encontrada: ${req.method} ${req.originalUrl}`, req.requestId));
  };
}
