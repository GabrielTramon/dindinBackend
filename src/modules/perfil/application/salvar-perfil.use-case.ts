import type { Clock } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { Perfil, type DadosPerfil } from '../domain/perfil';
import type { PerfisRepository } from '../domain/perfis-repository';
import { gravarPerfil, type PerfilGravado } from './gravar-perfil';

export interface SalvarPerfilInput extends DadosPerfil {
  subscriberId: string;
}

/** Todas as respostas escalares de uma vez: cria o perfil ou substitui as respostas do existente. */
export class SalvarPerfilUseCase implements UseCase<SalvarPerfilInput, PerfilGravado> {
  constructor(
    private readonly perfis: PerfisRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: SalvarPerfilInput): Promise<PerfilGravado> {
    // valida antes de ler: dado inválido é 400 sem nenhuma consulta
    const novo = Perfil.criar({
      subscriberId: input.subscriberId,
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
      agora: this.clock.now(),
    });
    return gravarPerfil(this.perfis, novo);
  }
}
