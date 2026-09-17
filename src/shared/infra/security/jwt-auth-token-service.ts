import jwt from 'jsonwebtoken';
import type { AuthTokenService, Clock, IssuedToken } from '../../application/ports';

/*
  Tokens assinados com HS256.

  Cada propósito tem a sua audience: um token de descadastro — que vai em todo
  e-mail e pode ser encaminhado — nunca serve como sessão, e vice-versa.
  `exp` e a verificação usam o Clock injetado, então os testes controlam o tempo.
*/

const ISSUER = 'dindin-api';

type Purpose = 'sessao' | 'descadastro';

export interface JwtAuthTokenServiceOptions {
  secret: string;
  sessionTtlSeconds: number;
  unsubscribeTtlSeconds: number;
}

export class JwtAuthTokenService implements AuthTokenService {
  constructor(
    private readonly options: JwtAuthTokenServiceOptions,
    private readonly clock: Clock,
  ) {}

  issueSession(subscriberId: string): IssuedToken {
    return this.issue(subscriberId, 'sessao', this.options.sessionTtlSeconds);
  }

  verifySession(token: string): { subscriberId: string } | null {
    return this.verify(token, 'sessao');
  }

  issueUnsubscribe(subscriberId: string): IssuedToken {
    return this.issue(subscriberId, 'descadastro', this.options.unsubscribeTtlSeconds);
  }

  verifyUnsubscribe(token: string): { subscriberId: string } | null {
    return this.verify(token, 'descadastro');
  }

  private issue(subscriberId: string, purpose: Purpose, ttlSeconds: number): IssuedToken {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const exp = nowSeconds + ttlSeconds;
    const token = jwt.sign({ sub: subscriberId, iat: nowSeconds, exp }, this.options.secret, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: purpose,
    });
    return { token, expiresAt: new Date(exp * 1000) };
  }

  private verify(token: string, purpose: Purpose): { subscriberId: string } | null {
    try {
      const payload = jwt.verify(token, this.options.secret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: purpose,
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1000),
      });
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.sub === '') return null;
      return { subscriberId: payload.sub };
    } catch {
      return null;
    }
  }
}
