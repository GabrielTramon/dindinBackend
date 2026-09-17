// Campos que os middlewares do dindin põem na requisição.

declare global {
  namespace Express {
    interface Request {
      /** id da requisição (X-Request-Id), sempre presente depois de requestId() */
      requestId: string;
      /** presente quando requireAuth/optionalAuth validou um token de sessão */
      auth?: { subscriberId: string };
    }
  }
}

export {};
