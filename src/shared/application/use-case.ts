/** Um caso de uso: uma ação do produto, com entrada e saída explícitas. */
export interface UseCase<Input, Output> {
  execute(input: Input): Promise<Output>;
}
