import { InMemorySubscribersRepository } from './in-memory-subscribers-repository';
import { describeSubscribersRepositoryContract } from './subscribers-repository.contract';

describeSubscribersRepositoryContract('em memória', async () => ({
  repo: new InMemorySubscribersRepository(),
}));
