import { NextFunction, Request, Response } from 'express';

export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ message: `Rota nao encontrada: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  console.error(err);

  return res.status(500).json({ message: 'Erro interno do servidor' });
}
