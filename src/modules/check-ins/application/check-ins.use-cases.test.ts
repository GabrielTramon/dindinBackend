import { beforeEach, describe, expect, it } from 'vitest';
import { encodeCursor, type Page, type PageRequest } from '../../../shared/application/pagination';
import type { EmailMessage } from '../../../shared/application/ports';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors';
import { FixedClock, InMemoryMailer, SequentialIdGenerator } from '../../../shared/infra/in-memory/doubles';
import { JwtAuthTokenService } from '../../../shared/infra/security/jwt-auth-token-service';
import { gerarPlano } from '../../../shared/motor/motor';
import { Subscriber } from '../../identidade';
import { InMemorySubscribersRepository } from '../../identidade/infra';
import { VersaoPlano, type PerfilDoMotor } from '../../planos';
import { InMemoryVersoesPlanoRepository } from '../../planos/infra';
import { CheckIn } from '../domain/check-in';
import { InMemoryCheckInsRepository } from '../infra/database/in-memory-check-ins-repository';
import { AbrirCheckInsDoMesUseCase, type RelatorioAberturaCheckIns } from './abrir-check-ins-do-mes.use-case';
import { assuntoCheckInMensal, emailCheckInMensal, MESES_POR_EXTENSO } from './emails/check-in-mensal';
import { ListarCheckInsUseCase } from './listar-check-ins.use-case';
import { ObterCheckInUseCase } from './obter-check-in.use-case';
import { ResponderCheckInUseCase, TENTATIVAS_DE_RESPONDER } from './responder-check-in.use-case';

/** CLT de 24 anos, aluguel, cartão rodando. */
const ANA: PerfilDoMotor = {
  rendaMensal: 3200,
  tipoRenda: 'clt',
  idade: 24,
  moradia: 'aluguel',
  custoMoradia: 1100,
  gastosFixos: [
    { categoria: 'mercado', valor: 650 },
    { categoria: 'internet', valor: 99.9 },
  ],
  dividas: [{ tipo: 'rotativo', saldo: 1800, parcela: 150 }],
  guardado: 400,
};

/** Gasta mais do que ganha: o plano vem em modo corte, com aporte 0. */
const EM_CORTE: PerfilDoMotor = {
  rendaMensal: 1900,
  tipoRenda: 'informal',
  idade: 19,
  moradia: 'dividido',
  custoMoradia: 1200,
  gastosFixos: [
    { categoria: 'celular', valor: 60 },
    { categoria: 'combustivel', valor: 700 },
  ],
  dividas: [],
  guardado: 0,
};

const APP_URL = 'https://dindin.test';
const MINUTO = 60_000;
/** setembro ainda corre em São Paulo: dá pra responder setembro, outubro é futuro */
const EM_SETEMBRO = '2026-09-17T12:00:00.000Z';
/** 00:30 de 1º de outubro em Brasília: o horário do job */
const JOB_DO_DIA_1 = '2026-10-01T03:30:00.000Z';

let clock: FixedClock;
let ids: SequentialIdGenerator;
let checkIns: InMemoryCheckInsRepository;
let versoesPlano: InMemoryVersoesPlanoRepository;
let subscribers: InMemorySubscribersRepository;
let mailer: MailerQueFalhaPara;
let authTokens: JwtAuthTokenService;

beforeEach(() => {
  clock = new FixedClock(EM_SETEMBRO);
  ids = new SequentialIdGenerator('checkin');
  subscribers = new InMemorySubscribersRepository();
  checkIns = new InMemoryCheckInsRepository();
  versoesPlano = new InMemoryVersoesPlanoRepository();
  mailer = new MailerQueFalhaPara();
  authTokens = new JwtAuthTokenService(
    {
      secret: 'segredo-dos-check-ins-com-mais-de-trinta-e-dois-caracteres',
      sessionTtlSeconds: 30 * 24 * 3600,
      unsubscribeTtlSeconds: 365 * 24 * 3600,
    },
    clock,
  );
});

/** Envio que falha só pra alguns endereços, enquanto o teste quiser. */
class MailerQueFalhaPara extends InMemoryMailer {
  readonly falharPara = new Set<string>();

  override async send(message: EmailMessage): Promise<void> {
    if (this.falharPara.has(message.to)) throw new Error('caixa de entrada cheia');
    return super.send(message);
  }

  destinatarios(): string[] {
    return this.sent.map((m) => m.to);
  }
}

/** grava uma versão do plano com o resultado do motor, ajustando aporte/livre quando o teste pede */
async function gerarVersao(
  subscriberId: string,
  versao: number,
  perfil: PerfilDoMotor = ANA,
  ajuste: { aporte?: number; livre?: number } = {},
  // a data importa: a comparação usa a versão que valia no mês do check-in
  criadoEm: Date = clock.now(),
): Promise<VersaoPlano> {
  const v = VersaoPlano.criar({
    id: `plano-${subscriberId}-${versao}`,
    subscriberId,
    versao,
    inputSnap: perfil,
    resultado: { ...gerarPlano(structuredClone(perfil)), ...ajuste },
    criadoEm,
  });
  await versoesPlano.save(v);
  return v;
}

/** subscriber gravado como identidade grava: por padrão confirmou o e-mail e está ativo */
async function cadastrar(id: string, { verificado = true, ativo = true } = {}): Promise<Subscriber> {
  const agora = clock.now();
  const s = Subscriber.criar({
    id,
    email: `${id}@teste.dindin.dev`,
    tokenHash: `hash-${id}`,
    tokenExpiraEm: new Date(agora.getTime() + 15 * MINUTO),
    agora,
  });
  if (verificado) s.consumirLinkMagico(agora);
  if (!ativo) s.descadastrar(agora);
  await subscribers.save(s);
  return s;
}

describe('ResponderCheckInUseCase', () => {
  const responder = (repo: InMemoryCheckInsRepository = checkIns) =>
    new ResponderCheckInUseCase(repo, versoesPlano, ids, clock);

  const resposta = { rendaReal: 3200, gastoReal: 2500.5, guardadoReal: 699.5 };

  it('sem check-in aberto: abre e responde; sem plano, a comparação é null', async () => {
    const { checkIn, comparacao } = await responder().execute({ subscriberId: 'sub-1', competencia: '2026-09', ...resposta });

    expect(checkIn.toSnapshot()).toEqual({
      id: 'checkin-1',
      subscriberId: 'sub-1',
      competencia: '2026-09',
      ...resposta,
      enviadoEm: null,
      respondidoEm: clock.now(),
      criadoEm: clock.now(),
    });
    expect(comparacao).toBeNull();
    expect((await checkIns.findByCompetencia('sub-1', '2026-09'))?.toSnapshot()).toEqual(checkIn.toSnapshot());
  });

  it('responde em cima do check-in que o job abriu e enviou, sem criar outro', async () => {
    const doJob = CheckIn.abrir({ id: 'do-job', subscriberId: 'sub-1', competencia: '2026-08', agora: clock.now() });
    await checkIns.save(doJob);
    await checkIns.claimSend(doJob.id, clock.now());

    clock.advance(60 * MINUTO);
    const { checkIn } = await responder().execute({ subscriberId: 'sub-1', competencia: '2026-08', ...resposta });

    expect(checkIn.id).toBe('do-job');
    expect(checkIn.respondidoEm).toEqual(clock.now());
    expect((await checkIns.findByCompetencia('sub-1', '2026-08'))?.enviadoEm).not.toBeNull();
    expect((await checkIns.list('sub-1', { limit: 10 })).items).toHaveLength(1);
  });

  it('responder de novo corrige: mesmo check-in, valores e respondidoEm novos', async () => {
    await responder().execute({ subscriberId: 'sub-1', competencia: '2026-09', ...resposta });
    clock.advance(24 * 60 * MINUTO);
    const { checkIn } = await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-09',
      rendaReal: 3300,
      gastoReal: 2600,
      guardadoReal: 700,
    });

    const lido = await checkIns.findByCompetencia('sub-1', '2026-09');
    expect(lido?.id).toBe(checkIn.id);
    expect(lido?.toSnapshot()).toMatchObject({ rendaReal: 3300, gastoReal: 2600, guardadoReal: 700, respondidoEm: clock.now() });
  });

  it('compara com a versão que valia no mês: guardou mais → diferença positiva e cumpriu', async () => {
    // as duas nasceram dentro de setembro; a que vale pro mês é a mais nova
    await gerarVersao('sub-1', 1, ANA, { aporte: 100, livre: 50 }, new Date('2026-09-02T12:00:00.000Z'));
    await gerarVersao('sub-1', 2, ANA, { aporte: 500.3, livre: 300.2 });

    const { comparacao } = await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-09',
      rendaReal: 3200,
      gastoReal: 2300,
      guardadoReal: 600,
    });
    expect(comparacao).toEqual({
      aportePlanejado: 500.3,
      livrePlanejado: 300.2,
      guardadoReal: 600,
      diferenca: 99.7,
      cumpriu: true,
      versaoDoPlano: 2,
    });
  });

  it('plano gravado depois do mês não vale pra ele: agosto é julgado pelo plano de agosto', async () => {
    await gerarVersao('sub-1', 1, ANA, { aporte: 400, livre: 200 }, new Date('2026-08-05T12:00:00.000Z'));
    // em setembro a pessoa trocou o ritmo e o recálculo gravou a versão 2
    await gerarVersao('sub-1', 2, ANA, { aporte: 900, livre: 100 });

    const { comparacao } = await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-08',
      rendaReal: 3200,
      gastoReal: 2700,
      guardadoReal: 500,
    });
    expect(comparacao).toMatchObject({ aportePlanejado: 400, diferenca: 100, cumpriu: true, versaoDoPlano: 1 });
  });

  it('quem se cadastrou depois do mês perguntado compara com a versão mais antiga, não com null', async () => {
    // cadastro em setembro; o e-mail do dia 1º pede o check-in de agosto
    await gerarVersao('sub-1', 1, ANA, { aporte: 400, livre: 200 });

    const { comparacao } = await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-08',
      rendaReal: 3200,
      gastoReal: 2900,
      guardadoReal: 300,
    });
    expect(comparacao).toMatchObject({ aportePlanejado: 400, diferenca: -100, cumpriu: false, versaoDoPlano: 1 });
  });

  it('guardou menos: diferença negativa com 2 casas (sem lixo de ponto flutuante) e não cumpriu', async () => {
    await gerarVersao('sub-1', 1, ANA, { aporte: 500.3 });
    const { comparacao } = await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-09',
      rendaReal: 3200,
      gastoReal: 2699.9,
      guardadoReal: 500.1,
    });
    // 500.1 - 500.3 = -0.19999999999998863 em ponto flutuante
    expect(comparacao).toMatchObject({ diferenca: -0.2, cumpriu: false });
  });

  it('guardou exatamente o planejado: diferença 0 (não −0) e cumpriu', async () => {
    await gerarVersao('sub-1', 1, ANA, { aporte: 19.99 });
    const { comparacao } = await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-09',
      rendaReal: 100,
      gastoReal: 80.01,
      guardadoReal: 19.99,
    });
    expect(Object.is(comparacao?.diferenca, 0)).toBe(true);
    expect(comparacao?.cumpriu).toBe(true);
  });

  it('modo corte: o plano não pede aporte, então qualquer valor guardado cumpre — inclusive 0', async () => {
    const plano = await gerarVersao('sub-1', 1, EM_CORTE);
    expect(plano.resultado.modoCorte).toBe(true);
    expect(plano.resultado.aporte).toBe(0);

    const { comparacao } = await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-09',
      rendaReal: 1900,
      gastoReal: 1900,
      guardadoReal: 0,
    });
    expect(comparacao).toEqual({
      aportePlanejado: 0,
      livrePlanejado: 0,
      guardadoReal: 0,
      diferenca: 0,
      cumpriu: true,
      versaoDoPlano: 1,
    });
  });

  it('plano de outra pessoa não entra na comparação', async () => {
    await gerarVersao('sub-2', 1);
    const { comparacao } = await responder().execute({ subscriberId: 'sub-1', competencia: '2026-09', ...resposta });
    expect(comparacao).toBeNull();
  });

  it('mês futuro → ValidationError no campo competencia e nada é gravado', async () => {
    await expect(
      responder().execute({ subscriberId: 'sub-1', competencia: '2026-10', ...resposta }),
    ).rejects.toThrow(new ValidationError('Esse mês ainda não chegou', { competencia: 'Esse mês ainda não chegou' }));
    expect(await checkIns.findByCompetencia('sub-1', '2026-10')).toBeNull();
  });

  it.each(['2026-9', '2026-13', 'setembro', ''])('competência inválida %j → ValidationError antes de consultar', async (competencia) => {
    await expect(responder().execute({ subscriberId: 'sub-1', competencia, ...resposta })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('valor inválido → ValidationError e o check-in aberto pelo job continua sem resposta', async () => {
    await checkIns.save(CheckIn.abrir({ id: 'do-job', subscriberId: 'sub-1', competencia: '2026-09', agora: clock.now() }));
    await expect(
      responder().execute({ subscriberId: 'sub-1', competencia: '2026-09', rendaReal: 10, gastoReal: 10, guardadoReal: 1.005 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await checkIns.findByCompetencia('sub-1', '2026-09'))?.respondido).toBe(false);
  });

  it('dono vem de quem chama: a resposta de sub-2 no mesmo mês não toca a de sub-1', async () => {
    await responder().execute({ subscriberId: 'sub-1', competencia: '2026-09', ...resposta });
    await responder().execute({ subscriberId: 'sub-2', competencia: '2026-09', rendaReal: 1, gastoReal: 1, guardadoReal: 0 });

    expect((await checkIns.findByCompetencia('sub-1', '2026-09'))?.rendaReal).toBe(3200);
    expect((await checkIns.findByCompetencia('sub-2', '2026-09'))?.rendaReal).toBe(1);
  });

  it('corrida com o job: ele abre entre a nossa busca e o nosso insert → respondemos em cima do dele', async () => {
    const repo = new CheckInsComCorrida(async (nosso) => {
      const doJob = CheckIn.abrir({ id: 'do-job', subscriberId: nosso.subscriberId, competencia: nosso.competencia, agora: clock.now() });
      await repo.inserirDireto(doJob);
      await repo.claimSend(doJob.id, clock.now());
    });

    const { checkIn } = await responder(repo).execute({ subscriberId: 'sub-1', competencia: '2026-09', ...resposta });

    expect(checkIn.id).toBe('do-job');
    expect(repo.saves).toBe(2);
    const lido = await repo.findByCompetencia('sub-1', '2026-09');
    expect(lido?.toSnapshot()).toMatchObject({ id: 'do-job', ...resposta, respondidoEm: clock.now() });
    // a reserva do job continua: o e-mail não sai de novo
    expect(lido?.enviadoEm).toEqual(clock.now());
  });

  it(`conflito nas ${TENTATIVAS_DE_RESPONDER} tentativas → ConflictError pra tentar de novo`, async () => {
    const repo = new CheckInsSempreEmConflito();
    await expect(
      responder(repo).execute({ subscriberId: 'sub-1', competencia: '2026-09', ...resposta }),
    ).rejects.toThrow(new ConflictError('Outra resposta desse mês estava sendo gravada. Tente de novo.'));
    expect(repo.saves).toBe(TENTATIVAS_DE_RESPONDER);
  });

  it('erro que não é conflito sobe na hora, sem nova tentativa', async () => {
    const repo = new CheckInsSempreEmConflito(new Error('conexão perdida'));
    await expect(
      responder(repo).execute({ subscriberId: 'sub-1', competencia: '2026-09', ...resposta }),
    ).rejects.toThrow('conexão perdida');
    expect(repo.saves).toBe(1);
  });
});

/** Na primeira inserção, deixa "outra requisição" agir antes — o nosso insert bate na unique. */
class CheckInsComCorrida extends InMemoryCheckInsRepository {
  saves = 0;
  private antes: ((nosso: CheckIn) => Promise<void>) | null;

  constructor(antes: (nosso: CheckIn) => Promise<void>) {
    super();
    this.antes = antes;
  }

  inserirDireto(checkIn: CheckIn): Promise<void> {
    return super.save(checkIn);
  }

  override async save(checkIn: CheckIn): Promise<void> {
    this.saves++;
    const antes = this.antes;
    this.antes = null;
    if (antes) await antes(checkIn);
    return super.save(checkIn);
  }
}

/** Todo save falha (conflito, por padrão) e a busca nunca acha nada. */
class CheckInsSempreEmConflito extends InMemoryCheckInsRepository {
  saves = 0;

  constructor(private readonly erro: Error = new ConflictError('Já existe um check-in desse mês.')) {
    super();
  }

  override async findByCompetencia(): Promise<CheckIn | null> {
    return null;
  }

  override async save(): Promise<void> {
    this.saves++;
    throw this.erro;
  }
}

describe('ObterCheckInUseCase', () => {
  const obter = () => new ObterCheckInUseCase(checkIns, versoesPlano);
  const responder = () => new ResponderCheckInUseCase(checkIns, versoesPlano, ids, clock);

  it('devolve o mês respondido com a comparação do plano atual', async () => {
    await gerarVersao('sub-1', 1, ANA, { aporte: 400, livre: 200 });
    await responder().execute({ subscriberId: 'sub-1', competencia: '2026-09', rendaReal: 3000, gastoReal: 2650, guardadoReal: 350 });

    const { checkIn, comparacao } = await obter().execute({ subscriberId: 'sub-1', competencia: '2026-09' });
    expect(checkIn.guardadoReal).toBe(350);
    expect(comparacao).toEqual({
      aportePlanejado: 400,
      livrePlanejado: 200,
      guardadoReal: 350,
      diferenca: -50,
      cumpriu: false,
      versaoDoPlano: 1,
    });
  });

  it('trocar o ritmo em setembro não reescreve agosto: reler o mês dá o veredito idêntico', async () => {
    await gerarVersao('sub-1', 1, ANA, { aporte: 400, livre: 200 }, new Date('2026-08-05T12:00:00.000Z'));
    await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-08',
      rendaReal: 3200,
      gastoReal: 2800,
      guardadoReal: 400,
    });
    const naHora = await obter().execute({ subscriberId: 'sub-1', competencia: '2026-08' });
    expect(naHora.comparacao).toMatchObject({ aportePlanejado: 400, cumpriu: true, versaoDoPlano: 1 });

    // a pessoa troca o ritmo pra acelerado e o recálculo grava a versão 2
    await gerarVersao('sub-1', 2, ANA, { aporte: 900, livre: 100 });

    const depois = await obter().execute({ subscriberId: 'sub-1', competencia: '2026-08' });
    expect(depois.comparacao).toEqual(naHora.comparacao);
    // setembro, esse sim, passa a ser medido pelo plano novo
    const setembro = await responder().execute({
      subscriberId: 'sub-1',
      competencia: '2026-09',
      rendaReal: 3200,
      gastoReal: 2300,
      guardadoReal: 900,
    });
    expect(setembro.comparacao).toMatchObject({ aportePlanejado: 900, cumpriu: true, versaoDoPlano: 2 });
  });

  it('aberto e sem resposta: o planejado vem; real, diferença e cumpriu ficam null', async () => {
    // plano gerado só em setembro: agosto cai no fallback e compara com a versão mais antiga
    await gerarVersao('sub-1', 1, ANA, { aporte: 400, livre: 200 });
    await checkIns.save(CheckIn.abrir({ id: 'do-job', subscriberId: 'sub-1', competencia: '2026-08', agora: clock.now() }));

    const { comparacao } = await obter().execute({ subscriberId: 'sub-1', competencia: '2026-08' });
    expect(comparacao).toEqual({
      aportePlanejado: 400,
      livrePlanejado: 200,
      guardadoReal: null,
      diferenca: null,
      cumpriu: null,
      versaoDoPlano: 1,
    });
  });

  it('de outra pessoa ou inexistente → NotFound com a mensagem da tela', async () => {
    await responder().execute({ subscriberId: 'sub-1', competencia: '2026-09', rendaReal: 1, gastoReal: 1, guardadoReal: 0 });

    await expect(obter().execute({ subscriberId: 'sub-2', competencia: '2026-09' })).rejects.toThrow(
      new NotFoundError('Você ainda não tem check-in desse mês.'),
    );
    await expect(obter().execute({ subscriberId: 'sub-1', competencia: '2026-08' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('competência inválida → ValidationError', async () => {
    await expect(obter().execute({ subscriberId: 'sub-1', competencia: '2026-13' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ListarCheckInsUseCase', () => {
  const listar = () => new ListarCheckInsUseCase(checkIns);

  it('pagina do mês mais recente pro mais antigo, só os da pessoa', async () => {
    for (const competencia of ['2026-07', '2026-09', '2026-08']) {
      await checkIns.save(CheckIn.abrir({ id: `a-${competencia}`, subscriberId: 'sub-1', competencia, agora: clock.now() }));
    }
    await checkIns.save(CheckIn.abrir({ id: 'b', subscriberId: 'sub-2', competencia: '2026-09', agora: clock.now() }));

    const p1 = await listar().execute({ subscriberId: 'sub-1', limit: 2 });
    expect(p1.items.map((c) => c.competencia)).toEqual(['2026-09', '2026-08']);
    const p2 = await listar().execute({ subscriberId: 'sub-1', limit: 2, cursor: p1.nextCursor });
    expect(p2.items.map((c) => c.competencia)).toEqual(['2026-07']);
    expect(p2.nextCursor).toBeNull();

    expect(await listar().execute({ subscriberId: 'sub-3', limit: 20 })).toEqual({ items: [], nextCursor: null });
  });

  it('cursor ilegível → ValidationError', async () => {
    await expect(
      listar().execute({ subscriberId: 'sub-1', limit: 20, cursor: encodeCursor('2026-13') }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('AbrirCheckInsDoMesUseCase', () => {
  const job = (repo: InMemoryCheckInsRepository = checkIns, subs: InMemorySubscribersRepository = subscribers) =>
    new AbrirCheckInsDoMesUseCase(repo, subs, mailer, authTokens, ids, clock, { appUrl: APP_URL });

  const relatorio = (parcial: Partial<RelatorioAberturaCheckIns>): RelatorioAberturaCheckIns => ({
    competencia: '2026-09',
    abertos: 0,
    jaExistiam: 0,
    enviados: 0,
    jaEnviados: 0,
    falhas: 0,
    ...parcial,
  });

  beforeEach(() => {
    clock.set(JOB_DO_DIA_1);
    // o job lê subscribers de verdade: a FK do check-in também, pra conta excluída no meio
    checkIns = new InMemoryCheckInsRepository({
      subscriberExists: async (id) => (await subscribers.findById(id)) !== null,
    });
  });

  it('só quem confirmou o e-mail e está ativo: abre o mês que acabou, reserva e envia', async () => {
    await cadastrar('sub-a');
    await cadastrar('sub-b', { verificado: false });
    await cadastrar('sub-c', { ativo: false });
    await cadastrar('sub-d');

    expect(await job().execute()).toEqual(relatorio({ abertos: 2, enviados: 2 }));

    expect(mailer.destinatarios()).toEqual(['sub-a@teste.dindin.dev', 'sub-d@teste.dindin.dev']);
    for (const id of ['sub-a', 'sub-d']) {
      expect((await checkIns.findByCompetencia(id, '2026-09'))?.toSnapshot()).toMatchObject({
        competencia: '2026-09',
        enviadoEm: clock.now(),
        respondidoEm: null,
        criadoEm: clock.now(),
      });
    }
    expect(await checkIns.findByCompetencia('sub-b', '2026-09')).toBeNull();
    expect(await checkIns.findByCompetencia('sub-c', '2026-09')).toBeNull();
  });

  it('o e-mail: assunto com o mês por extenso, link do mês e descadastro no fragmento com token de descadastro', async () => {
    await cadastrar('sub-a');
    await job().execute();

    const email = mailer.last();
    expect(email?.subject).toBe('Como foi setembro com o seu dinheiro?');
    expect(email?.text).toContain('https://dindin.test/check-in/2026-09');
    expect(email?.html).toContain('href="https://dindin.test/check-in/2026-09"');

    const token = /\/descadastrar#token=([^\s"<]+)/.exec(email?.text ?? '')?.[1];
    expect(token).toBeDefined();
    expect(authTokens.verifyUnsubscribe(decodeURIComponent(token!))).toEqual({ subscriberId: 'sub-a' });
    // token de descadastro não abre sessão
    expect(authTokens.verifySession(decodeURIComponent(token!))).toBeNull();
    expect(email?.html).toContain(`/descadastrar#token=${token}`);
    // nunca na query: o fragmento não chega em servidor, log nem Referer
    expect(`${email?.text}${email?.html}`).not.toMatch(/[?&]token=/);
  });

  it('duas execuções seguidas: a segunda não abre nem reenvia nada', async () => {
    await cadastrar('sub-a');
    await cadastrar('sub-b');

    expect(await job().execute()).toEqual(relatorio({ abertos: 2, enviados: 2 }));
    clock.advance(10 * MINUTO);
    expect(await job().execute()).toEqual(relatorio({ jaExistiam: 2, jaEnviados: 2 }));
    expect(mailer.sent).toHaveLength(2);
  });

  it('falha de envio no meio: os outros recebem; na execução seguinte quem falhou recebe', async () => {
    await cadastrar('sub-a');
    await cadastrar('sub-b');
    await cadastrar('sub-c');
    mailer.falharPara.add('sub-b@teste.dindin.dev');

    expect(await job().execute()).toEqual(relatorio({ abertos: 3, enviados: 2, falhas: 1 }));
    expect(mailer.destinatarios()).toEqual(['sub-a@teste.dindin.dev', 'sub-c@teste.dindin.dev']);
    // a reserva foi desfeita: sem isso, sub-b nunca receberia o e-mail deste mês
    expect((await checkIns.findByCompetencia('sub-b', '2026-09'))?.enviadoEm).toBeNull();

    mailer.falharPara.clear();
    clock.advance(60 * MINUTO);
    expect(await job().execute()).toEqual(relatorio({ jaExistiam: 3, enviados: 1, jaEnviados: 2 }));
    expect(mailer.destinatarios()).toEqual([
      'sub-a@teste.dindin.dev',
      'sub-c@teste.dindin.dev',
      'sub-b@teste.dindin.dev',
    ]);
    expect((await checkIns.findByCompetencia('sub-b', '2026-09'))?.enviadoEm).toEqual(clock.now());
  });

  it('dia 1 às 02:30 UTC ainda é dia 30 em São Paulo: o "mês que acabou" é agosto', async () => {
    await cadastrar('sub-a');
    clock.set('2026-10-01T02:30:00.000Z');

    expect(await job().execute()).toEqual(relatorio({ competencia: '2026-08', abertos: 1, enviados: 1 }));
    expect(mailer.last()?.subject).toBe('Como foi agosto com o seu dinheiro?');
    expect(await checkIns.findByCompetencia('sub-a', '2026-09')).toBeNull();

    // meia hora depois da meia-noite em Brasília, setembro
    clock.set('2026-10-01T03:30:00.000Z');
    expect(await job().execute()).toMatchObject({ competencia: '2026-09', abertos: 1 });
  });

  it('virada do ano: no 1º de janeiro abre dezembro do ano anterior', async () => {
    await cadastrar('sub-a');
    clock.set('2027-01-01T03:30:00.000Z');
    expect(await job().execute()).toMatchObject({ competencia: '2026-12', abertos: 1, enviados: 1 });
    expect(mailer.last()?.subject).toBe('Como foi dezembro com o seu dinheiro?');
  });

  it('percorre todas as páginas de subscribers', async () => {
    const espiao = new SubscribersEspiao();
    subscribers = espiao;
    for (const id of ['sub-1', 'sub-2', 'sub-3', 'sub-4', 'sub-5']) await cadastrar(id);

    expect(await job(checkIns, espiao).execute({ tamanhoDaPagina: 2 })).toEqual(relatorio({ abertos: 5, enviados: 5 }));
    expect(espiao.paginas.map((p) => p.limit)).toEqual([2, 2, 2]);
    expect(mailer.sent).toHaveLength(5);
  });

  it('quem já respondeu antes do e-mail não recebe', async () => {
    await cadastrar('sub-a');
    await cadastrar('sub-b');
    clock.set('2026-09-30T20:00:00.000Z');
    await new ResponderCheckInUseCase(checkIns, versoesPlano, ids, clock).execute({
      subscriberId: 'sub-a',
      competencia: '2026-09',
      rendaReal: 3000,
      gastoReal: 2500,
      guardadoReal: 500,
    });

    clock.set(JOB_DO_DIA_1);
    expect(await job().execute()).toEqual(relatorio({ abertos: 1, jaExistiam: 1, enviados: 1, jaEnviados: 1 }));
    expect(mailer.destinatarios()).toEqual(['sub-b@teste.dindin.dev']);
  });

  it('outra execução reservou o envio entre a nossa leitura e o claimSend: não envia', async () => {
    await cadastrar('sub-a');
    const repo = new CheckInsComOutraExecucao({ subscriberExists: async () => true });

    expect(await job(repo).execute()).toEqual(relatorio({ abertos: 1, jaEnviados: 1 }));
    expect(mailer.sent).toHaveLength(0);
  });

  it('outra execução abriu o check-in entre a nossa busca e o insert: conta como já existia e envia uma vez', async () => {
    await cadastrar('sub-a');
    const repo = new CheckInsComCorrida(async (nosso) => {
      await repo.inserirDireto(
        CheckIn.abrir({ id: 'da-outra', subscriberId: nosso.subscriberId, competencia: nosso.competencia, agora: clock.now() }),
      );
    });

    expect(await job(repo).execute()).toEqual(relatorio({ jaExistiam: 1, enviados: 1 }));
    expect(mailer.sent).toHaveLength(1);
    expect((await repo.findByCompetencia('sub-a', '2026-09'))?.toSnapshot()).toMatchObject({
      id: 'da-outra',
      enviadoEm: clock.now(),
    });
  });

  it('conta excluída entre a listagem e a abertura: conta como falha e segue pros próximos', async () => {
    const espiao = new SubscribersEspiao();
    subscribers = espiao;
    await cadastrar('sub-a');
    await cadastrar('sub-b');
    await cadastrar('sub-c');
    espiao.excluirDepoisDeListar = ['sub-b'];

    expect(await job(checkIns, espiao).execute()).toEqual(relatorio({ abertos: 2, enviados: 2, falhas: 1 }));
    expect(mailer.destinatarios()).toEqual(['sub-a@teste.dindin.dev', 'sub-c@teste.dindin.dev']);
    expect(await checkIns.findByCompetencia('sub-b', '2026-09')).toBeNull();
  });

  it('erro de banco não é engolido: o job para e a próxima execução continua de onde parou', async () => {
    await cadastrar('sub-a');
    await cadastrar('sub-b');
    const repo = new CheckInsQueCaem({ subscriberExists: async () => true });
    repo.cairNaBuscaDe = 'sub-b';

    await expect(job(repo).execute()).rejects.toThrow('conexão perdida');
    expect(mailer.destinatarios()).toEqual(['sub-a@teste.dindin.dev']);

    repo.cairNaBuscaDe = null;
    expect(await job(repo).execute()).toEqual(relatorio({ abertos: 1, jaExistiam: 1, enviados: 1, jaEnviados: 1 }));
    expect(mailer.destinatarios()).toEqual(['sub-a@teste.dindin.dev', 'sub-b@teste.dindin.dev']);
  });
});

/** Registra cada página pedida e pode excluir contas logo depois de listar (LGPD no meio do job). */
class SubscribersEspiao extends InMemorySubscribersRepository {
  readonly paginas: PageRequest[] = [];
  excluirDepoisDeListar: string[] = [];

  override async listEmailable(page: PageRequest): Promise<Page<Subscriber>> {
    this.paginas.push(page);
    const pagina = await super.listEmailable(page);
    for (const id of this.excluirDepoisDeListar.splice(0)) await this.delete(id);
    return pagina;
  }
}

/** Outra execução do job reserva o envio um instante antes de nós. */
class CheckInsComOutraExecucao extends InMemoryCheckInsRepository {
  override async claimSend(checkInId: string, sentAt: Date): Promise<boolean> {
    await super.claimSend(checkInId, sentAt);
    return super.claimSend(checkInId, sentAt);
  }
}

/** A busca de um subscriber específico falha como se a conexão tivesse caído. */
class CheckInsQueCaem extends InMemoryCheckInsRepository {
  cairNaBuscaDe: string | null = null;

  override async findByCompetencia(subscriberId: string, competencia: string): Promise<CheckIn | null> {
    if (subscriberId === this.cairNaBuscaDe) throw new Error('conexão perdida');
    return super.findByCompetencia(subscriberId, competencia);
  }
}

describe('emailCheckInMensal', () => {
  const email = (competencia: string, appUrl = APP_URL, tokenDescadastro = 'aaa.bbb.ccc') =>
    emailCheckInMensal({ para: 'pessoa@teste.dindin.dev', appUrl, competencia, tokenDescadastro });

  it.each(MESES_POR_EXTENSO.map((mes, i) => [`2026-${String(i + 1).padStart(2, '0')}`, mes]))(
    '%s → "%s" no assunto',
    (competencia, mes) => {
      expect(assuntoCheckInMensal(competencia)).toBe(`Como foi ${mes} com o seu dinheiro?`);
      expect(email(competencia).subject).toBe(`Como foi ${mes} com o seu dinheiro?`);
    },
  );

  it('texto curto: o mês, o link do check-in e o de descadastro; barra no fim da base não duplica', () => {
    const m = email('2026-03', 'https://dindin.test/');
    expect(m.to).toBe('pessoa@teste.dindin.dev');
    expect(m.text).toBe(
      [
        'Oi!',
        '',
        'Março acabou. Leva um minuto: conte quanto entrou, quanto saiu e quanto ficou guardado, e veja se o mês bateu com o seu plano.',
        '',
        'Responder agora:',
        'https://dindin.test/check-in/2026-03',
        '',
        'Não quer mais receber este lembrete? Descadastre-se com um clique:',
        'https://dindin.test/descadastrar#token=aaa.bbb.ccc',
      ].join('\n'),
    );
  });

  it('HTML escapa o que vem de fora e codifica o token no fragmento', () => {
    const m = email('2026-09', 'https://dindin.test/?a=1&b="2"', 'to ken&<x>');
    expect(m.html).toContain('href="https://dindin.test/?a=1&amp;b=&quot;2&quot;/check-in/2026-09"');
    expect(m.html).toContain('#token=to%20ken%26%3Cx%3E');
    expect(m.html).not.toContain('<x>');
  });
});
