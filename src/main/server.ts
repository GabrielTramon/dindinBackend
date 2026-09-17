import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';
import { createContainer } from './container';
import { mountModules } from './routes';

/*
  Boot: configuração → container → app → escuta. SIGTERM/SIGINT param de
  aceitar conexões, esperam as requisições em andamento e fecham o banco —
  deploy e autoscaling não derrubam requisição no meio.
*/

const ENCERRAMENTO_FORCADO_MS = 10_000;

function main() {
  const config = loadConfig();
  const container = createContainer(config);

  const app = createApp({
    mount: (api) => mountModules(api, container),
    corsOrigins: config.corsOrigins,
    trustProxy: config.trustProxy,
    logRequests: config.logRequests,
    readiness: container.readiness,
  });

  const server = app.listen(config.port, () => {
    console.info(
      `dindin API em http://localhost:${config.port} — persistência: ${config.persistence}, e-mail: ${config.mail.provider}`,
    );
  });

  let encerrando = false;
  const encerrar = (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    console.info(`${sinal} recebido: encerrando…`);

    const forcar = setTimeout(() => {
      console.error('Encerramento demorou demais; saindo à força.');
      process.exit(1);
    }, ENCERRAMENTO_FORCADO_MS);
    forcar.unref();

    server.close(async (erro) => {
      await container.close().catch((e) => console.error('Erro ao fechar a persistência', e));
      process.exit(erro ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

try {
  main();
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
}
