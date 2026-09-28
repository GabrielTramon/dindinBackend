import { beforeEach, describe, expect, it } from 'vitest';
import { encodeCursor } from '../../../../shared/application/pagination';
import { BusinessRuleError, ConflictError, ValidationError } from '../../../../shared/domain/errors';
import { CheckIn } from '../../domain/check-in';
import type { CheckInsRepository } from '../../domain/check-ins-repository';

/*
  Contrato de CheckInsRepository: o mesmo comportamento pra qualquer
  implementação. Roda contra a versão em memória (in-memory-check-ins-repository.test.ts)
  e contra a do Prisma num Postgres de verdade (*.integration.test.ts).

  Não é um arquivo .test.ts: é uma função que cada implementação chama.

  Corrida de verdade (duas execuções do job em paralelo) não entra: o PGlite é
  uma sessão só. Os testes de claimSend simulam a corrida intercalando leituras
  e escritas, que é o que o WHERE do banco resolve.
*/

export interface CheckInsRepositoryHarness {
  repo: CheckInsRepository;
  /** cria um subscriber válido (no Prisma, a FK exige que ele exista) e devolve o id */
  criarSubscriber(): Promise<string>;
}

const agora = new Date('2026-10-01T03:30:00.000Z');
const depois = new Date('2026-10-02T15:00:00.000Z');
let sequencia = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

export function describeCheckInsRepositoryContract(nome: string, setup: () => Promise<CheckInsRepositoryHarness>) {
  describe(`CheckInsRepository — ${nome}`, () => {
    let h: CheckInsRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const abrir = (subscriberId: string, competencia = '2026-09', id = novoId()) =>
      CheckIn.abrir({ id, subscriberId, competencia, agora });

    const salvarMeses = async (subscriberId: string, competencias: string[]) => {
      for (const c of competencias) await h.repo.save(abrir(subscriberId, c));
    };

    const competencias = (lista: CheckIn[]) => lista.map((c) => c.competencia);

    it('save insere e findByCompetencia devolve a mesma entidade, sem resposta e sem envio', async () => {
      const sub = await h.criarSubscriber();
      const checkIn = abrir(sub);
      await h.repo.save(checkIn);

      const lido = await h.repo.findByCompetencia(sub, '2026-09');
      expect(lido?.toSnapshot()).toEqual(checkIn.toSnapshot());
      expect(lido?.toSnapshot()).toMatchObject({
        rendaReal: null,
        gastoReal: null,
        guardadoReal: null,
        enviadoEm: null,
        respondidoEm: null,
        criadoEm: agora,
      });
    });

    it('findByCompetencia: de outra pessoa, de outro mês ou inexistente → null', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(abrir(a, '2026-09'));

      expect(await h.repo.findByCompetencia(b, '2026-09')).toBeNull();
      expect(await h.repo.findByCompetencia(a, '2026-08')).toBeNull();
      expect(await h.repo.findByCompetencia(novoId(), '2026-09')).toBeNull();
    });

    it('save atualiza a mesma linha com a resposta; centavos voltam exatos', async () => {
      const sub = await h.criarSubscriber();
      const checkIn = abrir(sub);
      await h.repo.save(checkIn);
      checkIn.responder({ rendaReal: 3200.5, gastoReal: 19.99, guardadoReal: 0.07 }, agora);
      await h.repo.save(checkIn);
      checkIn.responder({ rendaReal: 1234.56, gastoReal: 1.1, guardadoReal: 9_999_999_999.99 }, depois);
      await h.repo.save(checkIn);

      const lido = await h.repo.findByCompetencia(sub, '2026-09');
      expect(lido?.toSnapshot()).toEqual(checkIn.toSnapshot());
      expect(lido?.toSnapshot()).toMatchObject({
        id: checkIn.id,
        rendaReal: 1234.56,
        gastoReal: 1.1,
        guardadoReal: 9_999_999_999.99,
        respondidoEm: depois,
      });
      expect((await h.repo.list(sub, { limit: 10 })).items).toHaveLength(1);
    });

    it('resposta zerada é resposta: 0 volta 0, não null', async () => {
      const sub = await h.criarSubscriber();
      const checkIn = abrir(sub);
      checkIn.responder({ rendaReal: 0, gastoReal: 0, guardadoReal: 0 }, agora);
      await h.repo.save(checkIn);

      const lido = await h.repo.findByCompetencia(sub, '2026-09');
      expect(lido?.toSnapshot()).toMatchObject({ rendaReal: 0, gastoReal: 0, guardadoReal: 0, respondidoEm: agora });
      expect(lido?.respondido).toBe(true);
    });

    it('save de atualização não apaga a reserva de envio feita depois da leitura', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(abrir(sub));
      // a pessoa abre a tela; o job reserva o envio; a pessoa responde com a entidade lida antes
      const lidoAntes = await h.repo.findByCompetencia(sub, '2026-09');
      expect(await h.repo.claimSend(lidoAntes!.id, agora)).toBe(true);
      lidoAntes!.responder({ rendaReal: 100, gastoReal: 50, guardadoReal: 50 }, depois);
      await h.repo.save(lidoAntes!);

      const lido = await h.repo.findByCompetencia(sub, '2026-09');
      expect(lido?.enviadoEm).toEqual(agora);
      expect(lido?.guardadoReal).toBe(50);
    });

    it('mutar a entidade sem save não altera o que está gravado', async () => {
      const sub = await h.criarSubscriber();
      const checkIn = abrir(sub);
      await h.repo.save(checkIn);
      checkIn.responder({ rendaReal: 1, gastoReal: 1, guardadoReal: 1 }, depois);
      checkIn.marcarEnviado(depois);

      const lido = await h.repo.findByCompetencia(sub, '2026-09');
      expect(lido?.respondido).toBe(false);
      expect(lido?.enviadoEm).toBeNull();
      lido?.responder({ rendaReal: 2, gastoReal: 2, guardadoReal: 2 }, depois);
      expect((await h.repo.findByCompetencia(sub, '2026-09'))?.rendaReal).toBeNull();
    });

    it('mesma competência pra mesma pessoa com outro id → ConflictError e o gravado continua intacto', async () => {
      const sub = await h.criarSubscriber();
      const original = abrir(sub);
      await h.repo.save(original);

      const duplicado = abrir(sub);
      duplicado.responder({ rendaReal: 10, gastoReal: 10, guardadoReal: 10 }, agora);
      await expect(h.repo.save(duplicado)).rejects.toBeInstanceOf(ConflictError);

      const lido = await h.repo.findByCompetencia(sub, '2026-09');
      expect(lido?.id).toBe(original.id);
      expect(lido?.respondido).toBe(false);
    });

    it('mesma competência em pessoas diferentes não colide', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await h.repo.save(abrir(a));
      await expect(h.repo.save(abrir(b))).resolves.toBeUndefined();
    });

    it('inserir pra subscriber que não existe (conta excluída) → BusinessRuleError e nada gravado', async () => {
      const inexistente = novoId();
      await expect(h.repo.save(abrir(inexistente))).rejects.toBeInstanceOf(BusinessRuleError);
      expect(await h.repo.findByCompetencia(inexistente, '2026-09')).toBeNull();
    });

    it('claimSend: a primeira reserva vale, a segunda devolve false e não troca a data', async () => {
      const sub = await h.criarSubscriber();
      const checkIn = abrir(sub);
      await h.repo.save(checkIn);

      expect(await h.repo.claimSend(checkIn.id, agora)).toBe(true);
      expect(await h.repo.claimSend(checkIn.id, depois)).toBe(false);
      expect((await h.repo.findByCompetencia(sub, '2026-09'))?.enviadoEm).toEqual(agora);
    });

    it('claimSend: duas execuções leram a linha antes de reservar → só uma reserva', async () => {
      const sub = await h.criarSubscriber();
      await h.repo.save(abrir(sub));
      const daPrimeira = await h.repo.findByCompetencia(sub, '2026-09');
      const daSegunda = await h.repo.findByCompetencia(sub, '2026-09');
      expect(daPrimeira?.enviadoEm).toBeNull();
      expect(daSegunda?.enviadoEm).toBeNull();

      const resultados = [await h.repo.claimSend(daPrimeira!.id, agora), await h.repo.claimSend(daSegunda!.id, agora)];
      expect(resultados).toEqual([true, false]);
    });

    it('claimSend mexe só naquele check-in; id inexistente devolve false', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      const setembro = abrir(a, '2026-09');
      await h.repo.save(setembro);
      await salvarMeses(a, ['2026-08']);
      await salvarMeses(b, ['2026-09']);

      expect(await h.repo.claimSend(setembro.id, agora)).toBe(true);
      expect(await h.repo.claimSend(novoId(), agora)).toBe(false);
      expect((await h.repo.findByCompetencia(a, '2026-08'))?.enviadoEm).toBeNull();
      expect((await h.repo.findByCompetencia(b, '2026-09'))?.enviadoEm).toBeNull();
    });

    it('releaseSendClaim desfaz a reserva e permite reservar de novo', async () => {
      const sub = await h.criarSubscriber();
      const checkIn = abrir(sub);
      await h.repo.save(checkIn);
      await h.repo.claimSend(checkIn.id, agora);

      await h.repo.releaseSendClaim(checkIn.id);
      expect((await h.repo.findByCompetencia(sub, '2026-09'))?.enviadoEm).toBeNull();

      expect(await h.repo.claimSend(checkIn.id, depois)).toBe(true);
      expect((await h.repo.findByCompetencia(sub, '2026-09'))?.enviadoEm).toEqual(depois);
    });

    it('releaseSendClaim de id inexistente ou sem reserva não falha', async () => {
      const sub = await h.criarSubscriber();
      const checkIn = abrir(sub);
      await h.repo.save(checkIn);
      await expect(h.repo.releaseSendClaim(novoId())).resolves.toBeUndefined();
      await expect(h.repo.releaseSendClaim(checkIn.id)).resolves.toBeUndefined();
      expect((await h.repo.findByCompetencia(sub, '2026-09'))?.enviadoEm).toBeNull();
    });

    it('list: do mês mais recente pro mais antigo, paginada por cursor, só os da pessoa', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      // gravados fora de ordem, virando o ano e todos com o mesmo criadoEm: a ordem é pela competência
      await salvarMeses(a, ['2026-01', '2025-12', '2026-09', '2025-02', '2026-10']);
      await salvarMeses(b, ['2026-08', '2026-07', '2025-11']);

      const p1 = await h.repo.list(a, { limit: 2 });
      expect(competencias(p1.items)).toEqual(['2026-10', '2026-09']);
      expect(p1.nextCursor).not.toBeNull();

      const p2 = await h.repo.list(a, { limit: 2, cursor: p1.nextCursor });
      expect(competencias(p2.items)).toEqual(['2026-01', '2025-12']);

      const p3 = await h.repo.list(a, { limit: 2, cursor: p2.nextCursor });
      expect(competencias(p3.items)).toEqual(['2025-02']);
      expect(p3.nextCursor).toBeNull();

      expect([...p1.items, ...p2.items, ...p3.items].every((c) => c.subscriberId === a)).toBe(true);
    });

    it('list é estável: mês novo gravado entre as páginas não repete nem pula item', async () => {
      const sub = await h.criarSubscriber();
      await salvarMeses(sub, ['2026-06', '2026-07', '2026-08', '2026-09']);

      const p1 = await h.repo.list(sub, { limit: 2 });
      await salvarMeses(sub, ['2026-10']);
      const p2 = await h.repo.list(sub, { limit: 2, cursor: p1.nextCursor });

      expect(competencias(p1.items)).toEqual(['2026-09', '2026-08']);
      expect(competencias(p2.items)).toEqual(['2026-07', '2026-06']);
      expect(p2.nextCursor).toBeNull();
    });

    it('list: página exata não promete próxima; sem check-ins devolve vazio', async () => {
      const [a, b] = [await h.criarSubscriber(), await h.criarSubscriber()];
      await salvarMeses(a, ['2026-08', '2026-09']);
      expect(await h.repo.list(a, { limit: 2 })).toMatchObject({ nextCursor: null });
      expect(await h.repo.list(b, { limit: 10 })).toEqual({ items: [], nextCursor: null });
    });

    it('list com cursor de um mês sem check-in continua do mês anterior a ele', async () => {
      const sub = await h.criarSubscriber();
      await salvarMeses(sub, ['2026-05', '2026-09']);
      const page = await h.repo.list(sub, { limit: 10, cursor: encodeCursor('2026-07') });
      expect(competencias(page.items)).toEqual(['2026-05']);
    });

    it.each(['lixo!!', encodeCursor('abc'), encodeCursor('2026-13'), encodeCursor('2026-9'), encodeCursor('1999-12')])(
      'list com cursor ilegível %j → ValidationError',
      async (cursor) => {
        const sub = await h.criarSubscriber();
        await salvarMeses(sub, ['2026-09']);
        await expect(h.repo.list(sub, { limit: 10, cursor })).rejects.toBeInstanceOf(ValidationError);
      },
    );

    it('deleteAllBySubscriber apaga só os daquela pessoa; sem check-ins não falha', async () => {
      const [a, b, c] = [await h.criarSubscriber(), await h.criarSubscriber(), await h.criarSubscriber()];
      await salvarMeses(a, ['2026-08', '2026-09']);
      await salvarMeses(b, ['2026-09']);

      await h.repo.deleteAllBySubscriber(a);
      await expect(h.repo.deleteAllBySubscriber(c)).resolves.toBeUndefined();

      expect(await h.repo.list(a, { limit: 10 })).toEqual({ items: [], nextCursor: null });
      expect(competencias((await h.repo.list(b, { limit: 10 })).items)).toEqual(['2026-09']);
      // o mês apagado pode ser aberto de novo
      await expect(h.repo.save(abrir(a, '2026-09'))).resolves.toBeUndefined();
    });
  });
}
