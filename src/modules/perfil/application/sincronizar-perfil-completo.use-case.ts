import type { Clock, IdGenerator, TransactionManager } from '../../../shared/application/ports';
import type { UseCase } from '../../../shared/application/use-case';
import { ValidationError } from '../../../shared/domain/errors';
import { ensureMoneyPrecision, validateField } from '../../../shared/domain/guards';
import { gastoFixoSchema } from '../../../shared/motor/schema';
import { Categoria, type CategoriasRepository } from '../../categorias';
import { Divida, type DividasRepository } from '../../dividas';
import { GastoFixo, type GastosFixosRepository } from '../../gastos-fixos';
import { Perfil } from '../domain/perfil';
import type { PerfisRepository } from '../domain/perfis-repository';
import { gravarPerfil } from './gravar-perfil';
import { resolverGastosDoMotor, type CarregarPerfilDoMotorUseCase, type PerfilDoMotor } from './perfil-do-motor';
import { perfilNaoRespondido } from './perfil-nao-respondido';

/*
  PUT /perfil/completo: o frontend manda o perfil inteiro, no formato do motor,
  e o servidor passa a guardar exatamente isso — escalares, gastos fixos
  (resolvendo "outro" + nome em categoria) e dívidas.

  Tudo que dá pra validar sem o banco é validado ANTES da transação: em memória
  não há rollback, e o erro mais comum (centavo quebrado numa linha) não pode
  deixar meio perfil gravado em nenhum dos modos. O que depende do banco
  (resolver categorias, somar linhas) fica dentro dela, e no Postgres um erro ali
  desfaz tudo.

  Dentro da transação, a ordem importa:
  (a) o perfil é gravado PRIMEIRO. Satisfaz a FK de gastos e dívidas e, no
      Postgres, trava a linha do perfil: dois PUTs simultâneos da mesma pessoa
      fazem fila aqui, e o segundo só lê categorias e gastos depois que o
      primeiro confirmou — senão os dois criariam a mesma categoria personalizada;
  (b) lê categorias visíveis e gastos antigos;
  (c) resolve as linhas do frontend em categorias (ver resolverGastosDoMotor);
  (d) cria as personalizadas novas. Sem garantirNomeDisponivel (a resolução já
      reaproveita nome do catálogo e das próprias) e sem o limite de
      personalizadas: o perfil do frontend já é limitado a MAX_GASTOS_FIXOS linhas;
  (e) troca a lista de gastos; (f) troca a lista de dívidas;
  (g) apaga as personalizadas da pessoa que tinham gasto e deixaram de ter.
      Só essas: personalizada criada por POST /categorias sem gasto nenhum
      continua, porque não foi a sincronização que a trouxe.
*/

export interface SincronizarPerfilCompletoInput {
  subscriberId: string;
  perfil: PerfilDoMotor;
}

/** Relança ValidationError com os campos debaixo de `prefixo`: "valor" vira "gastosFixos.2.valor". */
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

// a mesma regra de valor do GastoFixo (schema do motor + 2 casas)
const valorDoGasto = gastoFixoSchema.shape.valor;

export class SincronizarPerfilCompletoUseCase implements UseCase<SincronizarPerfilCompletoInput, PerfilDoMotor> {
  constructor(
    private readonly perfis: PerfisRepository,
    private readonly categorias: CategoriasRepository,
    private readonly gastosFixos: GastosFixosRepository,
    private readonly dividas: DividasRepository,
    private readonly transactions: TransactionManager,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly carregar: CarregarPerfilDoMotorUseCase,
  ) {}

  async execute({ subscriberId, perfil: entrada }: SincronizarPerfilCompletoInput): Promise<PerfilDoMotor> {
    const agora = this.clock.now();
    /*
      1 ms a mais por posição. Tudo que o replaceAll grava nasceria no mesmo
      instante, e o banco desempataria pelo id — um UUID aleatório: a lista de
      dívidas voltaria embaralhada e mudaria a cada PUT com o mesmo corpo.
    */
    const instante = (posicao: number) => new Date(agora.getTime() + posicao);

    const novoPerfil = Perfil.criar({
      subscriberId,
      rendaMensal: entrada.rendaMensal,
      tipoRenda: entrada.tipoRenda,
      idade: entrada.idade,
      moradia: entrada.moradia,
      custoMoradia: entrada.custoMoradia,
      guardado: entrada.guardado,
      agora,
    });
    // linha a linha ANTES de somar: 10,005 + 5 arredondaria pra 15,01 calado, e o erro perderia a linha
    entrada.gastosFixos.forEach((linha, i) =>
      noCaminho(`gastosFixos.${i}`, () => ensureMoneyPrecision(validateField(valorDoGasto, linha.valor, 'valor'), 'valor')),
    );
    const dividas = entrada.dividas.map((divida, i) =>
      noCaminho(`dividas.${i}`, () =>
        Divida.criar({
          id: this.ids.generate(),
          subscriberId,
          tipo: divida.tipo,
          saldo: divida.saldo,
          // ausente no formato do frontend = sem parcela fixa / taxa padrão do tipo
          parcela: divida.parcela ?? null,
          taxaAnual: divida.taxaAnual ?? null,
          agora: instante(i),
        }),
      ),
    );

    await this.transactions.run(async () => {
      // (a)
      await gravarPerfil(this.perfis, novoPerfil);

      // (b)
      const visiveis = await this.categorias.listVisible(subscriberId);
      const antigos = await this.gastosFixos.listBySubscriber(subscriberId);

      // (c)
      const resolvidos = resolverGastosDoMotor(entrada.gastosFixos, visiveis);

      // monta tudo antes de gravar: um valor somado inválido falha sem ter criado categoria nenhuma
      const antigoPorCategoria = new Map(antigos.map((gasto) => [gasto.categoriaId, gasto]));
      const categoriasNovas: Categoria[] = [];
      const gastos = resolvidos.map((resolvido, posicao) => {
        let categoriaId: string;
        if (resolvido.tipo === 'existente') {
          categoriaId = resolvido.categoria.id;
        } else {
          const categoria = Categoria.criarPersonalizada({ id: this.ids.generate(), nome: resolvido.nome, subscriberId, agora });
          categoriasNovas.push(categoria);
          categoriaId = categoria.id;
        }
        // categoria que continua mantém o id e a data do gasto: quem guardou o id (GET /perfil/gastos-fixos) não o perde
        const antigo = antigoPorCategoria.get(categoriaId);
        return noCaminho(`gastosFixos.${resolvido.indice}`, () =>
          GastoFixo.criar({
            id: antigo?.id ?? this.ids.generate(),
            subscriberId,
            categoriaId,
            valor: resolvido.valor,
            agora: antigo?.criadoEm ?? instante(posicao),
          }),
        );
      });

      // (d)
      for (const categoria of categoriasNovas) await this.categorias.save(categoria);
      // (e)
      await this.gastosFixos.replaceAll(subscriberId, gastos);
      // (f)
      await this.dividas.replaceAll(subscriberId, dividas);

      // (g) depois do replaceAll: antes dele a categoria ainda estaria em uso (FK Restrict)
      const usadas = new Set(gastos.map((gasto) => gasto.categoriaId));
      const visiveisPorId = new Map(visiveis.map((categoria) => [categoria.id, categoria]));
      const abandonadas = new Set(antigos.map((gasto) => gasto.categoriaId).filter((id) => !usadas.has(id)));
      for (const categoriaId of abandonadas) {
        const categoria = visiveisPorId.get(categoriaId);
        if (categoria && !categoria.ehDoCatalogo && categoria.pertenceA(subscriberId)) {
          await this.categorias.delete(categoria.id);
        }
      }
    });

    // o que ficou gravado, no formato do frontend: é isto que o cliente deve guardar
    const recarregado = await this.carregar.execute({ subscriberId });
    // só falta se a conta foi excluída entre o fim da transação e esta leitura
    if (!recarregado) throw perfilNaoRespondido();
    return recarregado;
  }
}
