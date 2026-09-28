import { beforeEach, describe, expect, it } from 'vitest';
import { encodeCursor } from '../../../../shared/application/pagination';
import { ConflictError, ValidationError } from '../../../../shared/domain/errors';
import { PREFIXO_TOKEN_CONSUMIDO, Subscriber } from '../../domain/subscriber';
import type { SubscribersRepository } from '../../domain/subscribers-repository';

/*
  Contrato de SubscribersRepository: o mesmo comportamento pra qualquer
  implementação. Roda contra a versão em memória (in-memory-subscribers-repository.test.ts)
  e contra a do Prisma num Postgres de verdade (*.integration.test.ts).

  Subscriber é a raiz das FKs: nenhum teste aqui precisa de linha auxiliar.
  Corrida de verdade (dois pedidos em paralelo) não entra: o PGlite é uma sessão
  só. Os testes de compare-and-set simulam a corrida intercalando leituras e
  escritas, que é o que o WHERE do banco resolve.
*/

export interface SubscribersRepositoryHarness {
  repo: SubscribersRepository;
}

const agora = new Date('2026-09-17T12:00:00.000Z');
const emQuinzeMin = new Date('2026-09-17T12:15:00.000Z');
const depois = new Date('2026-09-17T12:05:00.000Z');

let sequencia = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++sequencia).padStart(12, '0')}`;

export function describeSubscribersRepositoryContract(nome: string, setup: () => Promise<SubscribersRepositoryHarness>) {
  describe(`SubscribersRepository — ${nome}`, () => {
    let h: SubscribersRepositoryHarness;

    beforeEach(async () => {
      h = await setup();
    });

    const novo = (id = novoId()) =>
      Subscriber.criar({ id, email: `${id}@teste.dindin.dev`, tokenHash: `hash-${id}`, tokenExpiraEm: emQuinzeMin, agora });

    /** grava e já consome o link: ativo e com e-mail verificado, o público do e-mail mensal */
    const verificado = async (id = novoId()) => {
      const s = novo(id);
      await h.repo.save(s);
      const hash = s.tokenHash;
      s.consumirLinkMagico(depois);
      expect(await h.repo.saveMagicLinkConsumption(s, hash)).toBe(true);
      return s;
    };

    const idsDe = (lista: Subscriber[]) => lista.map((s) => s.id);

    it('save insere e as três buscas devolvem a mesma entidade, datas inclusive', async () => {
      const s = novo();
      await h.repo.save(s);

      expect((await h.repo.findById(s.id))?.toSnapshot()).toEqual(s.toSnapshot());
      expect((await h.repo.findByEmail(s.email))?.toSnapshot()).toEqual(s.toSnapshot());
      expect((await h.repo.findByTokenHash(s.tokenHash))?.toSnapshot()).toEqual(s.toSnapshot());
    });

    it('buscas de quem não existe devolvem null', async () => {
      await h.repo.save(novo());
      expect(await h.repo.findById(novoId())).toBeNull();
      expect(await h.repo.findByEmail('ninguem@teste.dindin.dev')).toBeNull();
      expect(await h.repo.findByTokenHash('hash-que-ninguem-tem')).toBeNull();
    });

    it('cada busca acha a pessoa certa: dado de outra pessoa nunca aparece', async () => {
      const [a, b] = [novo(), novo()];
      await h.repo.save(a);
      await h.repo.save(b);

      expect((await h.repo.findByEmail(b.email))?.id).toBe(b.id);
      expect((await h.repo.findByTokenHash(a.tokenHash))?.id).toBe(a.id);
      expect((await h.repo.findById(b.id))?.email).toBe(b.email);
    });

    it('save atualiza a mesma linha: link novo troca o hash e o antigo deixa de achar', async () => {
      const s = novo();
      await h.repo.save(s);
      const hashAntigo = s.tokenHash;
      const novaValidade = new Date('2026-09-18T08:15:00.000Z');
      s.emitirLinkMagico('hash-novo', novaValidade, new Date('2026-09-18T08:00:00.000Z'));
      s.descadastrar(new Date('2026-09-18T08:00:00.000Z'));
      await h.repo.save(s);

      expect(await h.repo.findByTokenHash(hashAntigo)).toBeNull();
      const lido = await h.repo.findByTokenHash('hash-novo');
      expect(lido?.toSnapshot()).toEqual(s.toSnapshot());
      expect(lido?.tokenExpiraEm).toEqual(novaValidade);
      expect(lido?.ativo).toBe(false);
    });

    it('mutar a entidade sem save não altera o que está gravado', async () => {
      const s = novo();
      await h.repo.save(s);
      s.descadastrar(depois);
      s.consumirLinkMagico(depois);
      const lido = await h.repo.findById(s.id);
      expect(lido?.ativo).toBe(true);
      expect(lido?.tokenHash).toBe(`hash-${s.id}`);
      expect(lido?.emailVerificadoEm).toBeNull();
    });

    it('save com e-mail de outra pessoa → ConflictError e a original continua intacta', async () => {
      const a = novo();
      await h.repo.save(a);
      const b = Subscriber.criar({ id: novoId(), email: a.email, tokenHash: 'hash-outro', tokenExpiraEm: emQuinzeMin, agora });

      await expect(h.repo.save(b)).rejects.toBeInstanceOf(ConflictError);
      expect(await h.repo.findById(b.id)).toBeNull();
      expect((await h.repo.findByEmail(a.email))?.id).toBe(a.id);
    });

    it('save com hash de token de outra pessoa → ConflictError', async () => {
      const a = novo();
      await h.repo.save(a);
      const b = Subscriber.criar({
        id: novoId(),
        email: 'outra@teste.dindin.dev',
        tokenHash: a.tokenHash,
        tokenExpiraEm: emQuinzeMin,
        agora,
      });

      await expect(h.repo.save(b)).rejects.toBeInstanceOf(ConflictError);
      expect((await h.repo.findByTokenHash(a.tokenHash))?.id).toBe(a.id);
    });

    it('saveMagicLinkConsumption grava o consumo: e-mail verificado, sem link pendente', async () => {
      const s = novo();
      await h.repo.save(s);
      const hash = s.tokenHash;
      s.consumirLinkMagico(depois);

      expect(await h.repo.saveMagicLinkConsumption(s, hash)).toBe(true);
      expect(await h.repo.findByTokenHash(hash)).toBeNull();
      const lido = await h.repo.findById(s.id);
      expect(lido?.toSnapshot()).toEqual(s.toSnapshot());
      expect(lido?.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}${s.id}`);
      expect(lido?.emailVerificadoEm).toEqual(depois);
      expect(lido?.tokenExpiraEm).toBeNull();
    });

    it('dois consumos do mesmo link: só o primeiro grava', async () => {
      const s = novo();
      await h.repo.save(s);
      const hash = s.tokenHash;
      // dois cliques leram a mesma linha antes de qualquer um gravar
      const primeiro = await h.repo.findByTokenHash(hash);
      const segundo = await h.repo.findByTokenHash(hash);
      primeiro?.consumirLinkMagico(depois);
      segundo?.consumirLinkMagico(new Date('2026-09-17T12:06:00.000Z'));

      expect(await h.repo.saveMagicLinkConsumption(primeiro!, hash)).toBe(true);
      expect(await h.repo.saveMagicLinkConsumption(segundo!, hash)).toBe(false);
      expect(await h.repo.findByTokenHash(hash)).toBeNull();
      expect((await h.repo.findById(s.id))?.emailVerificadoEm).toEqual(depois);
    });

    it('descadastro gravado entre a leitura e o consumo continua valendo', async () => {
      const s = novo();
      await h.repo.save(s);
      const hash = s.tokenHash;
      const doLogin = await h.repo.findByTokenHash(hash);

      const doDescadastro = await h.repo.findById(s.id);
      doDescadastro?.descadastrar(depois);
      await h.repo.save(doDescadastro!);

      doLogin?.consumirLinkMagico(depois);
      expect(await h.repo.saveMagicLinkConsumption(doLogin!, hash)).toBe(true);
      const lido = await h.repo.findById(s.id);
      expect(lido?.ativo).toBe(false);
      expect(lido?.emailVerificadoEm).toEqual(depois);
    });

    it('link novo emitido entre a leitura e o consumo: o consumo do antigo falha e o novo segue valendo', async () => {
      const s = novo();
      await h.repo.save(s);
      const hashAntigo = s.tokenHash;
      const doLogin = await h.repo.findByTokenHash(hashAntigo);

      const doPedido = await h.repo.findById(s.id);
      doPedido?.emitirLinkMagico('hash-novo', new Date('2026-09-17T12:20:00.000Z'), depois);
      await h.repo.save(doPedido!);

      doLogin?.consumirLinkMagico(depois);
      expect(await h.repo.saveMagicLinkConsumption(doLogin!, hashAntigo)).toBe(false);
      expect((await h.repo.findByTokenHash('hash-novo'))?.id).toBe(s.id);
      expect((await h.repo.findById(s.id))?.emailVerificadoEm).toBeNull();
    });

    it('duas pessoas consumindo não colidem no UNIQUE do token', async () => {
      const [a, b] = [await verificado(), await verificado()];
      expect((await h.repo.findById(a.id))?.tokenHash).not.toBe((await h.repo.findById(b.id))?.tokenHash);
    });

    it('saveMagicLinkConsumption de quem não existe (conta excluída) devolve false', async () => {
      const s = novo();
      const hash = s.tokenHash;
      s.consumirLinkMagico(depois);
      expect(await h.repo.saveMagicLinkConsumption(s, hash)).toBe(false);
      expect(await h.repo.findById(s.id)).toBeNull();
    });

    // ── senha ────────────────────────────────────────────────────────────────

    /** conta nova já com senha, como o cadastro grava */
    const comSenha = (id = novoId(), senhaHash = `senha-de-${id}`) =>
      Subscriber.criar({
        id,
        email: `${id}@teste.dindin.dev`,
        tokenHash: `hash-${id}`,
        tokenExpiraEm: emQuinzeMin,
        senhaHash,
        agora,
      });

    it('o hash da senha vai e volta pelas três buscas; conta sem senha volta com null', async () => {
      const [a, b] = [comSenha(), novo()];
      await h.repo.save(a);
      await h.repo.save(b);

      expect((await h.repo.findById(a.id))?.toSnapshot()).toEqual(a.toSnapshot());
      expect((await h.repo.findByEmail(a.email))?.senhaHash).toBe(`senha-de-${a.id}`);
      expect((await h.repo.findByTokenHash(a.tokenHash))?.temSenha).toBe(true);
      expect((await h.repo.findById(b.id))?.senhaHash).toBeNull();
    });

    it('save de uma linha existente não mexe na senha: uma entidade lida antes não desfaz a troca', async () => {
      const s = comSenha();
      await h.repo.save(s);
      const lidaAntes = await h.repo.findById(s.id);

      const trocada = await h.repo.findById(s.id);
      trocada?.definirSenha('senha-trocada', depois);
      expect(await h.repo.savePassword(trocada!)).toBe(true);

      // o descadastro (ou um link novo) grava a linha que leu antes da troca
      lidaAntes?.descadastrar(depois);
      await h.repo.save(lidaAntes!);
      const lido = await h.repo.findById(s.id);
      expect(lido?.ativo).toBe(false);
      expect(lido?.senhaHash).toBe('senha-trocada');
      // e não devolve a validade às sessões que a troca encerrou
      expect(lido?.versaoSessao).toBe(1);
    });

    it('savePassword grava só a senha e atualizadoEm: link pendente e descadastro continuam', async () => {
      const s = comSenha();
      await h.repo.save(s);
      const daTroca = await h.repo.findById(s.id);

      const doPedido = await h.repo.findById(s.id);
      doPedido?.emitirLinkMagico('hash-novo', new Date('2026-09-17T12:20:00.000Z'), depois);
      doPedido?.descadastrar(depois);
      await h.repo.save(doPedido!);

      const quando = new Date('2026-09-17T12:07:00.000Z');
      daTroca?.definirSenha('senha-nova', quando);
      expect(await h.repo.savePassword(daTroca!)).toBe(true);

      const lido = await h.repo.findById(s.id);
      expect(lido?.senhaHash).toBe('senha-nova');
      expect(lido?.versaoSessao).toBe(1);
      expect(lido?.atualizadoEm).toEqual(quando);
      expect(lido?.tokenHash).toBe('hash-novo');
      expect(lido?.ativo).toBe(false);
    });

    it('savePassword cria a primeira senha da conta antiga, e de quem não existe devolve false', async () => {
      const antiga = novo();
      await h.repo.save(antiga);
      antiga.definirSenha('primeira-senha', depois);
      expect(await h.repo.savePassword(antiga)).toBe(true);
      expect((await h.repo.findById(antiga.id))?.senhaHash).toBe('primeira-senha');

      const fantasma = novo();
      fantasma.definirSenha('x', depois);
      expect(await h.repo.savePassword(fantasma)).toBe(false);
      expect(await h.repo.findById(fantasma.id)).toBeNull();
    });

    it('savePasswordReset grava o consumo e a senha juntos', async () => {
      const s = comSenha();
      await h.repo.save(s);
      const hash = s.tokenHash;
      s.consumirLinkMagico(depois);
      s.definirSenha('senha-redefinida', depois);

      expect(await h.repo.savePasswordReset(s, hash)).toBe(true);
      expect(await h.repo.findByTokenHash(hash)).toBeNull();
      const lido = await h.repo.findById(s.id);
      expect(lido?.toSnapshot()).toEqual(s.toSnapshot());
      expect(lido?.senhaHash).toBe('senha-redefinida');
      expect(lido?.versaoSessao).toBe(1);
      expect(lido?.emailVerificadoEm).toEqual(depois);
      expect(lido?.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}${s.id}`);
    });

    it('dois usos do mesmo link de senha nova: só o primeiro grava, e a senha é a dele', async () => {
      const s = comSenha();
      await h.repo.save(s);
      const hash = s.tokenHash;
      const primeiro = await h.repo.findByTokenHash(hash);
      const segundo = await h.repo.findByTokenHash(hash);
      primeiro?.consumirLinkMagico(depois);
      primeiro?.definirSenha('senha-do-primeiro', depois);
      segundo?.consumirLinkMagico(depois);
      segundo?.definirSenha('senha-do-segundo', depois);

      expect(await h.repo.savePasswordReset(primeiro!, hash)).toBe(true);
      expect(await h.repo.savePasswordReset(segundo!, hash)).toBe(false);
      expect((await h.repo.findById(s.id))?.senhaHash).toBe('senha-do-primeiro');
    });

    it('savePasswordReset com o link trocado no meio falha e não muda a senha; o descadastro no meio fica', async () => {
      const s = comSenha();
      await h.repo.save(s);
      const hashAntigo = s.tokenHash;
      const doReset = await h.repo.findByTokenHash(hashAntigo);

      const doDescadastro = await h.repo.findById(s.id);
      doDescadastro?.descadastrar(depois);
      await h.repo.save(doDescadastro!);
      doReset?.consumirLinkMagico(depois);
      doReset?.definirSenha('senha-nova', depois);
      expect(await h.repo.savePasswordReset(doReset!, hashAntigo)).toBe(true);
      expect((await h.repo.findById(s.id))?.ativo).toBe(false);

      const outro = comSenha();
      await h.repo.save(outro);
      const doResetVelho = await h.repo.findByTokenHash(outro.tokenHash);
      const doPedido = await h.repo.findById(outro.id);
      doPedido?.emitirLinkMagico('hash-mais-novo', new Date('2026-09-17T12:20:00.000Z'), depois);
      await h.repo.save(doPedido!);
      doResetVelho?.consumirLinkMagico(depois);
      doResetVelho?.definirSenha('nao-pode-gravar', depois);
      expect(await h.repo.savePasswordReset(doResetVelho!, outro.tokenHash)).toBe(false);
      const lido = await h.repo.findById(outro.id);
      expect(lido?.senhaHash).toBe(`senha-de-${outro.id}`);
      expect(lido?.versaoSessao).toBe(0);
      expect(lido?.tokenHash).toBe('hash-mais-novo');
    });

    it('saveMagicLinkConsumption (confirmar o e-mail) não mexe na senha trocada no meio', async () => {
      const s = comSenha();
      await h.repo.save(s);
      const hash = s.tokenHash;
      const daConfirmacao = await h.repo.findByTokenHash(hash);

      const daTroca = await h.repo.findById(s.id);
      daTroca?.definirSenha('senha-trocada', depois);
      await h.repo.savePassword(daTroca!);

      daConfirmacao?.consumirLinkMagico(depois);
      expect(await h.repo.saveMagicLinkConsumption(daConfirmacao!, hash)).toBe(true);
      const lido = await h.repo.findById(s.id);
      expect(lido?.senhaHash).toBe('senha-trocada');
      expect(lido?.versaoSessao).toBe(1);
      expect(lido?.emailVerificadoEm).toEqual(depois);
    });

    it('a versão das sessões vai e volta pelas buscas: nasce 0 e sobe com cada senha gravada', async () => {
      const s = comSenha();
      await h.repo.save(s);
      expect((await h.repo.findById(s.id))?.versaoSessao).toBe(0);
      for (const esperada of [1, 2]) {
        const lida = await h.repo.findById(s.id);
        lida?.definirSenha(`senha-${esperada}`, depois);
        expect(await h.repo.savePassword(lida!)).toBe(true);
        expect((await h.repo.findByEmail(s.email))?.versaoSessao).toBe(esperada);
      }
    });

    // ── exclusão e e-mail mensal ─────────────────────────────────────────────

    it('delete remove só aquela pessoa e é idempotente', async () => {
      const [a, b] = [novo(), novo()];
      await h.repo.save(a);
      await h.repo.save(b);

      await h.repo.delete(a.id);
      await expect(h.repo.delete(a.id)).resolves.toBeUndefined();
      await expect(h.repo.delete(novoId())).resolves.toBeUndefined();

      expect(await h.repo.findById(a.id)).toBeNull();
      expect(await h.repo.findByEmail(a.email)).toBeNull();
      expect((await h.repo.findById(b.id))?.email).toBe(b.email);
    });

    it('depois do delete, o mesmo e-mail pode se cadastrar de novo', async () => {
      const a = novo();
      await h.repo.save(a);
      await h.repo.delete(a.id);
      const b = Subscriber.criar({ id: novoId(), email: a.email, tokenHash: a.tokenHash, tokenExpiraEm: emQuinzeMin, agora });
      await expect(h.repo.save(b)).resolves.toBeUndefined();
    });

    it('listEmailable traz só ativos com e-mail verificado', async () => {
      const apto = await verificado();
      await h.repo.save(novo()); // nunca confirmou o e-mail
      const descadastrado = await verificado();
      descadastrado.descadastrar(depois);
      await h.repo.save(descadastrado);

      const pagina = await h.repo.listEmailable({ limit: 20 });
      expect(idsDe(pagina.items)).toEqual([apto.id]);
      expect(pagina.nextCursor).toBeNull();
    });

    it('listEmailable ordena por id, não pela ordem de inserção nem por criadoEm (todos iguais)', async () => {
      const ids = [novoId(), novoId(), novoId()];
      for (const id of [...ids].reverse()) await verificado(id);

      expect(idsDe((await h.repo.listEmailable({ limit: 20 })).items)).toEqual(ids);
    });

    it('listEmailable pagina respeitando o limite, sem repetir nem pular, e termina com nextCursor null', async () => {
      const ids = [novoId(), novoId(), novoId(), novoId(), novoId()];
      for (const id of [...ids].reverse()) await verificado(id);

      const p1 = await h.repo.listEmailable({ limit: 2 });
      const p2 = await h.repo.listEmailable({ limit: 2, cursor: p1.nextCursor });
      const p3 = await h.repo.listEmailable({ limit: 2, cursor: p2.nextCursor });

      expect(idsDe(p1.items)).toEqual(ids.slice(0, 2));
      expect(idsDe(p2.items)).toEqual(ids.slice(2, 4));
      expect(idsDe(p3.items)).toEqual(ids.slice(4));
      expect(p1.nextCursor).not.toBeNull();
      expect(p3.nextCursor).toBeNull();
    });

    it('listEmailable com página exatamente cheia no fim: nextCursor null, sem página vazia a mais', async () => {
      const ids = [novoId(), novoId()];
      for (const id of ids) await verificado(id);

      const pagina = await h.repo.listEmailable({ limit: 2 });
      expect(idsDe(pagina.items)).toEqual(ids);
      expect(pagina.nextCursor).toBeNull();
    });

    it('listEmailable é estável: mudanças antes do cursor não repetem nem pulam ninguém', async () => {
      const ids = [novoId(), novoId(), novoId(), novoId()];
      for (const id of ids.slice(1)) await verificado(id);

      const p1 = await h.repo.listEmailable({ limit: 2 });
      expect(idsDe(p1.items)).toEqual(ids.slice(1, 3));

      // entre uma página e outra: alguém com id menor confirma o e-mail e alguém já listado se descadastra
      await verificado(ids[0]);
      const jaListado = await h.repo.findById(ids[1]);
      jaListado?.descadastrar(depois);
      await h.repo.save(jaListado!);

      const p2 = await h.repo.listEmailable({ limit: 2, cursor: p1.nextCursor });
      expect(idsDe(p2.items)).toEqual(ids.slice(3));
      expect(p2.nextCursor).toBeNull();
    });

    it('listEmailable sem ninguém apto devolve página vazia', async () => {
      await h.repo.save(novo());
      expect(await h.repo.listEmailable({ limit: 20 })).toEqual({ items: [], nextCursor: null });
    });

    it('listEmailable com limite fora da faixa não quebra a paginação', async () => {
      const ids = [novoId(), novoId()];
      for (const id of ids) await verificado(id);

      const pagina = await h.repo.listEmailable({ limit: 0 });
      expect(idsDe(pagina.items)).toEqual(ids.slice(0, 1));
      expect(pagina.nextCursor).not.toBeNull();
    });

    it.each([
      ['lixo com símbolo', 'lixo!!'],
      ['id longo demais', encodeCursor('x'.repeat(65))],
    ])('listEmailable com cursor inválido (%s) → ValidationError', async (_caso, cursor) => {
      await expect(h.repo.listEmailable({ limit: 20, cursor })).rejects.toBeInstanceOf(ValidationError);
    });
  });
}
