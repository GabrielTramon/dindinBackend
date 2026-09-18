import type { Page, PageRequest } from '../../../shared/application/pagination';
import type { VersaoPlano } from './versao-plano';

export interface VersoesPlanoRepository {
  findLatest(subscriberId: string): Promise<VersaoPlano | null>;
  findByVersion(subscriberId: string, versao: number): Promise<VersaoPlano | null>;
  /**
   * A versão que valia num instante: a mais nova com `criadoEm` ANTES de `ate`
   * (limite exclusivo). É o que faz o check-in de agosto continuar julgado
   * pelo plano de agosto mesmo depois de a pessoa trocar o ritmo em setembro.
   *
   * Recebe Date, não competência: quem sabe converter competência em instante
   * é `check-ins` (dono de FUSO_DO_PRODUTO), e `planos` não pode importá-lo.
   *
   * Sem nenhuma versão até lá, devolve a MAIS ANTIGA da pessoa: quem se
   * cadastra em setembro e responde o check-in de agosto (é o que o e-mail do
   * dia 1º pede) tem que ver alguma comparação, não `null`. Null só quando a
   * pessoa nunca gerou plano.
   *
   * `versao` e `criadoEm` são monotônicos juntos — versões são imutáveis e
   * nascem uma por recálculo, sempre com a data do momento —, então filtrar
   * por data e ordenar por versão devolve a mesma linha que ordenar por data.
   */
  findEmVigorEm(subscriberId: string, ate: Date): Promise<VersaoPlano | null>;
  /** da versão mais nova pra mais antiga */
  list(subscriberId: string, page: PageRequest): Promise<Page<VersaoPlano>>;
  /** maior versão + 1, ou 1 quando não há nenhuma */
  nextVersion(subscriberId: string): Promise<number>;

  /** @throws ConflictError quando a versão já existe (dois recálculos ao mesmo tempo) */
  save(versao: VersaoPlano): Promise<void>;
  deleteAllBySubscriber(subscriberId: string): Promise<void>;
}
