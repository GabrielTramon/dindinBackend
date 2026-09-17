import type { Clock, IdGenerator } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/domain/errors';
import type { CategoriasRepository } from '../../categorias';
import { GastoFixo, MAX_GASTOS_FIXOS } from '../domain/gasto-fixo';
import type { GastosFixosRepository } from '../domain/gastos-fixos-repository';
import type { GastoFixoComCategoria } from './gasto-com-categoria';
import type { PerfilGateway } from './ports';

export interface AdicionarGastoFixoInput {
  subscriberId: string;
  categoriaId: string;
  valor: number;
}

export class AdicionarGastoFixoUseCase implements UseCase<AdicionarGastoFixoInput, GastoFixoComCategoria> {
  constructor(
    private readonly gastosFixos: GastosFixosRepository,
    private readonly categorias: CategoriasRepository,
    private readonly perfis: PerfilGateway,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute({ subscriberId, categoriaId, valor }: AdicionarGastoFixoInput): Promise<GastoFixoComCategoria> {
    if (!(await this.perfis.exists(subscriberId))) {
      throw new BusinessRuleError('Crie seu perfil antes de adicionar gastos.');
    }

    const categoria = await this.categorias.findById(categoriaId);
    // a FK do banco aceitaria a personalizada de outra pessoa; quem barra é esta checagem.
    // Responde igual a inexistente pra não confirmar que o id existe.
    if (!categoria || !categoria.ehVisivelPara(subscriberId)) {
      throw new NotFoundError('Categoria não encontrada.');
    }

    /*
      Checagens amigáveis. Sob concorrência:
      - categoria repetida: o @@unique (perfil, categoria) segura e o repositório lança ConflictError;
      - limite: dois pedidos simultâneos com 19 gastos podem chegar a 21. Não há constraint pra
        contagem e travar o perfil a cada inclusão não compensa pra uma corrida da própria pessoa.
    */
    if ((await this.gastosFixos.countBySubscriber(subscriberId)) >= MAX_GASTOS_FIXOS) {
      throw new BusinessRuleError(
        `Você chegou no limite de ${MAX_GASTOS_FIXOS} gastos fixos. Remova um que não usa mais antes de adicionar outro.`,
      );
    }
    if (await this.gastosFixos.existsInCategory(subscriberId, categoria.id)) {
      throw new ConflictError(`Você já tem um gasto em ${categoria.nome}. Altere o valor dele.`, {
        categoriaId: 'Você já tem um gasto nessa categoria',
      });
    }

    const gasto = GastoFixo.criar({
      id: this.ids.generate(),
      subscriberId,
      categoriaId: categoria.id,
      valor,
      agora: this.clock.now(),
    });
    await this.gastosFixos.save(gasto);
    return { gasto, categoria };
  }
}
