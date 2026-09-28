import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { ValidationError } from '../../../shared/domain/errors';
import { Grupo, validarOrganizacao, type ItemGrupoInput } from '../domain/grupo';
import type { GruposRepository } from '../domain/grupos-repository';

/*
  PUT /organizacao: o cliente manda a árvore inteira e o servidor passa a
  guardar exatamente isso. Substituição, não merge — a árvore vive no
  localStorage e o servidor é a cópia, então "o que chegou é o que vale".

  Tudo é validado ANTES de tocar no repositório: em memória não há rollback, e
  um centavo quebrado num item não pode deixar meia árvore gravada em nenhum
  dos dois modos.
*/

export interface GrupoEntrada {
  /** vem do cliente: é o id do localStorage */
  id: string;
  nome: string;
  icone?: string;
  valor: number;
  contaParaMeta?: boolean;
  rendimentoMensal?: number;
  doSistema?: boolean;
  itens?: readonly ItemGrupoInput[];
}

export interface SalvarOrganizacaoInput {
  subscriberId: string;
  grupos: readonly GrupoEntrada[];
}

/** Relança ValidationError com os campos debaixo de `prefixo`: "itens.1.valor" vira "grupos.0.itens.1.valor". */
function noCaminho<T>(prefixo: string, acao: () => T): T {
  try {
    return acao();
  } catch (error) {
    if (error instanceof ValidationError && error.details) {
      const details = Object.fromEntries(
        Object.entries(error.details).map(([campo, mensagem]) => [`${prefixo}.${campo}`, mensagem]),
      );
      throw new ValidationError(error.message, details);
    }
    throw error;
  }
}

export class SalvarOrganizacaoUseCase implements UseCase<SalvarOrganizacaoInput, Grupo[]> {
  constructor(
    private readonly grupos: GruposRepository,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId, grupos: entrada }: SalvarOrganizacaoInput): Promise<Grupo[]> {
    /*
      `criadoEm` marca a gravação, não o nascimento do grupo na tela: a árvore é
      substituída inteira e quem sobrevive ao round-trip é o id do cliente. Por
      isso o mesmo instante pra todos — a ordem da lista é posicional (`ordem`),
      não cronológica, e nada aqui desempata por data.
    */
    const agora = this.clock.now();

    // campo a campo, nunca `{ ...grupo }`: uma chave extra vinda do cliente
    // (subscriberId, ordem) trocaria o dono ou a posição em silêncio
    const grupos = entrada.map((grupo, indice) =>
      noCaminho(`grupos.${indice}`, () =>
        Grupo.criar({
          id: grupo.id,
          subscriberId,
          nome: grupo.nome,
          icone: grupo.icone,
          valor: grupo.valor,
          contaParaMeta: grupo.contaParaMeta,
          rendimentoMensal: grupo.rendimentoMensal,
          doSistema: grupo.doSistema,
          // a ordem é posicional: a posição no corpo é a posição na tela
          ordem: indice,
          itens: grupo.itens,
          agora,
        }),
      ),
    );

    validarOrganizacao(grupos);
    await this.grupos.replaceAll(subscriberId, grupos);

    // o que ficou gravado, na ordem em que ficou: é isto que o cliente deve guardar
    return grupos;
  }
}
