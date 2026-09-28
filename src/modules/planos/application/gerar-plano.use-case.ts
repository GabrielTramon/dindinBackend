import { isDeepStrictEqual } from 'node:util';
import type { Clock, IdGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { BusinessRuleError, ConflictError } from '../../../shared/domain/errors';
import { gerarPlano } from '../../../shared/motor/motor';
import { normalizarComoJson, VersaoPlano } from '../domain/versao-plano';
import type { VersoesPlanoRepository } from '../domain/versoes-plano-repository';
import type { PerfilDoMotorReader } from './ports';

/*
  Gera o plano com o motor a partir do perfil salvo e grava como a próxima
  versão. O cliente não manda o perfil nem o resultado: o servidor calcula
  com o que está no banco, então o histórico não depende de confiar no cliente.

  Sem mudança, sem versão nova: se a última versão foi calculada com a mesma
  entrada e o motor chega no mesmo resultado, devolve ela. O resultado também
  entra na comparação porque o motor muda (taxa de referência, regras) — com
  o mesmo perfil e um motor novo, a pessoa precisa ver o plano recalculado.

  Concorrência: dois recálculos ao mesmo tempo leem o mesmo nextVersion e um
  deles bate na unique (subscriberId, versao) do banco. Quem perdeu tenta de
  novo do zero, relendo a última versão — se a outra requisição gravou a mesma
  entrada, devolve a dela em vez de duplicar. Cada tentativa é independente e
  nenhuma roda dentro de transactions.run: no Postgres, depois do erro de
  unique a transação fica abortada e qualquer consulta seguinte falharia.
*/

export const TENTATIVAS_DE_GRAVAR_VERSAO = 3;

export interface GerarPlanoInput {
  subscriberId: string;
}

export interface GerarPlanoOutput {
  versao: VersaoPlano;
  /** false quando nada mudou e a última versão foi devolvida */
  criada: boolean;
}

export class GerarPlanoUseCase implements UseCase<GerarPlanoInput, GerarPlanoOutput> {
  constructor(
    private readonly versoesPlano: VersoesPlanoRepository,
    private readonly perfilReader: PerfilDoMotorReader,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId }: GerarPlanoInput): Promise<GerarPlanoOutput> {
    const perfil = await this.perfilReader.load(subscriberId);
    if (!perfil) throw new BusinessRuleError('Responda o seu perfil antes de gerar o plano.');

    // no formato em que volta do banco, pra comparar igual na memória e no Postgres
    const entrada = normalizarComoJson(perfil);
    const resultado = normalizarComoJson(gerarPlano(entrada));
    const agora = this.clock.now();

    for (let tentativa = 1; tentativa <= TENTATIVAS_DE_GRAVAR_VERSAO; tentativa++) {
      const ultima = await this.versoesPlano.findLatest(subscriberId);
      if (ultima && isDeepStrictEqual(ultima.inputSnap, entrada) && isDeepStrictEqual(ultima.resultado, resultado)) {
        return { versao: ultima, criada: false };
      }

      const versao = VersaoPlano.criar({
        id: this.ids.generate(),
        subscriberId,
        versao: await this.versoesPlano.nextVersion(subscriberId),
        inputSnap: entrada,
        resultado,
        criadoEm: agora,
      });
      try {
        await this.versoesPlano.save(versao);
        return { versao, criada: true };
      } catch (error) {
        // só a corrida pela mesma versão merece nova tentativa; qualquer outro erro sobe
        if (!(error instanceof ConflictError)) throw error;
      }
    }

    throw new ConflictError('Outro cálculo do plano estava em andamento. Tente de novo.');
  }
}
