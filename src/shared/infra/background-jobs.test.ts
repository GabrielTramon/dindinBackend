import { describe, expect, it } from 'vitest';
import { InProcessBackgroundJobs } from './background-jobs';

function comLog() {
  const erros: Array<{ message: string; context: Record<string, unknown> }> = [];
  const jobs = new InProcessBackgroundJobs({ error: (message, context) => erros.push({ message, context }) });
  return { jobs, erros };
}

describe('InProcessBackgroundJobs', () => {
  it('run volta sem rodar nada do trabalho, nem o trecho síncrono; idle espera ele terminar', async () => {
    const { jobs } = comLog();
    const passos: string[] = [];
    jobs.run('teste', async () => {
      passos.push('começou');
      await Promise.resolve();
      passos.push('terminou');
    });
    passos.push('run voltou');
    await jobs.idle();
    expect(passos).toEqual(['run voltou', 'começou', 'terminou']);
  });

  it('falha vai pro log com o nome da tarefa e não sobe pra ninguém', async () => {
    const { jobs, erros } = comLog();
    jobs.run('e-mail do esqueci a senha', async () => {
      throw new Error('provedor fora do ar');
    });
    await expect(jobs.idle()).resolves.toBeUndefined();
    expect(erros).toEqual([
      {
        message: 'Tarefa em segundo plano falhou: e-mail do esqueci a senha',
        context: { tarefa: 'e-mail do esqueci a senha', erro: { name: 'Error', message: 'provedor fora do ar' } },
      },
    ]);
  });

  it('um log que lança não vira unhandledRejection', async () => {
    const jobs = new InProcessBackgroundJobs({
      error: () => {
        throw new Error('log quebrado');
      },
    });
    jobs.run('x', async () => {
      throw new Error('falhou');
    });
    await expect(jobs.idle()).resolves.toBeUndefined();
  });

  it('idle espera também a tarefa que outra agendou enquanto rodava', async () => {
    const { jobs } = comLog();
    let segunda = false;
    jobs.run('primeira', async () => {
      await Promise.resolve();
      jobs.run('segunda', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        segunda = true;
      });
    });
    await jobs.idle();
    expect(segunda).toBe(true);
  });

  it('idle sem nada em andamento resolve na hora', async () => {
    await expect(comLog().jobs.idle()).resolves.toBeUndefined();
  });
});
