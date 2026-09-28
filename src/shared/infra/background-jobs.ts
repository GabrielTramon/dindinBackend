import type { BackgroundJobs } from '../application/ports';

/*
  Tarefas em segundo plano no próprio processo: sem fila, sem retentativa. Serve
  pro que precisa sair do caminho da resposta (o e-mail do "Esqueci a senha") e
  pode se perder numa queda do processo — a pessoa pede de novo.

  `run` não executa nada na hora: o trabalho começa no próximo giro do event
  loop (setImmediate). Antes disso rodam todas as microtasks pendentes — o
  `await` da rota que agendou e o `res.json` dela —, então a resposta já foi
  escrita quando a primeira linha do trabalho roda, com banco de verdade ou em
  memória. A falha vai pro log com o nome da tarefa; nunca sobe pra ninguém.

  `idle` espera as tarefas em andamento — inclusive as que outras agendarem
  enquanto isso. O server chama no encerramento (antes de fechar o banco), e os
  testes chamam antes de olhar o e-mail enviado.
*/

export interface BackgroundJobsLogger {
  error(message: string, context: Record<string, unknown>): void;
}

const consoleLogger: BackgroundJobsLogger = {
  error: (message, context) => console.error(message, context),
};

export class InProcessBackgroundJobs implements BackgroundJobs {
  private readonly emAndamento = new Set<Promise<void>>();

  constructor(private readonly logger: BackgroundJobsLogger = consoleLogger) {}

  run(nome: string, trabalho: () => Promise<void>): void {
    const execucao: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(trabalho)
      .catch((erro: unknown) => {
        try {
          this.logger.error(`Tarefa em segundo plano falhou: ${nome}`, {
            tarefa: nome,
            erro: erro instanceof Error ? { name: erro.name, message: erro.message } : String(erro),
          });
        } catch {
          // um log quebrado não pode virar unhandledRejection e derrubar o processo
        }
      })
      .finally(() => {
        this.emAndamento.delete(execucao);
      });
    this.emAndamento.add(execucao);
  }

  async idle(): Promise<void> {
    while (this.emAndamento.size > 0) await Promise.all([...this.emAndamento]);
  }
}
