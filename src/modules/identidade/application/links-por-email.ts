import type { SecureTokenGenerator } from '../../../shared/application/ports';
import type { Subscriber } from '../domain/subscriber';

/*
  Emissão dos links que vão por e-mail — o "Confirme seu e-mail" (cadastro) e o
  "Criar uma senha nova" (Esqueci a senha). A lógica que era do link mágico,
  num lugar só:
  - o token só existe no e-mail; o banco guarda o hash (SecureTokenGenerator)
    com a finalidade na frente (chaveDoLink): cada link só serve pra sua rota;
  - cada finalidade tem a sua validade;
  - limite por endereço: sem reenvio se o último link saiu há menos de 60 s
    (além do limite por IP da rota). Sem ele, qualquer um lota a caixa de
    entrada de alguém trocando de IP.
*/

/** Regra do produto: sem reenvio se o último link do endereço saiu há menos disso. */
export const INTERVALO_MINIMO_ENTRE_LINKS_SEGUNDOS = 60;

/** Inexistente, usado, vencido ou trocado por um link novo: a mesma resposta pra todos. */
export const MENSAGEM_LINK_INVALIDO = 'Esse link expirou ou já foi usado. Peça um novo.';

export interface LinksConfig {
  /** base do frontend: `${appUrl}/entrar#token=…` e `${appUrl}/redefinir-senha#token=…` */
  appUrl: string;
  /** validade do link "Confirme seu e-mail" (LINK_CONFIRMACAO_HORAS) */
  confirmationLinkTtlHours: number;
  /** validade do link "Criar uma senha nova" (LINK_MAGICO_MINUTOS) */
  resetLinkTtlMinutes: number;
  linkResendCooldownSeconds: number;
}

export type FinalidadeDoLink = 'confirmacao' | 'redefinicao';

/**
 * O que a coluna `token` guarda (e o que cada rota procura): a finalidade na
 * frente do hash, "confirmacao:<sha256>" ou "redefinicao:<sha256>".
 *
 * Os dois links dividem a coluna, mas não servem um pelo outro: o "Confirme seu
 * e-mail" (48 h) não cria senha, e o "Criar uma senha nova" não abre sessão sem
 * trocar a senha (seria o login sem senha que saiu do produto). Como a finalidade
 * está no próprio valor, o compare-and-set do consumo (WHERE token = …) já confere
 * a finalidade junto — nada muda no repositório.
 */
export function chaveDoLink(secureTokens: SecureTokenGenerator, finalidade: FinalidadeDoLink, token: string): string {
  return `${finalidade}:${secureTokens.hash(token)}`;
}

export interface LinkEmitido {
  /** vai no e-mail, e só lá */
  token: string;
  /** vai pro banco (chaveDoLink: finalidade + hash) */
  tokenHash: string;
  expiraEm: Date;
  validadeEmMinutos: number;
}

export class EmissorDeLinks {
  constructor(
    private readonly secureTokens: SecureTokenGenerator,
    private readonly config: LinksConfig,
  ) {}

  get appUrl(): string {
    return this.config.appUrl;
  }

  validadeEmMinutos(finalidade: FinalidadeDoLink): number {
    return finalidade === 'confirmacao' ? this.config.confirmationLinkTtlHours * 60 : this.config.resetLinkTtlMinutes;
  }

  /** Um token novo. Quem chama grava o hash (Subscriber.criar ou emitirLinkMagico). */
  gerar(finalidade: FinalidadeDoLink, agora: Date): LinkEmitido {
    const token = this.secureTokens.generate();
    const validadeEmMinutos = this.validadeEmMinutos(finalidade);
    return {
      token,
      tokenHash: chaveDoLink(this.secureTokens, finalidade, token),
      expiraEm: new Date(agora.getTime() + validadeEmMinutos * 60_000),
      validadeEmMinutos,
    };
  }

  /**
   * O endereço recebeu um link há menos do intervalo mínimo?
   *
   * A coluna guarda só a validade, então a emissão é deduzida dela — e o link
   * pendente pode ser de qualquer uma das duas finalidades. Deduz com as duas:
   * com a validade errada, a "emissão" cai horas longe de agora (48 h contra 15
   * min), nunca dentro do intervalo; com a certa, cai no instante real.
   */
  emitiuHaPouco(subscriber: Subscriber, agora: Date): boolean {
    const intervaloMs = this.config.linkResendCooldownSeconds * 1000;
    return (['confirmacao', 'redefinicao'] as const).some((finalidade) => {
      const emitidoEm = subscriber.linkEmitidoEm(this.validadeEmMinutos(finalidade));
      if (emitidoEm === null) return false;
      // valor absoluto: uma emissão "no futuro" vem de relógios de instâncias levemente
      // desalinhados (conta como agora) ou de validade reduzida na config — nesse caso a
      // diferença passa do intervalo e o endereço não fica travado até a data calculada
      return Math.abs(agora.getTime() - emitidoEm.getTime()) < intervaloMs;
    });
  }
}
