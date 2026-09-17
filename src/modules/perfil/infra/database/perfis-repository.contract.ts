import { beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../../../shared/domain/errors';
import { MORADIAS, TIPOS_RENDA } from '../../../../shared/motor/schema';
import { Perfil, type DadosPerfil } from '../../domain/perfil';
import type { PerfisRepository } from '../../domain/perfis-repository';

/*
  Contrato de PerfisRepository: o mesmo comportamento pra qualquer
  implementação. Roda contra a versão em memória (in-memory-perfis-repository.test.ts)
  e contra a do Prisma num Postgres de verdade (*.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada implementação chama.
*/

export interface PerfisRepositoryHarness {
  repo: PerfisRepository;
  /** cria um subscriber válido (no Prisma, a FK do perfil exige que ele exista) e devolve o id */
  criarSubscriber(): Promise<string>;
}

const agora = new Date('2026-09-17T12:00:00.000Z');
const depois = new Date('2026-10-01T09:15:30.456Z');
let sequencia = 0;
// formato de UUID: id de conta que não existe em nenhuma das implementações
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

const DADOS: DadosPerfil = {
  rendaMensal: 2800.5,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1200,
  guardado: 1000,
};

export function describePerfisRepositoryContract(nome: string, setup: () => Promise<PerfisRepositoryHarness>) {
  describe(`PerfisRepository — ${nome}`, () => {
    let h: PerfisRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const perfil = (subscriberId: string, dados: Partial<DadosPerfil> = {}, quando = agora) =>
      Perfil.criar({ ...DADOS, ...dados, subscriberId, agora: quando });

    it('save insere e findBySubscriberId devolve o mesmo perfil, com centavos e data (ms) intactos', async () => {
      const sub = await h.criarSubscriber();
      const p = perfil(
        sub,
        { rendaMensal: 999_999.99, custoMoradia: 19.99, guardado: 99_999_999.99 },
        new Date(agora.getTime() + 123),
      );
      await h.repo.save(p);

      expect((await h.repo.findBySubscriberId(sub))?.toSnapshot()).toEqual(p.toSnapshot());
    });

    it('centavos pequenos voltam exatos (0,07 e 0,01), e zero continua zero', async () => {
      const sub = await h.criarSubscriber();
      const p = perfil(sub, { rendaMensal: 0.07, custoMoradia: 0, guardado: 0.01 });
      await h.repo.save(p);

      expect((await h.repo.findBySubscriberId(sub))?.toDados()).toEqual({
        ...DADOS,
        rendaMensal: 0.07,
        custoMoradia: 0,
        guardado: 0.01,
      });
    });

    it('save de novo atualiza a mesma linha: todos os campos e a data', async () => {
      const sub = await h.criarSubscriber();
      const p = perfil(sub);
      await h.repo.save(p);
      p.atualizar(
        { rendaMensal: 5100.1, tipoRenda: 'pj', idade: 31, moradia: 'financiada', custoMoradia: 2300.45, guardado: 15000 },
        depois,
      );
      await h.repo.save(p);

      expect((await h.repo.findBySubscriberId(sub))?.toSnapshot()).toEqual({
        subscriberId: sub,
        rendaMensal: 5100.1,
        tipoRenda: 'pj',
        idade: 31,
        moradia: 'financiada',
        custoMoradia: 2300.45,
        guardado: 15000,
        atualizadoEm: depois,
      });
    });

    it('mutar a entidade sem save não altera o que está gravado', async () => {
      const sub = await h.criarSubscriber();
      const p = perfil(sub);
      await h.repo.save(p);
      p.atualizar({ idade: 60 }, depois);

      expect((await h.repo.findBySubscriberId(sub))?.toSnapshot()).toEqual(perfil(sub).toSnapshot());
    });

    it('mexer no perfil lido não altera o que está gravado', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(perfil(sub));
      const lido = await h.repo.findBySubscriberId(sub);
      lido?.atualizar({ guardado: 1 }, depois);
      lido?.atualizadoEm.setFullYear(1990);

      expect((await h.repo.findBySubscriberId(sub))?.toSnapshot()).toEqual(perfil(sub).toSnapshot());
    });

    it('todo tipo de renda e toda moradia vão e voltam em minúsculo', async () => {
      const total = Math.max(TIPOS_RENDA.length, MORADIAS.length);
      for (let i = 0; i < total; i++) {
        const sub = await h.criarSubscriber();
        const tipoRenda = TIPOS_RENDA[i % TIPOS_RENDA.length]!;
        const moradia = MORADIAS[i % MORADIAS.length]!;
        await h.repo.save(perfil(sub, { tipoRenda, moradia }));
        expect((await h.repo.findBySubscriberId(sub))?.toDados()).toMatchObject({ tipoRenda, moradia });
      }
    });

    it('cada pessoa só enxerga o próprio perfil; sem perfil → null e exists falso', async () => {
      const [a, b, semPerfil] = [await h.criarSubscriber(), await h.criarSubscriber(), await h.criarSubscriber()];
      const deA = perfil(a, { idade: 20 });
      const deB = perfil(b, { idade: 40, moradia: 'pais' });
      await h.repo.save(deA);
      await h.repo.save(deB);

      expect((await h.repo.findBySubscriberId(a))?.toSnapshot()).toEqual(deA.toSnapshot());
      expect((await h.repo.findBySubscriberId(b))?.toSnapshot()).toEqual(deB.toSnapshot());
      expect(await h.repo.findBySubscriberId(semPerfil)).toBeNull();
      expect(await h.repo.exists(a)).toBe(true);
      expect(await h.repo.exists(semPerfil)).toBe(false);
      expect(await h.repo.exists(novoId())).toBe(false);
    });

    it('delete apaga só aquele perfil e é idempotente', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const deB = perfil(b);
      await h.repo.save(perfil(a));
      await h.repo.save(deB);

      await h.repo.delete(a);
      expect(await h.repo.findBySubscriberId(a)).toBeNull();
      expect(await h.repo.exists(a)).toBe(false);
      expect((await h.repo.findBySubscriberId(b))?.toSnapshot()).toEqual(deB.toSnapshot());

      await expect(h.repo.delete(a)).resolves.toBeUndefined();
      await expect(h.repo.delete(novoId())).resolves.toBeUndefined();
    });

    it('depois de apagado, save cria de novo', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(perfil(sub));
      await h.repo.delete(sub);
      const outro = perfil(sub, { idade: 50 }, depois);
      await h.repo.save(outro);

      expect((await h.repo.findBySubscriberId(sub))?.toSnapshot()).toEqual(outro.toSnapshot());
    });

    it('conta inexistente (FK) → UnauthorizedError e nada é gravado', async () => {
      const semConta = novoId();
      await expect(h.repo.save(perfil(semConta))).rejects.toBeInstanceOf(UnauthorizedError);
      expect(await h.repo.findBySubscriberId(semConta)).toBeNull();
      expect(await h.repo.exists(semConta)).toBe(false);
    });
  });
}
