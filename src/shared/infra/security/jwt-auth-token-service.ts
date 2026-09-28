import jwt from 'jsonwebtoken';
import type { AuthTokenService, Clock, IssuedToken, SessionClaims } from '../../application/ports';

/*
  Tokens assinados com HS256.

  Cada propósito tem a sua audience: um token de descadastro — que vai em todo
  e-mail e pode ser encaminhado — nunca serve como sessão, e vice-versa.
  `exp` e a verificação usam o Clock injetado, então os testes controlam o tempo.

  A sessão carrega `ver`, a versaoSessao da conta quando o token saiu (ver
  SessionAccounts): a senha nova sobe a versão e os tokens de antes deixam de
  valer. Token sem `ver` é de antes desta regra e conta como versão 0 — continua
  valendo até a primeira troca de senha, como valia.
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

  issueSession(subscriberId: string, versao: number): IssuedToken {
    // defeito de programação, não entrada de ninguém: uma versão estranha nunca bateria com a da conta
    if (!Number.isSafeInteger(versao) || versao < 0) throw new Error(`versão de sessão inválida: ${versao}`);
    return this.issue(subscriberId, 'sessao', this.options.sessionTtlSeconds, { ver: versao });
  }

  verifySession(token: string): SessionClaims | null {
    const payload = this.verify(token, 'sessao');
    if (!payload) return null;
    // só a AUSÊNCIA vale como 0 (token de antes da regra); qualquer outro valor estranho, não
    const ver: unknown = 'ver' in payload ? payload.ver : 0;
    if (typeof ver !== 'number' || !Number.isSafeInteger(ver) || ver < 0) return null;
    return { subscriberId: payload.sub, versao: ver };
  }

  issueUnsubscribe(subscriberId: string): IssuedToken {
    return this.issue(subscriberId, 'descadastro', this.options.unsubscribeTtlSeconds);
  }

  verifyUnsubscribe(token: string): { subscriberId: string } | null {
    const payload = this.verify(token, 'descadastro');
    return payload ? { subscriberId: payload.sub } : null;
  }

  private issue(subscriberId: string, purpose: Purpose, ttlSeconds: number, extra: Record<string, unknown> = {}): IssuedToken {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const exp = nowSeconds + ttlSeconds;
    const token = jwt.sign({ ...extra, sub: subscriberId, iat: nowSeconds, exp }, this.options.secret, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: purpose,
    });
    return { token, expiresAt: new Date(exp * 1000) };
  }

  private verify(token: string, purpose: Purpose): (jwt.JwtPayload & { sub: string }) | null {
    try {
      const payload = jwt.verify(token, this.options.secret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: purpose,
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1000),
      });
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.sub === '') return null;
      return payload as jwt.JwtPayload & { sub: string };
    } catch {
      return null;
    }
  }
}
