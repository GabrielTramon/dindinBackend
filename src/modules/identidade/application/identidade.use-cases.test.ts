import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthTokenService, EmailMessage, IssuedToken } from '../../../shared/application/ports';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../../shared/domain/errors';
import {
  FixedClock,
  InMemoryMailer,
  PredictableSecureTokenGenerator,
  SequentialIdGenerator,
} from '../../../shared/infra/in-memory/doubles';
import { JwtAuthTokenService } from '../../../shared/infra/security/jwt-auth-token-service';
import { PREFIXO_TOKEN_CONSUMIDO, Subscriber } from '../domain/subscriber';
import { InMemorySubscribersRepository } from '../infra/database/in-memory-subscribers-repository';
import { DescadastrarPorTokenUseCase } from './descadastrar-por-token.use-case';
import { DescadastrarUseCase } from './descadastrar.use-case';
import { ASSUNTO_LINK_MAGICO, emailLinkMagico } from './emails/link-magico';
import { ObterMeUseCase } from './obter-me.use-case';
import { ReativarUseCase } from './reativar.use-case';
import { SolicitarLinkMagicoUseCase, type LinkMagicoConfig } from './solicitar-link-magico.use-case';
import { VerificarLinkMagicoUseCase } from './verificar-link-magico.use-case';

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
const config: LinkMagicoConfig = {
  appUrl: 'https://dindin.test',
  magicLinkTtlMinutes: 15,
  linkResendCooldownSeconds: 60,
};

/** Repositório em memória que conta os save() e pode perder o compare-and-set do consumo. */
class RepositorioEspiao extends InMemorySubscribersRepository {
  saves = 0;
  perderConsumo = false;
  /** roda uma vez, logo depois da próxima busca por e-mail: simula outro pedido gravando no meio */
  depoisDaBuscaPorEmail: (() => Promise<void>) | null = null;

  override async save(subscriber: Subscriber): Promise<void> {
    this.saves++;
    return super.save(subscriber);
  }

  override async saveMagicLinkConsumption(subscriber: Subscriber, usedTokenHash: string): Promise<boolean> {
    if (this.perderConsumo) return false;
    return super.saveMagicLinkConsumption(subscriber, usedTokenHash);
  }

  override async findByEmail(email: string): Promise<Subscriber | null> {
    const encontrado = await super.findByEmail(email);
    const noMeio = this.depoisDaBuscaPorEmail;
    this.depoisDaBuscaPorEmail = null;
    if (noMeio) await noMeio();
    return encontrado;
  }
}

let repo: RepositorioEspiao;
let clock: FixedClock;
let mailer: InMemoryMailer;
let secureTokens: PredictableSecureTokenGenerator;
let authTokens: JwtAuthTokenService;
let sessoesEmitidas: string[];
let solicitar: SolicitarLinkMagicoUseCase;
let verificar: VerificarLinkMagicoUseCase;
let obterMe: ObterMeUseCase;
let descadastrar: DescadastrarUseCase;
let reativar: ReativarUseCase;
let descadastrarPorToken: DescadastrarPorTokenUseCase;

beforeEach(() => {
  repo = new RepositorioEspiao();
  clock = new FixedClock();
  mailer = new InMemoryMailer();
  secureTokens = new PredictableSecureTokenGenerator();
  authTokens = new JwtAuthTokenService(
    {
      secret: 'segredo-dos-casos-de-uso-com-mais-de-32-caracteres',
      sessionTtlSeconds: 30 * 24 * 3600,
      unsubscribeTtlSeconds: 365 * 24 * 3600,
    },
    clock,
  );
  sessoesEmitidas = [];
  // conta as sessões emitidas sem mudar o comportamento do serviço de verdade
  const authEspiao: AuthTokenService = {
    issueSession: (subscriberId: string): IssuedToken => {
      sessoesEmitidas.push(subscriberId);
      return authTokens.issueSession(subscriberId);
    },
    verifySession: (token) => authTokens.verifySession(token),
    issueUnsubscribe: (subscriberId) => authTokens.issueUnsubscribe(subscriberId),
    verifyUnsubscribe: (token) => authTokens.verifyUnsubscribe(token),
  };

  solicitar = new SolicitarLinkMagicoUseCase(repo, secureTokens, mailer, clock, new SequentialIdGenerator('sub'), config);
  verificar = new VerificarLinkMagicoUseCase(repo, secureTokens, authEspiao, clock);
  obterMe = new ObterMeUseCase(repo);
  descadastrar = new DescadastrarUseCase(repo, clock);
  reativar = new ReativarUseCase(repo, clock);
  descadastrarPorToken = new DescadastrarPorTokenUseCase(repo, authEspiao, clock);
});

function tokenDo(mensagem: EmailMessage | undefined): string {
  const achado = /#token=([^\s"<]+)/.exec(mensagem?.text ?? '');
  if (!achado?.[1]) throw new Error('e-mail sem link mágico');
  return decodeURIComponent(achado[1]);
}

/** a conta que outro pedido, rodando ao mesmo tempo, cadastrou com um link emitido em `emitidoEm` */
const doOutroPedido = (email: string, emitidoEm: Date) =>
  Subscriber.criar({
    id: 'outro-pedido',
    email,
    tokenHash: 'hash-do-outro',
    tokenExpiraEm: new Date(emitidoEm.getTime() + config.magicLinkTtlMinutes * MINUTO),
    agora: emitidoEm,
  });

/** pede o link e entra: conta com e-mail verificado */
async function entrar(email: string): Promise<Subscriber> {
  await solicitar.execute({ email });
  const { subscriber } = await verificar.execute({ token: tokenDo(mailer.last()) });
  return subscriber;
}

describe('SolicitarLinkMagicoUseCase', () => {
  it('e-mail novo: cadastra com o hash do token, validade da config, e envia o link ao endereço normalizado', async () => {
    await solicitar.execute({ email: '  Pessoa@Exemplo.COM ' });

    const s = await repo.findByEmail('pessoa@exemplo.com');
    expect(s?.toSnapshot()).toEqual({
      id: 'sub-1',
      email: 'pessoa@exemplo.com',
      tokenHash: 'hash(token-1)',
      tokenExpiraEm: new Date('2026-09-17T12:15:00.000Z'),
      emailVerificadoEm: null,
      ativo: true,
      criadoEm: clock.now(),
      atualizadoEm: clock.now(),
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last()?.to).toBe('pessoa@exemplo.com');
    expect(tokenDo(mailer.last())).toBe('token-1');
  });

  it('e-mail inválido → ValidationError, sem gravar nem enviar', async () => {
    await expect(solicitar.execute({ email: 'sem-arroba' })).rejects.toBeInstanceOf(ValidationError);
    expect(repo.saves).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('pedido de novo dentro do intervalo mínimo: não envia nem troca o link', async () => {
    await solicitar.execute({ email: 'a@x.dev' });
    clock.advance(59_999);
    await expect(solicitar.execute({ email: 'a@x.dev' })).resolves.toBeUndefined();

    expect(mailer.sent).toHaveLength(1);
    expect((await repo.findByEmail('a@x.dev'))?.tokenHash).toBe('hash(token-1)');
  });

  it('passado o intervalo: link novo com validade renovada, e o anterior deixa de valer', async () => {
    await solicitar.execute({ email: 'a@x.dev' });
    const primeiro = tokenDo(mailer.last());
    clock.advance(60_000);
    await solicitar.execute({ email: 'a@x.dev' });

    expect(mailer.sent).toHaveLength(2);
    const segundo = tokenDo(mailer.last());
    expect(segundo).not.toBe(primeiro);
    expect((await repo.findByEmail('a@x.dev'))?.tokenExpiraEm).toEqual(new Date(clock.now().getTime() + 15 * MINUTO));
    await expect(verificar.execute({ token: primeiro })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verificar.execute({ token: segundo })).resolves.toBeDefined();
  });

  it('link já usado não conta pro intervalo: quem acabou de entrar pode pedir outro na hora', async () => {
    await entrar('a@x.dev');
    await solicitar.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(2);
  });

  it('conta descadastrada continua recebendo link: descadastro só para o e-mail mensal', async () => {
    const s = await entrar('a@x.dev');
    await descadastrar.execute({ subscriberId: s.id });
    clock.advance(MINUTO);
    await solicitar.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(2);
  });

  it('validade reduzida na config não trava o endereço até a emissão "futura" calculada', async () => {
    const longo = new SolicitarLinkMagicoUseCase(
      repo,
      secureTokens,
      mailer,
      clock,
      new SequentialIdGenerator('sub'),
      { ...config, magicLinkTtlMinutes: 60 },
    );
    await longo.execute({ email: 'a@x.dev' });
    clock.advance(10 * MINUTO);
    // com 15 min, o link de 60 parece emitido daqui a 35 min
    await solicitar.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(2);
  });

  it('corrida no cadastro: outro pedido gravou o mesmo e-mail no meio → segue como existente, sem segundo e-mail', async () => {
    repo.depoisDaBuscaPorEmail = () => repo.save(doOutroPedido('a@x.dev', clock.now()));

    await expect(solicitar.execute({ email: 'a@x.dev' })).resolves.toBeUndefined();

    expect(mailer.sent).toHaveLength(0);
    expect(await repo.findById('sub-1')).toBeNull();
    expect((await repo.findByEmail('a@x.dev'))?.tokenHash).toBe('hash-do-outro');
  });

  it('corrida no cadastro com link antigo do outro lado: reemite pra conta que já existe', async () => {
    const dezMinutosAtras = new Date(clock.now().getTime() - 10 * MINUTO);
    repo.depoisDaBuscaPorEmail = () => repo.save(doOutroPedido('a@x.dev', dezMinutosAtras));

    await solicitar.execute({ email: 'a@x.dev' });

    expect(mailer.sent).toHaveLength(1);
    const { subscriber } = await verificar.execute({ token: tokenDo(mailer.last()) });
    expect(subscriber.id).toBe('outro-pedido');
  });

  it('conflito que não é do e-mail é relançado, sem enviar nada', async () => {
    // outra conta já usa o hash que este pedido vai gerar
    const agora = clock.now();
    await repo.save(
      Subscriber.criar({ id: 'outra', email: 'b@x.dev', tokenHash: 'hash(token-1)', tokenExpiraEm: agora, agora }),
    );
    await expect(solicitar.execute({ email: 'a@x.dev' })).rejects.toBeInstanceOf(ConflictError);
    expect(mailer.sent).toHaveLength(0);
  });

  it('envio falhou: relança, invalida o link recém-emitido e a próxima tentativa envia sem esperar', async () => {
    mailer.failNext = true;
    await expect(solicitar.execute({ email: 'a@x.dev' })).rejects.toThrow('falha simulada de envio');

    const s = await repo.findByEmail('a@x.dev');
    expect(s?.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}sub-1`);
    expect(s?.tokenExpiraEm).toBeNull();
    expect(await repo.findByTokenHash('hash(token-1)')).toBeNull();
    await expect(verificar.execute({ token: 'token-1' })).rejects.toBeInstanceOf(UnauthorizedError);

    await solicitar.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(1);
    await expect(verificar.execute({ token: tokenDo(mailer.last()) })).resolves.toBeDefined();
  });

  it('envio falhou pra conta verificada: a verificação continua e a próxima tentativa envia', async () => {
    const s = await entrar('a@x.dev');
    mailer.failNext = true;
    await expect(solicitar.execute({ email: 'a@x.dev' })).rejects.toThrow();

    expect((await repo.findById(s.id))?.emailVerificadoEm).toEqual(s.emailVerificadoEm);
    await solicitar.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(2);
  });
});

describe('emailLinkMagico', () => {
  const mensagem = (dados: Partial<Parameters<typeof emailLinkMagico>[0]> = {}) =>
    emailLinkMagico({ para: 'a@x.dev', appUrl: 'https://dindin.app', token: 'abc_DEF-123', validadeEmMinutos: 15, ...dados });

  it('assunto, destinatário e link no fragmento — nunca na query', () => {
    const m = mensagem();
    expect(m.subject).toBe(ASSUNTO_LINK_MAGICO);
    expect(m.subject).toBe('Seu link pra entrar no dindin');
    expect(m.to).toBe('a@x.dev');
    expect(m.text).toContain('https://dindin.app/entrar#token=abc_DEF-123');
    expect(m.html).toContain('href="https://dindin.app/entrar#token=abc_DEF-123"');
    expect(`${m.text}${m.html}`).not.toMatch(/[?&]token=/);
  });

  it('diz a validade em minutos e orienta a ignorar se não foi a pessoa', () => {
    const m = mensagem();
    expect(m.text).toContain('15 minutos');
    expect(m.text).toContain('Se não foi você, ignore este e-mail.');
    expect(m.html).toContain('Se não foi você, ignore este e-mail.');
    expect(mensagem({ validadeEmMinutos: 1 }).text).toContain('vale por 1 minuto e');
  });

  it('codifica o token, não duplica a barra da appUrl e escapa o link no HTML', () => {
    const m = mensagem({ appUrl: 'https://dindin.app/a&b/', token: 'x"y<z>' });
    expect(m.text).toContain('https://dindin.app/a&b/entrar#token=x%22y%3Cz%3E');
    expect(m.html).toContain('href="https://dindin.app/a&amp;b/entrar#token=x%22y%3Cz%3E"');
  });
});

describe('VerificarLinkMagicoUseCase', () => {
  it('consome o link, confirma o e-mail e abre uma sessão de verdade', async () => {
    await solicitar.execute({ email: 'a@x.dev' });
    clock.advance(5 * MINUTO);
    const savesAntes = repo.saves;

    const { subscriber, sessao } = await verificar.execute({ token: tokenDo(mailer.last()) });

    expect(subscriber.emailVerificadoEm).toEqual(clock.now());
    expect(authTokens.verifySession(sessao.token)).toEqual({ subscriberId: 'sub-1' });
    expect(sessao.expiresAt).toEqual(new Date(clock.now().getTime() + 30 * DIA));
    const gravado = await repo.findById('sub-1');
    expect(gravado?.emailVerificadoEm).toEqual(clock.now());
    expect(gravado?.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}sub-1`);
    // o consumo só passa pelo compare-and-set
    expect(repo.saves).toBe(savesAntes);
  });

  it('segundo uso do mesmo link → UnauthorizedError com a mensagem pra tela', async () => {
    await solicitar.execute({ email: 'a@x.dev' });
    const token = tokenDo(mailer.last());
    await verificar.execute({ token });

    await expect(verificar.execute({ token })).rejects.toThrow(
      new UnauthorizedError('Esse link expirou ou já foi usado. Peça um novo.'),
    );
    expect(sessoesEmitidas).toEqual(['sub-1']);
  });

  it('link vencido → UnauthorizedError e nada é gravado', async () => {
    await solicitar.execute({ email: 'a@x.dev' });
    clock.advance(15 * MINUTO + 1);

    await expect(verificar.execute({ token: tokenDo(mailer.last()) })).rejects.toBeInstanceOf(UnauthorizedError);
    const s = await repo.findById('sub-1');
    expect(s?.emailVerificadoEm).toBeNull();
    expect(s?.tokenHash).toBe('hash(token-1)');
    expect(sessoesEmitidas).toEqual([]);
  });

  it('token que nunca existiu → UnauthorizedError', async () => {
    await expect(verificar.execute({ token: 'inventado' })).rejects.toThrow(
      'Esse link expirou ou já foi usado. Peça um novo.',
    );
  });

  it('compare-and-set perdido (outro clique consumiu no meio) → UnauthorizedError e nenhuma sessão emitida', async () => {
    await solicitar.execute({ email: 'a@x.dev' });
    const savesAntes = repo.saves;
    repo.perderConsumo = true;

    await expect(verificar.execute({ token: tokenDo(mailer.last()) })).rejects.toThrow(
      new UnauthorizedError('Esse link expirou ou já foi usado. Peça um novo.'),
    );
    expect(sessoesEmitidas).toEqual([]);
    expect(repo.saves).toBe(savesAntes);
    expect((await repo.findById('sub-1'))?.emailVerificadoEm).toBeNull();
  });
});

describe('ObterMeUseCase, DescadastrarUseCase e ReativarUseCase', () => {
  it('obter devolve a conta da sessão; inexistente → NotFound', async () => {
    const s = await entrar('a@x.dev');
    expect((await obterMe.execute({ subscriberId: s.id })).email).toBe('a@x.dev');
    await expect(obterMe.execute({ subscriberId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('descadastrar grava ativo=false; repetir não regrava', async () => {
    const s = await entrar('a@x.dev');
    clock.advance(DIA);

    const descadastrada = await descadastrar.execute({ subscriberId: s.id });
    expect(descadastrada.ativo).toBe(false);
    const gravada = await repo.findById(s.id);
    expect(gravada?.ativo).toBe(false);
    expect(gravada?.atualizadoEm).toEqual(clock.now());
    expect(gravada?.podeReceberEmail).toBe(false);

    const saves = repo.saves;
    await expect(descadastrar.execute({ subscriberId: s.id })).resolves.toMatchObject({ ativo: false });
    expect(repo.saves).toBe(saves);
  });

  it('reativar volta a receber o e-mail; repetir não regrava', async () => {
    const s = await entrar('a@x.dev');
    await descadastrar.execute({ subscriberId: s.id });

    expect((await reativar.execute({ subscriberId: s.id })).ativo).toBe(true);
    expect((await repo.findById(s.id))?.podeReceberEmail).toBe(true);

    const saves = repo.saves;
    await reativar.execute({ subscriberId: s.id });
    expect(repo.saves).toBe(saves);
  });

  it('descadastrar e reativar conta inexistente → NotFound, sem gravar nada', async () => {
    await expect(descadastrar.execute({ subscriberId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(reativar.execute({ subscriberId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.saves).toBe(0);
  });
});

describe('DescadastrarPorTokenUseCase', () => {
  it('token do e-mail descadastra sem precisar entrar', async () => {
    const s = await entrar('a@x.dev');
    await descadastrarPorToken.execute({ token: authTokens.issueUnsubscribe(s.id).token });
    expect((await repo.findById(s.id))?.ativo).toBe(false);
  });

  it('repetir o clique termina igual, sem erro e sem regravar', async () => {
    const s = await entrar('a@x.dev');
    const { token } = authTokens.issueUnsubscribe(s.id);
    await descadastrarPorToken.execute({ token });
    const saves = repo.saves;
    await expect(descadastrarPorToken.execute({ token })).resolves.toBeUndefined();
    expect(repo.saves).toBe(saves);
  });

  it('conta já excluída: termina sem erro', async () => {
    await expect(
      descadastrarPorToken.execute({ token: authTokens.issueUnsubscribe('excluida').token }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['lixo', () => 'lixo'],
    ['token de sessão no lugar do de descadastro', (id: string) => authTokens.issueSession(id).token],
  ])('%s → UnauthorizedError e nada muda', async (_caso, gerar) => {
    const s = await entrar('a@x.dev');
    await expect(descadastrarPorToken.execute({ token: gerar(s.id) })).rejects.toThrow(
      new UnauthorizedError('Link de descadastro inválido.'),
    );
    expect((await repo.findById(s.id))?.ativo).toBe(true);
  });

  it('token vencido → UnauthorizedError', async () => {
    const s = await entrar('a@x.dev');
    const { token } = authTokens.issueUnsubscribe(s.id);
    clock.advance(366 * DIA);
    await expect(descadastrarPorToken.execute({ token })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
