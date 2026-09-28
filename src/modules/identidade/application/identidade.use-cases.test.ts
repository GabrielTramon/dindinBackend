import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthTokenService, EmailMessage, IssuedToken } from '../../../shared/application/ports';
import { InProcessBackgroundJobs } from '../../../shared/infra/background-jobs';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../../shared/domain/errors';
import {
  FixedClock,
  InMemoryMailer,
  PredictablePasswordHasher,
  PredictableSecureTokenGenerator,
  SequentialIdGenerator,
} from '../../../shared/infra/in-memory/doubles';
import { JwtAuthTokenService } from '../../../shared/infra/security/jwt-auth-token-service';
import { MENSAGEM_SENHA_CURTA, MENSAGEM_SENHA_LONGA } from '../domain/senha';
import { PREFIXO_TOKEN_CONSUMIDO, Subscriber } from '../domain/subscriber';
import { InMemorySubscribersRepository } from '../infra/database/in-memory-subscribers-repository';
import { CadastrarComSenhaUseCase, MENSAGEM_EMAIL_JA_CADASTRADO } from './cadastrar-com-senha.use-case';
import { MENSAGEM_INFORME_A_SENHA } from './credenciais';
import { DescadastrarPorTokenUseCase } from './descadastrar-por-token.use-case';
import { DescadastrarUseCase } from './descadastrar.use-case';
import { ASSUNTO_CONFIRMAR_EMAIL, emailConfirmarEmail } from './emails/confirmar-email';
import { ASSUNTO_CRIAR_SENHA_NOVA, emailCriarSenhaNova } from './emails/criar-senha-nova';
import { textoDaValidade } from './emails/link-no-email';
import { EntrarComSenhaUseCase, MENSAGEM_CREDENCIAIS_INVALIDAS } from './entrar-com-senha.use-case';
import { EmissorDeLinks, MENSAGEM_LINK_INVALIDO, type LinksConfig } from './links-por-email';
import { ObterMeUseCase } from './obter-me.use-case';
import { ReativarUseCase } from './reativar.use-case';
import { RedefinirSenhaUseCase } from './redefinir-senha.use-case';
import {
  SolicitarRedefinicaoDeSenhaUseCase,
  TAREFA_ESQUECI_SENHA,
  type SolicitarRedefinicaoDeSenhaInput,
} from './solicitar-redefinicao-de-senha.use-case';
import {
  MENSAGEM_INFORME_A_SENHA_ATUAL,
  MENSAGEM_SENHA_ATUAL_NAO_CONFERE,
  TrocarSenhaUseCase,
} from './trocar-senha.use-case';
import { VerificarLinkMagicoUseCase } from './verificar-link-magico.use-case';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const config: LinksConfig = {
  appUrl: 'https://dindin.test',
  confirmationLinkTtlHours: 48,
  resetLinkTtlMinutes: 15,
  linkResendCooldownSeconds: 60,
};

const SENHA = 'minha senha boa';
const OUTRA_SENHA = 'outra senha forte';

/** Repositório em memória que conta os save() e pode perder o compare-and-set. */
class RepositorioEspiao extends InMemorySubscribersRepository {
  saves = 0;
  perderConsumo = false;
  /** o próximo save falha (banco fora do ar), sem gravar */
  falharProximoSave = false;
  /** a conta some entre a leitura e a gravação da senha */
  contaSomeAntesDaSenha = false;
  /** roda uma vez, logo depois da próxima busca por e-mail: simula outro pedido gravando no meio */
  depoisDaBuscaPorEmail: (() => Promise<void>) | null = null;

  override async save(subscriber: Subscriber): Promise<void> {
    if (this.falharProximoSave) {
      this.falharProximoSave = false;
      throw new Error('banco fora do ar');
    }
    this.saves++;
    return super.save(subscriber);
  }

  override async saveMagicLinkConsumption(subscriber: Subscriber, usedTokenHash: string): Promise<boolean> {
    if (this.perderConsumo) return false;
    return super.saveMagicLinkConsumption(subscriber, usedTokenHash);
  }

  override async savePasswordReset(subscriber: Subscriber, usedTokenHash: string): Promise<boolean> {
    if (this.perderConsumo) return false;
    return super.savePasswordReset(subscriber, usedTokenHash);
  }

  override async savePassword(subscriber: Subscriber): Promise<boolean> {
    if (this.contaSomeAntesDaSenha) await this.delete(subscriber.id);
    return super.savePassword(subscriber);
  }

  override async findByEmail(email: string): Promise<Subscriber | null> {
    const encontrado = await super.findByEmail(email);
    const noMeio = this.depoisDaBuscaPorEmail;
    this.depoisDaBuscaPorEmail = null;
    if (noMeio) await noMeio();
    return encontrado;
  }
}

/** Conta os hashes gerados, pra provar que o "de mentira" do login é gerado uma vez só. */
class HasherQueConta extends PredictablePasswordHasher {
  hashes = 0;
  falharProximoHash = false;

  override async hash(senha: string): Promise<string> {
    if (this.falharProximoHash) {
      this.falharProximoHash = false;
      throw new Error('hash falhou');
    }
    this.hashes++;
    return super.hash(senha);
  }
}

let repo: RepositorioEspiao;
let clock: FixedClock;
let mailer: InMemoryMailer;
let secureTokens: PredictableSecureTokenGenerator;
let passwords: HasherQueConta;
let authTokens: JwtAuthTokenService;
let sessoesEmitidas: string[];
let links: EmissorDeLinks;
let cadastrar: CadastrarComSenhaUseCase;
let entrar: EntrarComSenhaUseCase;
/** as tarefas em segundo plano (o envio do Esqueci a senha) e as falhas que elas registraram */
let jobs: InProcessBackgroundJobs;
let falhasEmSegundoPlano: Array<{ message: string; context: Record<string, unknown> }>;
/** o caso de uso como a rota chama: volta sem esperar o envio */
let pedirSenhaNovaSemEsperar: SolicitarRedefinicaoDeSenhaUseCase;
/** o pedido + o envio que ele agendou, já terminado: é o que a pessoa vê depois de um tempo */
let esqueci: { execute(input: SolicitarRedefinicaoDeSenhaInput): Promise<void> };
let redefinir: RedefinirSenhaUseCase;
let verificar: VerificarLinkMagicoUseCase;
let trocar: TrocarSenhaUseCase;
let obterMe: ObterMeUseCase;
let descadastrar: DescadastrarUseCase;
let reativar: ReativarUseCase;
let descadastrarPorToken: DescadastrarPorTokenUseCase;

beforeEach(() => {
  repo = new RepositorioEspiao();
  clock = new FixedClock();
  mailer = new InMemoryMailer();
  secureTokens = new PredictableSecureTokenGenerator();
  passwords = new HasherQueConta();
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
    issueSession: (subscriberId: string, versao: number): IssuedToken => {
      sessoesEmitidas.push(subscriberId);
      return authTokens.issueSession(subscriberId, versao);
    },
    verifySession: (token) => authTokens.verifySession(token),
    issueUnsubscribe: (subscriberId) => authTokens.issueUnsubscribe(subscriberId),
    verifyUnsubscribe: (token) => authTokens.verifyUnsubscribe(token),
  };

  links = new EmissorDeLinks(secureTokens, config);
  cadastrar = new CadastrarComSenhaUseCase(repo, passwords, links, authEspiao, mailer, clock, new SequentialIdGenerator('sub'));
  entrar = new EntrarComSenhaUseCase(repo, passwords, authEspiao);
  falhasEmSegundoPlano = [];
  jobs = new InProcessBackgroundJobs({ error: (message, context) => falhasEmSegundoPlano.push({ message, context }) });
  pedirSenhaNovaSemEsperar = new SolicitarRedefinicaoDeSenhaUseCase(repo, links, mailer, clock, jobs);
  esqueci = {
    execute: async (input) => {
      await pedirSenhaNovaSemEsperar.execute(input);
      await jobs.idle();
    },
  };
  redefinir = new RedefinirSenhaUseCase(repo, secureTokens, passwords, authEspiao, clock);
  verificar = new VerificarLinkMagicoUseCase(repo, secureTokens, authEspiao, clock);
  trocar = new TrocarSenhaUseCase(repo, passwords, authEspiao, clock);
  obterMe = new ObterMeUseCase(repo);
  descadastrar = new DescadastrarUseCase(repo, clock);
  reativar = new ReativarUseCase(repo, clock);
  descadastrarPorToken = new DescadastrarPorTokenUseCase(repo, authEspiao, clock);
});

function tokenDo(mensagem: EmailMessage | undefined, caminho = ''): string {
  const achado = new RegExp(`${caminho}#token=([^\\s"<]+)`).exec(mensagem?.text ?? '');
  if (!achado?.[1]) throw new Error(`e-mail sem link ${caminho}#token=`);
  return decodeURIComponent(achado[1]);
}

/** conta criada no tempo do link mágico: e-mail confirmado e nenhuma senha */
async function contaAntiga(email = 'antiga@x.dev'): Promise<Subscriber> {
  const agora = clock.now();
  const s = Subscriber.criar({ id: 'antiga', email, tokenHash: 'hash-antigo', tokenExpiraEm: agora, agora });
  s.consumirLinkMagico(agora);
  await repo.save(s);
  return s;
}

/** o cadastro que outro pedido, rodando ao mesmo tempo, gravou */
const doOutroPedido = (email: string) =>
  Subscriber.criar({
    id: 'outro-pedido',
    email,
    tokenHash: 'hash-do-outro',
    tokenExpiraEm: new Date(clock.now().getTime() + 48 * HORA),
    senhaHash: 'senha(do outro pedido)',
    agora: clock.now(),
  });

/** cadastra e confirma o e-mail pelo link: conta pronta pro e-mail mensal */
async function contaConfirmada(email: string): Promise<Subscriber> {
  await cadastrar.execute({ email, senha: SENHA });
  const { subscriber } = await verificar.execute({ token: tokenDo(mailer.last(), '/entrar') });
  return subscriber;
}

describe('CadastrarComSenhaUseCase', () => {
  it('cria a conta com o hash da senha, abre a sessão e manda o "Confirme seu e-mail" (48 h) ao endereço normalizado', async () => {
    const { subscriber, sessao, falhaNoEnvio } = await cadastrar.execute({ email: '  Pessoa@Exemplo.COM ', senha: SENHA });

    expect(falhaNoEnvio).toBeNull();
    expect((await repo.findByEmail('pessoa@exemplo.com'))?.toSnapshot()).toEqual({
      id: 'sub-1',
      email: 'pessoa@exemplo.com',
      tokenHash: 'confirmacao:hash(token-1)',
      tokenExpiraEm: new Date(clock.now().getTime() + 48 * HORA),
      senhaHash: `senha(${SENHA})`,
      versaoSessao: 0,
      emailVerificadoEm: null,
      ativo: true,
      criadoEm: clock.now(),
      atualizadoEm: clock.now(),
    });
    expect(subscriber.id).toBe('sub-1');
    expect(authTokens.verifySession(sessao.token)).toEqual({ subscriberId: 'sub-1', versao: 0 });
    expect(sessoesEmitidas).toEqual(['sub-1']);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last()).toMatchObject({ to: 'pessoa@exemplo.com', subject: ASSUNTO_CONFIRMAR_EMAIL });
    expect(tokenDo(mailer.last(), 'https://dindin.test/entrar')).toBe('token-1');
    expect(mailer.last()?.text).toContain('48 horas');
  });

  it('a senha vai pro hash exatamente como foi digitada: sem trim', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: `  ${SENHA}  ` });
    expect((await repo.findByEmail('a@x.dev'))?.senhaHash).toBe(`senha(  ${SENHA}  )`);
  });

  it('e-mail inválido e senha curta juntos → ValidationError com os dois campos, sem gravar nem enviar', async () => {
    const erro = await cadastrar.execute({ email: 'sem-arroba', senha: 'curta' }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ValidationError);
    expect((erro as ValidationError).details).toEqual({ email: 'Informe um e-mail válido', senha: MENSAGEM_SENHA_CURTA });
    expect((erro as ValidationError).message).toBe('Confira os campos destacados.');
    expect(repo.saves).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    expect(sessoesEmitidas).toEqual([]);
  });

  it.each([
    ['7 caracteres', '1234567', MENSAGEM_SENHA_CURTA],
    ['só espaços', ' '.repeat(12), MENSAGEM_SENHA_CURTA],
    ['129 caracteres', 'x'.repeat(129), MENSAGEM_SENHA_LONGA],
  ])('senha com %s → ValidationError com a mensagem da tela', async (_caso, senha, mensagem) => {
    await expect(cadastrar.execute({ email: 'a@x.dev', senha })).rejects.toThrow(
      new ValidationError(mensagem, { senha: mensagem }),
    );
    expect(repo.saves).toBe(0);
  });

  it('8 e 128 caracteres valem', async () => {
    await expect(cadastrar.execute({ email: 'a@x.dev', senha: '12345678' })).resolves.toBeDefined();
    await expect(cadastrar.execute({ email: 'b@x.dev', senha: 'y'.repeat(128) })).resolves.toBeDefined();
  });

  it('e-mail que já tem conta → 409 com a mensagem pra tela, sem hash, sem e-mail e sem sessão', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    const [savesAntes, hashesAntes] = [repo.saves, passwords.hashes];

    await expect(cadastrar.execute({ email: ' A@X.dev', senha: OUTRA_SENHA })).rejects.toThrow(
      new ConflictError(MENSAGEM_EMAIL_JA_CADASTRADO, { email: MENSAGEM_EMAIL_JA_CADASTRADO }),
    );
    expect(repo.saves).toBe(savesAntes);
    expect(passwords.hashes).toBe(hashesAntes);
    expect(mailer.sent).toHaveLength(1);
    expect(sessoesEmitidas).toEqual(['sub-1']);
    // a senha da conta continua a primeira
    expect((await repo.findByEmail('a@x.dev'))?.senhaHash).toBe(`senha(${SENHA})`);
  });

  it('conta antiga, sem senha, também é 409: quem cria a senha dela é o Esqueci a senha', async () => {
    await contaAntiga('antiga@x.dev');
    await expect(cadastrar.execute({ email: 'antiga@x.dev', senha: SENHA })).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.findByEmail('antiga@x.dev'))?.temSenha).toBe(false);
  });

  it('corrida no cadastro: outro pedido gravou o mesmo e-mail no meio → 409, sem e-mail e sem sessão', async () => {
    repo.depoisDaBuscaPorEmail = () => repo.save(doOutroPedido('a@x.dev'));

    await expect(cadastrar.execute({ email: 'a@x.dev', senha: SENHA })).rejects.toThrow(
      new ConflictError(MENSAGEM_EMAIL_JA_CADASTRADO, { email: MENSAGEM_EMAIL_JA_CADASTRADO }),
    );
    expect(mailer.sent).toHaveLength(0);
    expect(sessoesEmitidas).toEqual([]);
    expect(await repo.findById('sub-1')).toBeNull();
    expect((await repo.findByEmail('a@x.dev'))?.id).toBe('outro-pedido');
  });

  it('conflito que não é do e-mail é relançado como veio, sem enviar nada', async () => {
    // outra conta já usa o hash que este pedido vai gerar
    const agora = clock.now();
    await repo.save(
      Subscriber.criar({ id: 'outra', email: 'b@x.dev', tokenHash: 'confirmacao:hash(token-1)', tokenExpiraEm: agora, agora }),
    );

    const erro = await cadastrar.execute({ email: 'a@x.dev', senha: SENHA }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflictError);
    expect((erro as ConflictError).message).not.toBe(MENSAGEM_EMAIL_JA_CADASTRADO);
    expect(mailer.sent).toHaveLength(0);
    expect(sessoesEmitidas).toEqual([]);
  });

  it('envio falhou: a conta existe e a sessão sai do mesmo jeito; o link é anulado e o Esqueci a senha manda na hora', async () => {
    mailer.failNext = true;
    const { subscriber, sessao, falhaNoEnvio } = await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });

    expect(falhaNoEnvio).toEqual({ erro: new Error('falha simulada de envio') });
    expect(authTokens.verifySession(sessao.token)).toEqual({ subscriberId: subscriber.id, versao: 0 });
    const gravado = await repo.findByEmail('a@x.dev');
    expect(gravado?.senhaHash).toBe(`senha(${SENHA})`);
    expect(gravado?.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}sub-1`);
    expect(gravado?.tokenExpiraEm).toBeNull();
    expect(gravado?.emailVerificadoEm).toBeNull();
    await expect(verificar.execute({ token: 'token-1' })).rejects.toBeInstanceOf(UnauthorizedError);

    // entra com a senha, e o link anulado não segura o próximo pedido no limite de reenvio
    await expect(entrar.execute({ email: 'a@x.dev', senha: SENHA })).resolves.toBeDefined();
    await esqueci.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(1);
  });

  it('envio falhou e nem a anulação gravou: a conta e a sessão valem igual', async () => {
    mailer.failNext = true;
    const salvar = repo.save.bind(repo);
    let chamadas = 0;
    repo.save = async (s) => {
      // o insert passa; a gravação da anulação encontra o banco fora do ar
      if (++chamadas === 2) throw new Error('banco fora do ar');
      return salvar(s);
    };

    const { sessao, falhaNoEnvio } = await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    expect(falhaNoEnvio).not.toBeNull();
    expect(sessao.token).toEqual(expect.any(String));
    expect((await repo.findByEmail('a@x.dev'))?.tokenHash).toBe('confirmacao:hash(token-1)');
  });

  it('banco fora do ar no insert → o erro sobe e nada é enviado', async () => {
    repo.falharProximoSave = true;
    await expect(cadastrar.execute({ email: 'a@x.dev', senha: SENHA })).rejects.toThrow('banco fora do ar');
    expect(mailer.sent).toHaveLength(0);
    expect(sessoesEmitidas).toEqual([]);
  });
});

describe('EntrarComSenhaUseCase', () => {
  beforeEach(async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    sessoesEmitidas.length = 0;
  });

  it('senha certa → sessão da conta, com o e-mail normalizado e sem precisar ter confirmado', async () => {
    const { subscriber, sessao } = await entrar.execute({ email: '  A@X.DEV ', senha: SENHA });
    expect(subscriber.id).toBe('sub-1');
    expect(subscriber.emailVerificadoEm).toBeNull();
    expect(authTokens.verifySession(sessao.token)).toEqual({ subscriberId: 'sub-1', versao: 0 });
    expect(sessoesEmitidas).toEqual(['sub-1']);
  });

  it.each([
    ['senha errada', 'a@x.dev', OUTRA_SENHA],
    ['senha com espaço a mais (não há trim)', 'a@x.dev', ` ${SENHA}`],
    ['senha curta demais pra existir', 'a@x.dev', '1234'],
    ['e-mail sem conta', 'ninguem@x.dev', SENHA],
  ])('%s → UnauthorizedError com a mesma frase, sem sessão', async (_caso, email, senha) => {
    await expect(entrar.execute({ email, senha })).rejects.toThrow(new UnauthorizedError(MENSAGEM_CREDENCIAIS_INVALIDAS));
    expect(sessoesEmitidas).toEqual([]);
  });

  it('conta antiga, sem senha → a mesma resposta de senha errada', async () => {
    await contaAntiga('antiga@x.dev');
    await expect(entrar.execute({ email: 'antiga@x.dev', senha: SENHA })).rejects.toThrow(
      new UnauthorizedError(MENSAGEM_CREDENCIAIS_INVALIDAS),
    );
    expect(sessoesEmitidas).toEqual([]);
  });

  it('e-mail sem conta e conta sem senha também rodam uma conferência (o tempo não revela quem tem conta)', async () => {
    await contaAntiga('antiga@x.dev');
    passwords.verificacoes.length = 0;

    await entrar.execute({ email: 'ninguem@x.dev', senha: SENHA }).catch(() => undefined);
    await entrar.execute({ email: 'antiga@x.dev', senha: SENHA }).catch(() => undefined);
    await entrar.execute({ email: 'a@x.dev', senha: OUTRA_SENHA }).catch(() => undefined);

    expect(passwords.verificacoes).toHaveLength(3);
    const [semConta, semSenha, comSenha] = passwords.verificacoes;
    expect(semConta?.hash).toMatch(/^senha\(/);
    expect(semSenha?.hash).toBe(semConta?.hash);
    expect(comSenha?.hash).toBe(`senha(${SENHA})`);
  });

  it('o hash "de mentira" é gerado uma vez só, e uma falha dele não fica guardada', async () => {
    const hashesAntes = passwords.hashes;
    passwords.falharProximoHash = true;
    await expect(entrar.execute({ email: 'ninguem@x.dev', senha: SENHA })).rejects.toThrow('hash falhou');

    for (let i = 0; i < 3; i++) {
      await expect(entrar.execute({ email: 'ninguem@x.dev', senha: SENHA })).rejects.toBeInstanceOf(UnauthorizedError);
    }
    expect(passwords.hashes).toBe(hashesAntes + 1);
  });

  it('descadastrada entra normalmente: o descadastro só para o e-mail mensal', async () => {
    await descadastrar.execute({ subscriberId: 'sub-1' });
    await expect(entrar.execute({ email: 'a@x.dev', senha: SENHA })).resolves.toMatchObject({
      subscriber: expect.objectContaining({ ativo: false }),
    });
  });

  it('senha vazia, e-mail inválido e senha longa demais → ValidationError por campo', async () => {
    await expect(entrar.execute({ email: 'a@x.dev', senha: '' })).rejects.toThrow(
      new ValidationError(MENSAGEM_INFORME_A_SENHA, { senha: MENSAGEM_INFORME_A_SENHA }),
    );
    await expect(entrar.execute({ email: 'a@x.dev', senha: 'x'.repeat(129) })).rejects.toThrow(
      new ValidationError(MENSAGEM_SENHA_LONGA, { senha: MENSAGEM_SENHA_LONGA }),
    );
    const erro = await entrar.execute({ email: 'sem-arroba', senha: '' }).catch((e: unknown) => e);
    expect((erro as ValidationError).details).toEqual({ email: 'Informe um e-mail válido', senha: MENSAGEM_INFORME_A_SENHA });
    expect(passwords.verificacoes).toHaveLength(0);
  });
});

describe('SolicitarRedefinicaoDeSenhaUseCase', () => {
  it('conta existente: manda o "Criar uma senha nova" (/redefinir-senha, 15 min) e guarda só o hash do token', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    clock.advance(MINUTO);

    await expect(esqueci.execute({ email: ' A@x.dev ' })).resolves.toBeUndefined();

    expect(mailer.sent).toHaveLength(2);
    expect(mailer.last()).toMatchObject({ to: 'a@x.dev', subject: ASSUNTO_CRIAR_SENHA_NOVA });
    expect(tokenDo(mailer.last(), 'https://dindin.test/redefinir-senha')).toBe('token-2');
    expect(mailer.last()?.text).toContain('15 minutos');
    const s = await repo.findByEmail('a@x.dev');
    expect(s?.tokenHash).toBe('redefinicao:hash(token-2)');
    expect(s?.tokenExpiraEm).toEqual(new Date(clock.now().getTime() + 15 * MINUTO));
    // pedir o link não mexe na senha
    expect(s?.senhaHash).toBe(`senha(${SENHA})`);
  });

  it('e-mail sem conta: termina igual, sem gravar nem enviar nada', async () => {
    await expect(esqueci.execute({ email: 'ninguem@x.dev' })).resolves.toBeUndefined();
    expect(repo.saves).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('e-mail inválido → ValidationError, sem agendar nada', async () => {
    await expect(pedirSenhaNovaSemEsperar.execute({ email: 'sem-arroba' })).rejects.toBeInstanceOf(ValidationError);
    await jobs.idle();
    expect(repo.saves).toBe(0);
    expect(falhasEmSegundoPlano).toEqual([]);
  });

  it('o pedido volta ANTES de buscar a conta e de enviar: com conta ou sem, o tempo e o resultado são os mesmos', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    clock.advance(MINUTO);
    let buscas = 0;
    const buscar = repo.findByEmail.bind(repo);
    repo.findByEmail = async (email) => {
      buscas++;
      return buscar(email);
    };

    await expect(pedirSenhaNovaSemEsperar.execute({ email: 'a@x.dev' })).resolves.toBeUndefined();
    await expect(pedirSenhaNovaSemEsperar.execute({ email: 'ninguem@x.dev' })).resolves.toBeUndefined();
    // nada rodou ainda: nem a busca da conta, nem o e-mail
    expect(buscas).toBe(0);
    expect(mailer.sent).toHaveLength(1);

    await jobs.idle();
    expect(buscas).toBe(2);
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.last()?.to).toBe('a@x.dev');
  });

  it('um provedor de e-mail travado não segura o pedido', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    clock.advance(MINUTO);
    let enviosPendentes = 0;
    mailer.send = () => {
      enviosPendentes++;
      return new Promise<void>(() => {});
    };
    await expect(pedirSenhaNovaSemEsperar.execute({ email: 'a@x.dev' })).resolves.toBeUndefined();
    // o envio começa depois, e fica pendurado sozinho
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enviosPendentes).toBe(1);
  });

  it('pedido de novo dentro de 60 s não envia nem troca o link; passado o intervalo, o link novo substitui o anterior', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    clock.advance(MINUTO);
    await esqueci.execute({ email: 'a@x.dev' });
    const primeiro = tokenDo(mailer.last(), '/redefinir-senha');

    clock.advance(59_999);
    await esqueci.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(2);
    expect((await repo.findByEmail('a@x.dev'))?.tokenHash).toBe(`redefinicao:hash(${primeiro})`);

    clock.advance(1);
    await esqueci.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(3);
    const segundo = tokenDo(mailer.last(), '/redefinir-senha');
    expect(segundo).not.toBe(primeiro);
    await expect(redefinir.execute({ token: primeiro, senha: OUTRA_SENHA })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(redefinir.execute({ token: segundo, senha: OUTRA_SENHA })).resolves.toBeDefined();
  });

  it('logo depois do cadastro o link de confirmação conta pro intervalo (a validade de 48 h é reconhecida)', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    clock.advance(30_000);
    await esqueci.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(1);

    clock.advance(30_000);
    await esqueci.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(2);
    // o link de senha nova substituiu o de confirmação — e ele também confirma o e-mail
    await expect(verificar.execute({ token: 'token-1' })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('link já usado não conta pro intervalo: quem acabou de confirmar pode pedir na hora', async () => {
    await contaConfirmada('a@x.dev');
    await esqueci.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(2);
  });

  it('conta descadastrada recebe o link: descadastro só para o e-mail mensal', async () => {
    const s = await contaConfirmada('a@x.dev');
    await descadastrar.execute({ subscriberId: s.id });
    await esqueci.execute({ email: 'a@x.dev' });
    expect(mailer.sent).toHaveLength(2);
  });

  it('envio falhou: o pedido termina igual, a falha vai pro log, o link é anulado e a próxima tentativa envia sem esperar', async () => {
    await contaConfirmada('a@x.dev');
    mailer.failNext = true;
    await expect(esqueci.execute({ email: 'a@x.dev' })).resolves.toBeUndefined();
    expect(falhasEmSegundoPlano).toEqual([
      {
        message: `Tarefa em segundo plano falhou: ${TAREFA_ESQUECI_SENHA}`,
        context: { tarefa: TAREFA_ESQUECI_SENHA, erro: { name: 'Error', message: 'falha simulada de envio' } },
      },
    ]);

    const s = await repo.findByEmail('a@x.dev');
    expect(s?.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}sub-1`);
    expect(s?.tokenExpiraEm).toBeNull();
    // a confirmação feita antes continua
    expect(s?.emailVerificadoEm).not.toBeNull();
    await expect(redefinir.execute({ token: 'token-2', senha: OUTRA_SENHA })).rejects.toBeInstanceOf(UnauthorizedError);

    await esqueci.execute({ email: 'a@x.dev' });
    await expect(redefinir.execute({ token: tokenDo(mailer.last(), '/redefinir-senha'), senha: OUTRA_SENHA })).resolves.toBeDefined();
  });
});

describe('RedefinirSenhaUseCase', () => {
  /** cadastra, espera o intervalo e pede o link de senha nova; devolve o token */
  async function pedirSenhaNova(email = 'a@x.dev'): Promise<string> {
    if (!(await repo.findByEmail(email))) await cadastrar.execute({ email, senha: SENHA });
    clock.advance(MINUTO);
    await esqueci.execute({ email });
    sessoesEmitidas.length = 0;
    return tokenDo(mailer.last(), '/redefinir-senha');
  }

  it('grava a senha nova, confirma o e-mail, gasta o link e abre a sessão', async () => {
    const token = await pedirSenhaNova();
    clock.advance(5 * MINUTO);
    const savesAntes = repo.saves;

    const { subscriber, sessao } = await redefinir.execute({ token, senha: OUTRA_SENHA });

    // a senha nova sobe a versão das sessões: esta já sai na versão nova
    expect(authTokens.verifySession(sessao.token)).toEqual({ subscriberId: 'sub-1', versao: 1 });
    expect(sessoesEmitidas).toEqual(['sub-1']);
    expect(subscriber.emailVerificadoEm).toEqual(clock.now());
    const gravado = await repo.findById('sub-1');
    expect(gravado?.senhaHash).toBe(`senha(${OUTRA_SENHA})`);
    expect(gravado?.emailVerificadoEm).toEqual(clock.now());
    expect(gravado?.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}sub-1`);
    expect(gravado?.atualizadoEm).toEqual(clock.now());
    expect(gravado?.versaoSessao).toBe(1);
    // só pelo compare-and-set
    expect(repo.saves).toBe(savesAntes);

    await expect(entrar.execute({ email: 'a@x.dev', senha: OUTRA_SENHA })).resolves.toBeDefined();
    await expect(entrar.execute({ email: 'a@x.dev', senha: SENHA })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('segundo uso do link → 401 e a senha fica a do primeiro uso', async () => {
    const token = await pedirSenhaNova();
    await redefinir.execute({ token, senha: OUTRA_SENHA });

    await expect(redefinir.execute({ token, senha: 'terceira senha aqui' })).rejects.toThrow(
      new UnauthorizedError(MENSAGEM_LINK_INVALIDO),
    );
    expect((await repo.findById('sub-1'))?.senhaHash).toBe(`senha(${OUTRA_SENHA})`);
    expect(sessoesEmitidas).toEqual(['sub-1']);
  });

  it('link vencido (15 min) → 401 e nada é gravado', async () => {
    const token = await pedirSenhaNova();
    clock.advance(15 * MINUTO + 1);

    await expect(redefinir.execute({ token, senha: OUTRA_SENHA })).rejects.toThrow(MENSAGEM_LINK_INVALIDO);
    const s = await repo.findById('sub-1');
    expect(s?.senhaHash).toBe(`senha(${SENHA})`);
    expect(s?.tokenHash).toBe(`redefinicao:hash(${token})`);
    expect(s?.versaoSessao).toBe(0);
    expect(sessoesEmitidas).toEqual([]);
  });

  it('token que nunca existiu → 401', async () => {
    await expect(redefinir.execute({ token: 'inventado', senha: OUTRA_SENHA })).rejects.toThrow(
      new UnauthorizedError(MENSAGEM_LINK_INVALIDO),
    );
  });

  it('senha fora da regra → ValidationError e o link NÃO é gasto: dá pra corrigir e tentar de novo', async () => {
    const token = await pedirSenhaNova();
    await expect(redefinir.execute({ token, senha: 'curta' })).rejects.toThrow(
      new ValidationError(MENSAGEM_SENHA_CURTA, { senha: MENSAGEM_SENHA_CURTA }),
    );
    expect((await repo.findById('sub-1'))?.tokenHash).toBe(`redefinicao:hash(${token})`);
    await expect(redefinir.execute({ token, senha: OUTRA_SENHA })).resolves.toBeDefined();
  });

  it('compare-and-set perdido (outro clique gastou o link no meio) → 401, senha intacta e nenhuma sessão', async () => {
    const token = await pedirSenhaNova();
    repo.perderConsumo = true;

    await expect(redefinir.execute({ token, senha: OUTRA_SENHA })).rejects.toThrow(new UnauthorizedError(MENSAGEM_LINK_INVALIDO));
    expect(sessoesEmitidas).toEqual([]);
    const s = await repo.findById('sub-1');
    expect(s?.senhaHash).toBe(`senha(${SENHA})`);
    expect(s?.versaoSessao).toBe(0);
  });

  it('conta antiga, sem senha: o link cria a primeira senha, e ela passa a entrar com e-mail e senha', async () => {
    await contaAntiga('antiga@x.dev');
    const token = await pedirSenhaNova('antiga@x.dev');

    await redefinir.execute({ token, senha: SENHA });
    expect((await repo.findByEmail('antiga@x.dev'))?.temSenha).toBe(true);
    await expect(entrar.execute({ email: 'antiga@x.dev', senha: SENHA })).resolves.toBeDefined();
  });

  it('o link do "Confirme seu e-mail" NÃO cria senha (vale 48 h, não os 15 min da senha nova) e continua valendo pra confirmar', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    const daConfirmacao = tokenDo(mailer.last(), '/entrar');

    await expect(redefinir.execute({ token: daConfirmacao, senha: OUTRA_SENHA })).rejects.toThrow(
      new UnauthorizedError(MENSAGEM_LINK_INVALIDO),
    );
    const s = await repo.findById('sub-1');
    expect(s?.senhaHash).toBe(`senha(${SENHA})`);
    expect(s?.emailVerificadoEm).toBeNull();
    expect(sessoesEmitidas).toEqual(['sub-1']);
    // o link não foi gasto pela tentativa errada
    await expect(verificar.execute({ token: daConfirmacao })).resolves.toBeDefined();
  });

  it('descadastrada continua descadastrada depois da senha nova', async () => {
    const s = await contaConfirmada('a@x.dev');
    await descadastrar.execute({ subscriberId: s.id });
    const token = await pedirSenhaNova();
    await redefinir.execute({ token, senha: OUTRA_SENHA });
    expect((await repo.findById(s.id))?.ativo).toBe(false);
  });
});

describe('TrocarSenhaUseCase', () => {
  beforeEach(async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
  });

  it('com a senha atual certa: troca, e só a nova entra', async () => {
    clock.advance(DIA);
    await trocar.execute({ subscriberId: 'sub-1', senhaAtual: SENHA, senhaNova: OUTRA_SENHA });

    const s = await repo.findById('sub-1');
    expect(s?.senhaHash).toBe(`senha(${OUTRA_SENHA})`);
    expect(s?.atualizadoEm).toEqual(clock.now());
    expect(s?.versaoSessao).toBe(1);
    await expect(entrar.execute({ email: 'a@x.dev', senha: OUTRA_SENHA })).resolves.toBeDefined();
    await expect(entrar.execute({ email: 'a@x.dev', senha: SENHA })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('devolve uma sessão nova, já na versão que a senha nova subiu (a do pedido caiu junto com as outras)', async () => {
    sessoesEmitidas.length = 0;
    const { subscriber, sessao } = await trocar.execute({ subscriberId: 'sub-1', senhaAtual: SENHA, senhaNova: OUTRA_SENHA });
    expect(subscriber.id).toBe('sub-1');
    expect(authTokens.verifySession(sessao.token)).toEqual({ subscriberId: 'sub-1', versao: 1 });
    expect(sessoesEmitidas).toEqual(['sub-1']);

    await trocar.execute({ subscriberId: 'sub-1', senhaAtual: OUTRA_SENHA, senhaNova: SENHA });
    expect((await repo.findById('sub-1'))?.versaoSessao).toBe(2);
  });

  it('senha atual errada → ValidationError em senhaAtual (nunca 401) e nada muda', async () => {
    const erro = await trocar
      .execute({ subscriberId: 'sub-1', senhaAtual: 'nao e essa nao', senhaNova: OUTRA_SENHA })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ValidationError);
    expect(erro).not.toBeInstanceOf(UnauthorizedError);
    expect((erro as ValidationError).details).toEqual({ senhaAtual: MENSAGEM_SENHA_ATUAL_NAO_CONFERE });
    expect((await repo.findById('sub-1'))?.senhaHash).toBe(`senha(${SENHA})`);
  });

  it.each([undefined, ''])('sem a senha atual (%j) numa conta com senha → "Informe a sua senha atual."', async (senhaAtual) => {
    await expect(trocar.execute({ subscriberId: 'sub-1', senhaAtual, senhaNova: OUTRA_SENHA })).rejects.toThrow(
      new ValidationError(MENSAGEM_INFORME_A_SENHA_ATUAL, { senhaAtual: MENSAGEM_INFORME_A_SENHA_ATUAL }),
    );
  });

  it('senha nova fora da regra → details.senhaNova; com a atual errada também, os dois campos juntos', async () => {
    await expect(trocar.execute({ subscriberId: 'sub-1', senhaAtual: SENHA, senhaNova: 'curta' })).rejects.toThrow(
      new ValidationError(MENSAGEM_SENHA_CURTA, { senhaNova: MENSAGEM_SENHA_CURTA }),
    );
    const erro = await trocar
      .execute({ subscriberId: 'sub-1', senhaAtual: 'errada errada', senhaNova: 'x'.repeat(129) })
      .catch((e: unknown) => e);
    expect((erro as ValidationError).details).toEqual({
      senhaAtual: MENSAGEM_SENHA_ATUAL_NAO_CONFERE,
      senhaNova: MENSAGEM_SENHA_LONGA,
    });
    expect((await repo.findById('sub-1'))?.senhaHash).toBe(`senha(${SENHA})`);
  });

  it('senha atual longa demais não vai pro hash: só "não confere"', async () => {
    passwords.verificacoes.length = 0;
    await expect(
      trocar.execute({ subscriberId: 'sub-1', senhaAtual: 'x'.repeat(5000), senhaNova: OUTRA_SENHA }),
    ).rejects.toThrow(MENSAGEM_SENHA_ATUAL_NAO_CONFERE);
    expect(passwords.verificacoes).toHaveLength(0);
  });

  it('conta antiga, sem senha: cria a primeira só com a nova (a atual, se vier, é ignorada)', async () => {
    await contaAntiga('antiga@x.dev');
    await trocar.execute({ subscriberId: 'antiga', senhaAtual: 'qualquer coisa', senhaNova: SENHA });
    expect((await repo.findById('antiga'))?.senhaHash).toBe(`senha(${SENHA})`);
    await expect(entrar.execute({ email: 'antiga@x.dev', senha: SENHA })).resolves.toBeDefined();
  });

  it('não mexe no link pendente nem no descadastro: grava só a senha', async () => {
    clock.advance(MINUTO);
    await esqueci.execute({ email: 'a@x.dev' });
    const token = tokenDo(mailer.last(), '/redefinir-senha');
    await descadastrar.execute({ subscriberId: 'sub-1' });

    await trocar.execute({ subscriberId: 'sub-1', senhaAtual: SENHA, senhaNova: OUTRA_SENHA });
    const s = await repo.findById('sub-1');
    expect(s?.tokenHash).toBe(`redefinicao:hash(${token})`);
    expect(s?.ativo).toBe(false);
  });

  it('conta inexistente, ou excluída no meio do pedido → NotFound', async () => {
    await expect(trocar.execute({ subscriberId: 'nao-existe', senhaNova: OUTRA_SENHA })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    repo.contaSomeAntesDaSenha = true;
    await expect(
      trocar.execute({ subscriberId: 'sub-1', senhaAtual: SENHA, senhaNova: OUTRA_SENHA }),
    ).rejects.toThrow(new NotFoundError('Conta não encontrada.'));
  });
});

describe('VerificarLinkMagicoUseCase (o link do "Confirme seu e-mail")', () => {
  it('consome o link, confirma o e-mail e abre uma sessão de verdade; a senha fica', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    clock.advance(5 * MINUTO);
    const savesAntes = repo.saves;

    const { subscriber, sessao } = await verificar.execute({ token: tokenDo(mailer.last(), '/entrar') });

    expect(subscriber.emailVerificadoEm).toEqual(clock.now());
    expect(authTokens.verifySession(sessao.token)).toEqual({ subscriberId: 'sub-1', versao: 0 });
    expect(sessao.expiresAt).toEqual(new Date(clock.now().getTime() + 30 * DIA));
    const gravado = await repo.findById('sub-1');
    expect(gravado?.emailVerificadoEm).toEqual(clock.now());
    expect(gravado?.tokenHash).toBe(`${PREFIXO_TOKEN_CONSUMIDO}sub-1`);
    expect(gravado?.senhaHash).toBe(`senha(${SENHA})`);
    expect(repo.saves).toBe(savesAntes);
  });

  it('segundo uso do mesmo link → 401 com a mensagem pra tela', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    const token = tokenDo(mailer.last(), '/entrar');
    await verificar.execute({ token });
    sessoesEmitidas.length = 0;

    await expect(verificar.execute({ token })).rejects.toThrow(new UnauthorizedError(MENSAGEM_LINK_INVALIDO));
    expect(sessoesEmitidas).toEqual([]);
  });

  it('vale 48 horas: no limite ainda confirma; um milissegundo depois, 401 e nada gravado', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    await cadastrar.execute({ email: 'b@x.dev', senha: SENHA });
    const [tokenA, tokenB] = [tokenDo(mailer.sent[0], '/entrar'), tokenDo(mailer.sent[1], '/entrar')];

    clock.advance(48 * HORA);
    await expect(verificar.execute({ token: tokenA })).resolves.toBeDefined();
    clock.advance(1);
    await expect(verificar.execute({ token: tokenB })).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await repo.findByEmail('b@x.dev'))?.emailVerificadoEm).toBeNull();
  });

  it('token que nunca existiu → 401', async () => {
    await expect(verificar.execute({ token: 'inventado' })).rejects.toThrow(MENSAGEM_LINK_INVALIDO);
  });

  it('o link de senha nova NÃO abre sessão aqui: seria entrar sem senha, sem trocar a senha', async () => {
    await contaConfirmada('a@x.dev');
    await esqueci.execute({ email: 'a@x.dev' });
    const daSenhaNova = tokenDo(mailer.last(), '/redefinir-senha');
    sessoesEmitidas.length = 0;

    await expect(verificar.execute({ token: daSenhaNova })).rejects.toThrow(new UnauthorizedError(MENSAGEM_LINK_INVALIDO));
    expect(sessoesEmitidas).toEqual([]);
    // e continua valendo pro que ele serve: criar a senha nova
    await expect(redefinir.execute({ token: daSenhaNova, senha: OUTRA_SENHA })).resolves.toBeDefined();
  });

  it('compare-and-set perdido → 401 e nenhuma sessão emitida', async () => {
    await cadastrar.execute({ email: 'a@x.dev', senha: SENHA });
    sessoesEmitidas.length = 0;
    repo.perderConsumo = true;

    await expect(verificar.execute({ token: tokenDo(mailer.last(), '/entrar') })).rejects.toThrow(
      new UnauthorizedError(MENSAGEM_LINK_INVALIDO),
    );
    expect(sessoesEmitidas).toEqual([]);
    expect((await repo.findById('sub-1'))?.emailVerificadoEm).toBeNull();
  });
});

describe('EmissorDeLinks', () => {
  const conta = (tokenExpiraEm: Date) =>
    Subscriber.criar({ id: 's', email: 's@x.dev', tokenHash: 'h', tokenExpiraEm, agora: clock.now() });

  it('cada finalidade com a sua validade; o token vai pro e-mail e o hash pro banco', () => {
    const agora = clock.now();
    expect(links.gerar('confirmacao', agora)).toEqual({
      token: 'token-1',
      tokenHash: 'confirmacao:hash(token-1)',
      expiraEm: new Date(agora.getTime() + 48 * HORA),
      validadeEmMinutos: 48 * 60,
    });
    expect(links.gerar('redefinicao', agora)).toMatchObject({
      token: 'token-2',
      tokenHash: 'redefinicao:hash(token-2)',
      expiraEm: new Date(agora.getTime() + 15 * MINUTO),
      validadeEmMinutos: 15,
    });
  });

  it('reconhece o intervalo com o link pendente de qualquer finalidade', () => {
    const agora = clock.now();
    const emitidoHa = (ms: number, validade: number) => conta(new Date(agora.getTime() - ms + validade));

    expect(links.emitiuHaPouco(emitidoHa(59_999, 48 * HORA), agora)).toBe(true);
    expect(links.emitiuHaPouco(emitidoHa(60_000, 48 * HORA), agora)).toBe(false);
    expect(links.emitiuHaPouco(emitidoHa(59_999, 15 * MINUTO), agora)).toBe(true);
    expect(links.emitiuHaPouco(emitidoHa(60_000, 15 * MINUTO), agora)).toBe(false);
    // relógio de outra instância um pouco adiantado: conta como agora
    expect(links.emitiuHaPouco(emitidoHa(-5_000, 15 * MINUTO), agora)).toBe(true);
  });

  it('sem link pendente, ou com validade reduzida na config, o endereço não fica travado', () => {
    const agora = clock.now();
    const consumida = conta(agora);
    consumida.consumirLinkMagico(agora);
    expect(links.emitiuHaPouco(consumida, agora)).toBe(false);
    // um link de 60 min emitido há 10 min parece, com 15 min, emitido daqui a 35 min
    expect(links.emitiuHaPouco(conta(new Date(agora.getTime() + 50 * MINUTO)), agora)).toBe(false);
  });
});

describe('e-mails com link', () => {
  const dados = { para: 'a@x.dev', appUrl: 'https://dindin.app', token: 'abc_DEF-123', validadeEmMinutos: 15 };

  it('"Confirme seu e-mail": assunto, destinatário e /entrar#token= no fragmento — nunca na query', () => {
    const m = emailConfirmarEmail({ ...dados, validadeEmMinutos: 48 * 60 });
    expect(m.subject).toBe('Confirme seu e-mail no dindin');
    expect(m.to).toBe('a@x.dev');
    expect(m.text).toContain('https://dindin.app/entrar#token=abc_DEF-123');
    expect(m.html).toContain('href="https://dindin.app/entrar#token=abc_DEF-123"');
    expect(m.text).toContain('Ele vale por 48 horas e funciona uma vez só.');
    expect(m.text).toContain('Se não foi você que criou a conta, ignore este e-mail.');
    expect(`${m.text}${m.html}`).not.toMatch(/[?&]token=/);
  });

  it('"Criar uma senha nova": assunto e /redefinir-senha#token= no fragmento', () => {
    const m = emailCriarSenhaNova(dados);
    expect(m.subject).toBe('Criar uma senha nova no dindin');
    expect(m.text).toContain('https://dindin.app/redefinir-senha#token=abc_DEF-123');
    expect(m.html).toContain('href="https://dindin.app/redefinir-senha#token=abc_DEF-123"');
    expect(m.text).toContain('Ele vale por 15 minutos e funciona uma vez só.');
    expect(m.html).toContain('Se não foi você, ignore este e-mail: sua senha continua a mesma.');
    expect(`${m.text}${m.html}`).not.toMatch(/[?&]token=/);
  });

  it('codifica o token, não duplica a barra da appUrl e escapa o link no HTML', () => {
    const m = emailCriarSenhaNova({ ...dados, appUrl: 'https://dindin.app/a&b/', token: 'x"y<z>' });
    expect(m.text).toContain('https://dindin.app/a&b/redefinir-senha#token=x%22y%3Cz%3E');
    expect(m.html).toContain('href="https://dindin.app/a&amp;b/redefinir-senha#token=x%22y%3Cz%3E"');
  });

  it.each([
    [1, '1 minuto'],
    [15, '15 minutos'],
    [90, '90 minutos'],
    [60, '1 hora'],
    [48 * 60, '48 horas'],
  ])('validade de %i min → "%s"', (minutos, texto) => {
    expect(textoDaValidade(minutos)).toBe(texto);
  });
});

describe('ObterMeUseCase, DescadastrarUseCase e ReativarUseCase', () => {
  it('obter devolve a conta da sessão; inexistente → NotFound', async () => {
    const s = await contaConfirmada('a@x.dev');
    const conta = await obterMe.execute({ subscriberId: s.id });
    expect(conta.email).toBe('a@x.dev');
    expect(conta.temSenha).toBe(true);
    await expect(obterMe.execute({ subscriberId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('descadastrar grava ativo=false; repetir não regrava', async () => {
    const s = await contaConfirmada('a@x.dev');
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
    const s = await contaConfirmada('a@x.dev');
    await descadastrar.execute({ subscriberId: s.id });

    expect((await reativar.execute({ subscriberId: s.id })).ativo).toBe(true);
    expect((await repo.findById(s.id))?.podeReceberEmail).toBe(true);

    const saves = repo.saves;
    await reativar.execute({ subscriberId: s.id });
    expect(repo.saves).toBe(saves);
  });

  it('descadastrar lido antes de uma troca de senha não desfaz a senha nova', async () => {
    const s = await contaConfirmada('a@x.dev');
    const lidaAntes = await repo.findById(s.id);
    await trocar.execute({ subscriberId: s.id, senhaAtual: SENHA, senhaNova: OUTRA_SENHA });

    lidaAntes!.descadastrar(clock.now());
    await repo.save(lidaAntes!);
    expect((await repo.findById(s.id))?.senhaHash).toBe(`senha(${OUTRA_SENHA})`);
  });

  it('descadastrar e reativar conta inexistente → NotFound, sem gravar nada', async () => {
    await expect(descadastrar.execute({ subscriberId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(reativar.execute({ subscriberId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.saves).toBe(0);
  });
});

describe('DescadastrarPorTokenUseCase', () => {
  it('token do e-mail descadastra sem precisar entrar', async () => {
    const s = await contaConfirmada('a@x.dev');
    await descadastrarPorToken.execute({ token: authTokens.issueUnsubscribe(s.id).token });
    expect((await repo.findById(s.id))?.ativo).toBe(false);
  });

  it('repetir o clique termina igual, sem erro e sem regravar', async () => {
    const s = await contaConfirmada('a@x.dev');
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
    ['token de sessão no lugar do de descadastro', (id: string) => authTokens.issueSession(id, 0).token],
  ])('%s → UnauthorizedError e nada muda', async (_caso, gerar) => {
    const s = await contaConfirmada('a@x.dev');
    await expect(descadastrarPorToken.execute({ token: gerar(s.id) })).rejects.toThrow(
      new UnauthorizedError('Link de descadastro inválido.'),
    );
    expect((await repo.findById(s.id))?.ativo).toBe(true);
  });

  it('token vencido → UnauthorizedError', async () => {
    const s = await contaConfirmada('a@x.dev');
    const { token } = authTokens.issueUnsubscribe(s.id);
    clock.advance(366 * DIA);
    await expect(descadastrarPorToken.execute({ token })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
