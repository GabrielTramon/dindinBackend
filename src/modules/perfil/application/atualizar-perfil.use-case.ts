import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import type { DadosPerfil, Perfil } from '../domain/perfil';
import type { PerfisRepository } from '../domain/perfis-repository';
import { perfilNaoRespondido } from './perfil-nao-respondido';

export interface AtualizarPerfilInput extends Partial<DadosPerfil> {
  subscriberId: string;
}

/** Só as respostas informadas; as outras continuam como estão. */
export class AtualizarPerfilUseCase implements UseCase<AtualizarPerfilInput, Perfil> {
  constructor(
    private readonly perfis: PerfisRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: AtualizarPerfilInput): Promise<Perfil> {
    const perfil = await this.perfis.findBySubscriberId(input.subscriberId);
    if (!perfil) throw perfilNaoRespondido();

    // campo a campo: o subscriberId da entrada é o dono, nunca um dado do perfil
    perfil.atualizar(
      {
        rendaMensal: input.rendaMensal,
        rendaInformada: input.rendaInformada,
        salarioBruto: input.salarioBruto,
        dependentes: input.dependentes,
        competenciaTabela: input.competenciaTabela,
        ritmo: input.ritmo,
      aporteEscolhido: input.aporteEscolhido,
        meta: input.meta,
        tipoRenda: input.tipoRenda,
        idade: input.idade,
        moradia: input.moradia,
        custoMoradia: input.custoMoradia,
        guardado: input.guardado,
      },
      this.clock.now(),
    );
    await this.perfis.save(perfil);
    return perfil;
  }
}
