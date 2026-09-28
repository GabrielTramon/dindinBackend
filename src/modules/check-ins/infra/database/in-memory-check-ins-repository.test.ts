import { describeCheckInsRepositoryContract } from './check-ins-repository.contract';
import { InMemoryCheckInsRepository } from './in-memory-check-ins-repository';

describeCheckInsRepositoryContract('em memória', async () => {
  const subscribers = new Set<string>();
  const repo = new InMemoryCheckInsRepository({ subscriberExists: async (id) => subscribers.has(id) });
  return {
    repo,
    criarSubscriber: async () => {
      const id = `sub-${subscribers.size + 1}`;
      subscribers.add(id);
      return id;
    },
  };
});
