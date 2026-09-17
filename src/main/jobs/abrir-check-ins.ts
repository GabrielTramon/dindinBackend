import 'dotenv/config';
import { loadConfig } from '../config';
import { createContainer } from '../container';
import { createJobs } from './jobs';

/*
  Job do dia 1: `yarn job:abrir-check-ins` (ou `node dist/main/jobs/abrir-check-ins.js`).

  Abre o check-in do mês que acabou pra cada pessoa ativa e com e-mail
  confirmado, e manda a pergunta. Imprime o relatório em JSON numa linha no
  stdout (pra log/monitoramento) e sai com:
    0  tudo certo
    1  houve falha de envio (ou conta excluída no meio) — ou o job nem rodou

  AGENDAMENTO: depois das 03:00 UTC do dia 1 (ex.: 03:30 UTC = 00:30 em São
  Paulo). Antes disso ainda é o último dia do mês em Brasília e o job abriria o
  mês retrasado. É idempotente: rodar de novo (ex.: depois de falhas > 0) não
  duplica check-in nem e-mail.
*/

async function main(): Promise<number> {
  const config = loadConfig();
  if (config.persistence === 'memoria') {
    console.warn('PERSISTENCIA=memoria: o job roda num banco vazio e não abre nada. Use PERSISTENCIA=prisma.');
  }

  const container = createContainer(config);
  try {
    const relatorio = await createJobs(container).abrirCheckIns.execute();
    console.info(JSON.stringify(relatorio));
    return relatorio.falhas > 0 ? 1 : 0;
  } finally {
    await container.close().catch((erro) => console.error('Erro ao fechar a persistência', erro));
  }
}

main().then(
  (codigo) => {
    // exitCode em vez de process.exit: deixa o stdout terminar de escrever num pipe
    process.exitCode = codigo;
  },
  (erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  },
);
