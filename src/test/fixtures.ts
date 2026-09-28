import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client';

/*
  Linhas mínimas pra satisfazer FKs nos testes de integração. Cada suíte de
  contrato precisa criar "um subscriber qualquer" ou "um perfil qualquer" sem
  se importar com os valores — é pra isso que estas funções existem.
*/

export async function insertSubscriber(prisma: PrismaClient, overrides: { email?: string } = {}): Promise<string> {
  const subscriber = await prisma.subscriber.create({
    data: {
      email: overrides.email ?? `${randomUUID()}@teste.dindin.dev`,
      token: `fixture:${randomUUID()}`,
    },
  });
  return subscriber.id;
}

/** subscriber + perfil mínimo; devolve o subscriberId (que é o id do perfil) */
export async function insertProfile(prisma: PrismaClient, subscriberId?: string): Promise<string> {
  const id = subscriberId ?? (await insertSubscriber(prisma));
  await prisma.profile.upsert({
    where: { subscriberId: id },
    create: {
      subscriberId: id,
      rendaMensal: 3000,
      tipoRenda: 'CLT',
      idade: 25,
      moradia: 'PAIS',
      custoMoradia: 0,
      guardado: 0,
    },
    update: {},
  });
  return id;
}
