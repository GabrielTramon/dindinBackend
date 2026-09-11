# Dindin Backend

API em Express + TypeScript + Prisma (PostgreSQL).

## Stack

- Node.js + Express 5
- TypeScript 7
- Prisma ORM 7 (driver adapter `@prisma/adapter-pg`)
- PostgreSQL
- Yarn

## Setup

```bash
yarn install
cp .env.example .env   # ajuste a DATABASE_URL
yarn prisma migrate dev --name init
yarn dev
```

A API sobe em `http://localhost:3333`.

## Scripts

| Script | Descrição |
| --- | --- |
| `yarn dev` | Servidor em modo watch (tsx) |
| `yarn build` | Compila TypeScript para `dist/` |
| `yarn start` | Roda a build de produção |
| `yarn prisma:generate` | Gera o Prisma Client |
| `yarn prisma:migrate` | Cria/aplica migrations em desenvolvimento |
| `yarn prisma:studio` | Abre o Prisma Studio |
| `yarn db:push` | Sincroniza o schema sem criar migration |

## Estrutura

```
prisma/
  schema.prisma        # modelos do banco
prisma7.config.ts      # config do Prisma 7 (carrega o .env e a DATABASE_URL)
src/
  server.ts            # bootstrap HTTP
  app.ts               # middlewares + montagem das rotas
  routes/              # definição das rotas (prefixo /api)
  controllers/
  middlewares/
  lib/prisma.ts        # instância única do Prisma Client
  generated/prisma/    # client gerado (não versionado)
```

## Observações

- No Prisma 7 a `DATABASE_URL` **não** fica mais no `schema.prisma`: ela é lida em `prisma7.config.ts`,
  e o client é criado com o adapter `PrismaPg` em `src/lib/prisma.ts`.
- O client gerado fica em `src/generated/prisma` e é recriado no `postinstall`.

## Endpoints

- `GET /api/health` — status da API e checagem de conexão com o banco.
