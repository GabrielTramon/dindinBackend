import { beforeEach, describe, expect, it } from 'vitest';
import type { IdGenerator } from '../../../shared/application/ports';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/errors';
import { FixedClock, SequentialIdGenerator } from '../../../shared/infra/in-memory/doubles';
import { aporteParaMeta } from '../../../shared/motor/projecao';
import { MAX_METAS, Meta } from '../domain/meta';
import { InMemoryMetasRepository } from '../infra/database/in-memory-metas-repository';
import { AtualizarMetaUseCase } from './atualizar-meta.use-case';
import { CriarMetaUseCase } from './criar-meta.use-case';
import { DespublicarMetaUseCase } from './despublicar-meta.use-case';
import { ListarMetasUseCase } from './listar-metas.use-case';
import { ObterMetaPublicaUseCase } from './obter-meta-publica.use-case';
import { ObterMetaUseCase } from './obter-meta.use-case';
import { PublicarMetaUseCase } from './publicar-meta.use-case';
import { RemoverMetaUseCase } from './remover-meta.use-case';
import { baseDoSlug, gerarSlugPublico, sufixoDoSlug } from './slug-publico';

let repo: InMemoryMetasRepository;
let clock: FixedClock;
let ids: SequentialIdGenerator;
let criar: CriarMetaUseCase;
let listar: ListarMetasUseCase;
let obter: ObterMetaUseCase;
let atualizar: AtualizarMetaUseCase;
let remover: RemoverMetaUseCase;
let publicar: PublicarMetaUseCase;
let despublicar: DespublicarMetaUseCase;
let obterPublica: ObterMetaPublicaUseCase;

const UMA_HORA = 60 * 60 * 1000;
const INICIO = new Date('2026-09-17T12:00:00.000Z');

beforeEach(() => {
  repo = new InMemoryMetasRepository();
  clock = new FixedClock(INICIO);
  ids = new SequentialIdGenerator('meta');
  criar = new CriarMetaUseCase(repo, ids, clock);
  listar = new ListarMetasUseCase(repo, clock);
  obter = new ObterMetaUseCase(repo, clock);
  atualizar = new AtualizarMetaUseCase(repo, clock);
  remover = new RemoverMetaUseCase(repo);
  publicar = new PublicarMetaUseCase(repo, ids, clock);
  despublicar = new DespublicarMetaUseCase(repo, clock);
  obterPublica = new ObterMetaPublicaUseCase(repo);
});

const viagem = (subscriberId = 'sub-1') =>
  criar.execute({ subscriberId, nome: 'Viagem pro Japão', valorAlvo: 12000, prazoMeses: 12, acumulado: 2000 });

/** Ids escolhidos a dedo, pra forçar colisão de slug. */
class FilaDeIds implements IdGenerator {
  constructor(private readonly fila: string[]) {}

  generate(): string {
    const id = this.fila.shift();
    if (id === undefined) throw new Error('fila de ids acabou');
    return id;
  }
}

/** A checagem nunca vê colisão: só o unique do save pega, como numa corrida entre dois pedidos. */
class RepositorioSemChecagemDeSlug extends InMemoryMetasRepository {
  override async isPublicSlugTaken(): Promise<boolean> {
    return false;
  }
}

class RepositorioQueFalhaNoSave extends InMemoryMetasRepository {
  falhar = false;

  override async save(meta: Meta): Promise<void> {
    if (this.falhar) throw new Error('banco fora do ar');
    return super.save(meta);
  }
}

const metaViagem = (id: string, subscriberId: string) =>
  Meta.criar({ id, subscriberId, nome: 'Viagem', valorAlvo: 1, prazoMeses: 1, agora: INICIO });

/** "Viagem" de sub-2 publicada em viagem-aaaaaa e "Viagem" de sub-1 (id "minha") ainda privada. */
async function cenarioDeColisao(destino: InMemoryMetasRepository): Promise<void> {
  const outra = metaViagem('outra', 'sub-2');
  outra.publicar('viagem-aaaaaa', INICIO);
  await destino.save(outra);
  await destino.save(metaViagem('minha', 'sub-1'));
}

describe('CriarMetaUseCase', () => {
  it('cria, grava e devolve com a projeção', async () => {
    const { meta, projecao } = await viagem();
    expect(meta.toSnapshot()).toEqual({
      id: 'meta-1',
      subscriberId: 'sub-1',
      nome: 'Viagem pro Japão',
      valorAlvo: 12000,
      aporteMensal: null,
      prazoMeses: 12,
      acumulado: 2000,
      publicSlug: null,
      criadoEm: INICIO,
      atualizadoEm: INICIO,
    });
    expect(projecao).toEqual({
      faltante: 10000,
      aporteNecessario: aporteParaMeta(12000, 12, { saldoInicial: 2000 }),
      mesesEstimados: 12,
      mesEstimado: '2027-09',
    });
    expect((await repo.findById('meta-1', 'sub-1'))?.nome).toBe('Viagem pro Japão');
  });

  it('acumulado ausente é 0; null no prazo conta como não informado', async () => {
    const { meta } = await criar.execute({
      subscriberId: 'sub-1',
      nome: 'Carro',
      valorAlvo: 30000,
      aporteMensal: 900,
      prazoMeses: null,
    });
    expect(meta.acumulado).toBe(0);
    expect([meta.aporteMensal, meta.prazoMeses]).toEqual([900, null]);
  });

  it('aporte e prazo juntos → BusinessRuleError e nada é gravado', async () => {
    await expect(
      criar.execute({ subscriberId: 'sub-1', nome: 'X', valorAlvo: 100, aporteMensal: 10, prazoMeses: 10 }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await repo.countBySubscriber('sub-1')).toBe(0);
  });

  it('valor inválido → ValidationError', async () => {
    await expect(
      criar.execute({ subscriberId: 'sub-1', nome: 'X', valorAlvo: 10.001, prazoMeses: 10 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it(`para no limite de ${MAX_METAS}, contando só as da própria pessoa`, async () => {
    for (let i = 0; i < MAX_METAS; i++) {
      await criar.execute({ subscriberId: 'sub-1', nome: `Meta ${i}`, valorAlvo: 100, prazoMeses: 10 });
    }
    const excedente = criar.execute({ subscriberId: 'sub-1', nome: 'Mais uma', valorAlvo: 100, prazoMeses: 10 });
    await expect(excedente).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(excedente).rejects.toThrow(`Você chegou no limite de ${MAX_METAS} metas`);
    expect(await repo.countBySubscriber('sub-1')).toBe(MAX_METAS);
    await expect(viagem('sub-2')).resolves.toBeDefined();
  });
});

describe('ListarMetasUseCase', () => {
  it('só as da pessoa, da mais recente pra mais antiga, cada uma com projeção', async () => {
    await criar.execute({ subscriberId: 'sub-1', nome: 'Antiga', valorAlvo: 1000, aporteMensal: 250 });
    clock.advance(UMA_HORA);
    await criar.execute({ subscriberId: 'sub-1', nome: 'Nova', valorAlvo: 1000, acumulado: 1000, prazoMeses: 3 });
    await viagem('sub-2');

    const lista = await listar.execute({ subscriberId: 'sub-1' });
    expect(lista.map(({ meta }) => meta.nome)).toEqual(['Nova', 'Antiga']);
    expect(lista[0]?.projecao).toEqual({ faltante: 0, aporteNecessario: 0, mesesEstimados: 0, mesEstimado: '2026-09' });
    expect(lista[1]?.projecao.aporteNecessario).toBeNull();
    expect(lista[1]?.projecao.mesesEstimados).toBeGreaterThan(0);
  });

  it('sem metas → lista vazia', async () => {
    expect(await listar.execute({ subscriberId: 'sub-1' })).toEqual([]);
  });
});

describe('ObterMetaUseCase', () => {
  it('devolve a própria; de outra pessoa ou inexistente → NotFound', async () => {
    const { meta } = await viagem();
    expect((await obter.execute({ subscriberId: 'sub-1', metaId: meta.id })).meta.id).toBe(meta.id);
    await expect(obter.execute({ subscriberId: 'sub-2', metaId: meta.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(obter.execute({ subscriberId: 'sub-1', metaId: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a projeção é calculada na hora da leitura, não na da criação', async () => {
    const { meta } = await viagem();
    clock.set('2027-03-10T12:00:00.000Z');
    expect((await obter.execute({ subscriberId: 'sub-1', metaId: meta.id })).projecao.mesEstimado).toBe('2028-03');
  });
});

describe('AtualizarMetaUseCase', () => {
  it('altera só o que veio, grava e avança atualizadoEm', async () => {
    const { meta } = await viagem();
    clock.advance(UMA_HORA);
    const { meta: atualizada, projecao } = await atualizar.execute({
      subscriberId: 'sub-1',
      metaId: meta.id,
      acumulado: 12000,
    });
    expect(atualizada.toSnapshot()).toMatchObject({ nome: 'Viagem pro Japão', prazoMeses: 12, acumulado: 12000 });
    expect(atualizada.atualizadoEm).toEqual(new Date('2026-09-17T13:00:00.000Z'));
    expect(projecao.faltante).toBe(0);
    expect((await repo.findById(meta.id, 'sub-1'))?.acumulado).toBe(12000);
  });

  it('troca prazo por aporte mandando null no prazo', async () => {
    const { meta } = await viagem();
    const { meta: atualizada, projecao } = await atualizar.execute({
      subscriberId: 'sub-1',
      metaId: meta.id,
      aporteMensal: 1000,
      prazoMeses: null,
    });
    expect([atualizada.aporteMensal, atualizada.prazoMeses]).toEqual([1000, null]);
    expect(projecao.aporteNecessario).toBeNull();
    expect((await repo.findById(meta.id, 'sub-1'))?.prazoMeses).toBeNull();
  });

  it('aporte sem limpar o prazo → BusinessRuleError e o gravado não muda', async () => {
    const { meta } = await viagem();
    await expect(
      atualizar.execute({ subscriberId: 'sub-1', metaId: meta.id, aporteMensal: 1000, nome: 'Outro nome' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect((await repo.findById(meta.id, 'sub-1'))?.toSnapshot()).toEqual(meta.toSnapshot());
  });

  it('de outra pessoa → NotFound e nada muda', async () => {
    const { meta } = await viagem();
    await expect(atualizar.execute({ subscriberId: 'sub-2', metaId: meta.id, nome: 'Invadida' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await repo.findById(meta.id, 'sub-1'))?.nome).toBe('Viagem pro Japão');
  });
});

describe('RemoverMetaUseCase', () => {
  it('remove a própria; de outra pessoa → NotFound e continua lá; remover de novo → NotFound', async () => {
    const { meta } = await viagem();
    await expect(remover.execute({ subscriberId: 'sub-2', metaId: meta.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await repo.findById(meta.id, 'sub-1')).not.toBeNull();

    await remover.execute({ subscriberId: 'sub-1', metaId: meta.id });
    expect(await repo.findById(meta.id, 'sub-1')).toBeNull();
    await expect(remover.execute({ subscriberId: 'sub-1', metaId: meta.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('meta publicada removida some da página pública', async () => {
    const { meta } = await viagem();
    const { meta: publicada } = await publicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    await remover.execute({ subscriberId: 'sub-1', metaId: meta.id });
    await expect(obterPublica.execute({ slug: publicada.publicSlug ?? '' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('slug público', () => {
  it.each([
    ['Viagem pro Japão', 'viagem-pro-japao'],
    ['  Açaí & Pão de Queijo!! ', 'acai-pao-de-queijo'],
    ['CARRO---Novo  (2027)', 'carro-novo-2027'],
    ['--- reserva ---', 'reserva'],
    ['Ünïcödé çôm ÂCENTOS', 'unicode-com-acentos'],
    ['😀 🎉', 'meta'],
    ['日本旅行', 'meta'],
    ['', 'meta'],
  ])('base de %j → %j', (nome, base) => {
    expect(baseDoSlug(nome)).toBe(base);
  });

  it('corta a base em 40 sem deixar hífen no fim', () => {
    expect(baseDoSlug(`${'a'.repeat(39)} bcd`)).toBe('a'.repeat(39));
    expect(baseDoSlug('x'.repeat(60))).toBe('x'.repeat(40));
  });

  it('sufixo: os 6 últimos [a-z0-9] dos ids, sem hífen, juntando ids curtos', () => {
    expect(sufixoDoSlug(new FilaDeIds(['550E8400-E29B-41D4-A716-446655440000']))).toBe('440000');
    expect(sufixoDoSlug(new FilaDeIds(['id-1', 'id-2']))).toBe('id1id2');
    expect(() => sufixoDoSlug({ generate: () => '---' })).toThrow();
  });

  it('todo slug gerado passa na regra da entidade', () => {
    for (const nome of ['Viagem', 'x'.repeat(60), `${'a'.repeat(39)}-b`, '😀', 'a', 'Ç']) {
      const slug = gerarSlugPublico(nome, new SequentialIdGenerator('id'));
      const m = Meta.criar({ id: 'm', subscriberId: 's', nome, valorAlvo: 1, prazoMeses: 1, agora: INICIO });
      expect(() => m.publicar(slug, INICIO)).not.toThrow();
      expect(slug.length).toBeLessThanOrEqual(47);
    }
  });
});

describe('PublicarMetaUseCase', () => {
  it('gera o slug a partir do nome, grava e avança atualizadoEm', async () => {
    const { meta } = await viagem();
    clock.advance(UMA_HORA);
    const { meta: publicada } = await publicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    // ids "meta-2" e "meta-3" sem o hífen: "meta2meta3" → os 6 do fim
    expect(publicada.publicSlug).toBe('viagem-pro-japao-2meta3');
    expect(publicada.atualizadoEm).toEqual(new Date('2026-09-17T13:00:00.000Z'));
    expect((await repo.findById(meta.id, 'sub-1'))?.publicSlug).toBe('viagem-pro-japao-2meta3');
  });

  it('já publicada → devolve o mesmo slug, sem gravar de novo', async () => {
    const { meta } = await viagem();
    const primeira = await publicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    clock.advance(UMA_HORA);
    const segunda = await publicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    expect(segunda.meta.publicSlug).toBe(primeira.meta.publicSlug);
    expect(segunda.meta.atualizadoEm).toEqual(primeira.meta.atualizadoEm);
  });

  it('de outra pessoa → NotFound e não publica', async () => {
    const { meta } = await viagem();
    await expect(publicar.execute({ subscriberId: 'sub-2', metaId: meta.id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await repo.findById(meta.id, 'sub-1'))?.publicSlug).toBeNull();
  });

  it('slug já usado (isPublicSlugTaken) → sorteia outro sufixo', async () => {
    await cenarioDeColisao(repo);
    const usecase = new PublicarMetaUseCase(repo, new FilaDeIds(['aaaaaa', 'bbbbbb']), clock);
    const { meta } = await usecase.execute({ subscriberId: 'sub-1', metaId: 'minha' });
    expect(meta.publicSlug).toBe('viagem-bbbbbb');
  });

  it('corrida: o save colide (ConflictError) depois da checagem → sorteia outro', async () => {
    const semChecagem = new RepositorioSemChecagemDeSlug();
    await cenarioDeColisao(semChecagem);
    const usecase = new PublicarMetaUseCase(semChecagem, new FilaDeIds(['aaaaaa', 'bbbbbb']), clock);

    const { meta } = await usecase.execute({ subscriberId: 'sub-1', metaId: 'minha' });
    expect(meta.publicSlug).toBe('viagem-bbbbbb');
    expect((await semChecagem.findByPublicSlug('viagem-aaaaaa'))?.id).toBe('outra');
    expect((await semChecagem.findByPublicSlug('viagem-bbbbbb'))?.id).toBe('minha');
  });

  it('3 colisões seguidas → ConflictError e a meta continua privada', async () => {
    const semChecagem = new RepositorioSemChecagemDeSlug();
    await cenarioDeColisao(semChecagem);
    const usecase = new PublicarMetaUseCase(semChecagem, new FilaDeIds(['aaaaaa', 'aaaaaa', 'aaaaaa', 'bbbbbb']), clock);

    await expect(usecase.execute({ subscriberId: 'sub-1', metaId: 'minha' })).rejects.toBeInstanceOf(ConflictError);
    expect((await semChecagem.findById('minha', 'sub-1'))?.publicSlug).toBeNull();
  });

  it('erro que não é conflito não é engolido nem repetido', async () => {
    const quebrado = new RepositorioQueFalhaNoSave();
    await quebrado.save(metaViagem('m1', 'sub-1'));
    quebrado.falhar = true;
    const fila = new FilaDeIds(['aaaaaa', 'bbbbbb']);
    const usecase = new PublicarMetaUseCase(quebrado, fila, clock);

    await expect(usecase.execute({ subscriberId: 'sub-1', metaId: 'm1' })).rejects.toThrow('banco fora do ar');
    // só uma tentativa consumiu id: sobrou o segundo
    expect(fila.generate()).toBe('bbbbbb');
  });
});

describe('DespublicarMetaUseCase', () => {
  it('tira o slug, grava e libera o endereço', async () => {
    const { meta } = await viagem();
    const { meta: publicada } = await publicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    clock.advance(UMA_HORA);

    const { meta: privada } = await despublicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    expect(privada.publicSlug).toBeNull();
    expect(privada.atualizadoEm).toEqual(new Date('2026-09-17T13:00:00.000Z'));
    expect((await repo.findById(meta.id, 'sub-1'))?.publicSlug).toBeNull();
    expect(await repo.isPublicSlugTaken(publicada.publicSlug ?? '')).toBe(false);
  });

  it('já privada → devolve como está, sem avançar atualizadoEm', async () => {
    const { meta } = await viagem();
    clock.advance(UMA_HORA);
    const { meta: igual } = await despublicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    expect(igual.atualizadoEm).toEqual(meta.atualizadoEm);
  });

  it('de outra pessoa → NotFound e continua publicada', async () => {
    const { meta } = await viagem();
    await publicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    await expect(despublicar.execute({ subscriberId: 'sub-2', metaId: meta.id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await repo.findById(meta.id, 'sub-1'))?.publicSlug).not.toBeNull();
  });
});

describe('ObterMetaPublicaUseCase', () => {
  it('devolve só nome, progresso e atingida', async () => {
    const { meta } = await viagem();
    const { meta: publicada } = await publicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    expect(await obterPublica.execute({ slug: publicada.publicSlug ?? '' })).toEqual({
      nome: 'Viagem pro Japão',
      progresso: 0.1666,
      atingida: false,
    });
  });

  it('slug inexistente ou despublicado → NotFound', async () => {
    await expect(obterPublica.execute({ slug: 'nao-existe' })).rejects.toBeInstanceOf(NotFoundError);
    const { meta } = await viagem();
    const { meta: publicada } = await publicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    await despublicar.execute({ subscriberId: 'sub-1', metaId: meta.id });
    await expect(obterPublica.execute({ slug: publicada.publicSlug ?? '' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
