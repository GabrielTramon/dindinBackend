import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { consoleErrorLogger, errorHandler, notFoundHandler, type ErrorLogger } from '../shared/infra/http/error-handler';
import { requestId } from '../shared/infra/http/request-id';

/*
  Monta o Express. Não conhece módulo nenhum: quem pluga as rotas é `mount`
  (ver main/routes.ts). Os testes HTTP usam esta mesma função, então rodam o
  mesmo pipeline de middlewares da produção.

    /api/health          vivo? (não toca no banco)
    /api/health/ready    pronto? (pinga o banco)
    /api/v1/...          os módulos
*/

export interface AppOptions {
  /** registra as rotas dos módulos no router de /api/v1 */
  mount: (api: Router) => void;
  corsOrigins: string[] | '*';
  /** atrás de proxy/load balancer: número de saltos confiáveis, pra req.ip e o rate limit */
  trustProxy?: number | boolean;
  logRequests?: boolean;
  errorLogger?: ErrorLogger;
  /** checagem de prontidão (ex.: SELECT 1 no banco) */
  readiness?: () => Promise<void>;
}

export function createApp(options: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  if (options.trustProxy !== undefined) app.set('trust proxy', options.trustProxy);

  app.use(requestId());
  app.use(helmet());
  app.use(
    cors({
      origin: options.corsOrigins,
      // o frontend roda em outra origem: sem expor, ele não lê o Location do 201 nem o nome do arquivo exportado
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Location', 'Content-Disposition'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  if (options.logRequests) {
    // o id ATRIBUÍDO (requestId()), não o header cru que o cliente mandou
    morgan.token('request-id', (req) => (req as express.Request).requestId);
    app.use(morgan(':method :url :status :response-time ms - :request-id'));
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  app.get('/api/health/ready', async (req, res) => {
    try {
      await options.readiness?.();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'indisponivel', requestId: req.requestId });
    }
  });

  const api = Router();
  options.mount(api);
  app.use('/api/v1', api);

  app.use(notFoundHandler());
  app.use(errorHandler(options.errorLogger ?? consoleErrorLogger));

  return app;
}
