# dindin — backend

API do **dindin**, planejador financeiro gratuito em pt-BR. O frontend (`../dindinFrontend`) funciona sozinho, com o plano no localStorage; esta API é o que permite **salvar o plano**, **usar em mais de um aparelho**, **acompanhar o mês** (check-in por e-mail) e **exercer a LGPD** (exportar e excluir tudo).

- Conta com **e-mail e senha**, grátis e opcional: o app inteiro funciona sem conta; ela serve pra baixar o PDF do plano, salvar e usar em mais de um aparelho. A senha é guardada só como hash **scrypt**; os links que vão por e-mail ("Confirme seu e-mail", "Criar uma senha nova") levam o token no fragmento da URL e o banco guarda só o SHA-256.
- O plano é calculado **no servidor**, pelo mesmo motor do frontend, a partir do perfil salvo — o histórico não depende de confiar no cliente.
- Nunca recomenda produto, banco, corretora ou emissor.

## Stack

Node 22 · Express 5 · TypeScript 7 · Prisma 7 (driver adapter `@prisma/adapter-pg`) · PostgreSQL 16 · zod 4 · JWT (HS256) · Resend (e-mail) · Vitest 5 + supertest · PGlite (Postgres 18 em WASM, só nos testes).

## Arquitetura em uma tela

Monólito modular com clean architecture. As regras completas (e o porquê de cada uma) estão no [CLAUDE.md](CLAUDE.md).

```
src/
  main/            composição — o ÚNICO lugar que escolhe implementações
    config.ts        ambiente validado de uma vez (falta algo → não sobe e diz o quê)
    container.ts     Prisma | memória · Resend | console · relógio · ids · JWT
    routes.ts        pluga os 10 módulos em /api/v1 e liga as portas entre eles
    app.ts           Express: request-id, helmet, CORS, JSON 100 kb, erros
    server.ts        boot + encerramento gracioso (SIGTERM/SIGINT)
    jobs/            CLIs agendados fora da API (abrir-check-ins.ts)
  shared/
    domain/          AppError e subclasses, guards (dinheiro com 2 casas)
    application/     portas: Clock, IdGenerator, TransactionManager, AuthTokenService, Mailer…
    infra/           PrismaDatabase (transação via AsyncLocalStorage), http, security, mail, dublês
    motor/           GERADO a partir do frontend — não edite
  modules/<modulo>/
    index.ts         API pública: só contratos (entidades, interfaces, tipos)
    infra.ts         adaptadores + create<Modulo>Module(deps) — só o main (e testes) importam
    domain/  application/  infra/database/  infra/http/
  test/            kit HTTP, Postgres de teste (PGlite), teste de arquitetura, e2e
```

Uma requisição: `app.ts` → router do módulo → `parseBody/parseParams/parseQuery` (zod) → **caso de uso** (recebe `subscriberId` da sessão, nunca do corpo) → repositório (interface) → **presenter** (nunca expõe dono, hash nem campo interno).

**Grafo de módulos** — um módulo só importa outro pelo `index.ts`, e só nestas arestas (verificado por `src/test/architecture.test.ts`):

```
identidade, categorias, dividas, metas, planos,
organizacao                                     → (nenhum módulo)
gastos-fixos                                    → categorias
perfil                                          → categorias, gastos-fixos, dividas
check-ins                                       → planos, identidade
privacidade                                     → todos

portas declaradas pelo módulo e ligadas no main/routes.ts (evitam ciclo):
  gastos-fixos, dividas  ── PerfilGateway ─────────►  perfil: PerfisRepository.exists
  planos                 ── PerfilDoMotorReader ───►  perfil: CarregarPerfilDoMotorUseCase
```

## Como rodar

Pré-requisitos: Node 22 e Yarn 1. Neste projeto, CLIs vão por `npx` (o shim do Yarn 1 quebra com espaço no caminho); `yarn <script>` funciona.

```bash
yarn install          # também roda prisma generate
cp .env.example .env
```

### Sem banco (memória)

Tudo na RAM, some ao reiniciar. Bom pra desenvolver o frontend e pra demo.

```bash
PERSISTENCIA=memoria JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") yarn dev
```

A API sobe em `http://localhost:3701`. Crie uma conta com `POST /api/v1/auth/cadastrar` (`{ email, senha }`) — a sessão sai na hora. Com `EMAIL_PROVEDOR=console` (padrão), os e-mails aparecem no terminal: o "Confirme seu e-mail" (`/entrar#token=…` → `POST /api/v1/auth/verificar`) e o "Criar uma senha nova" do Esqueci a senha (`/redefinir-senha#token=…` → `POST /api/v1/auth/redefinir-senha`).

### Com Postgres

```bash
docker compose up -d          # Postgres 16 (usuário/senha/banco: dindin)
# no .env: PERSISTENCIA=prisma e DATABASE_URL="postgresql://dindin:dindin@localhost:5432/dindin?schema=public"
yarn prisma:deploy            # aplica prisma/migrations (já semeia as 24 categorias do catálogo)
yarn dev
```

- `yarn db:seed` reaplica o catálogo de categorias (upsert por slug, lendo do motor) — útil quando o catálogo muda no frontend.
- `yarn prisma:migrate` cria uma migration nova em desenvolvimento; revise o SQL à mão quando houver rename.
- Produção: `yarn build && yarn prisma:deploy && yarn start` (com `NODE_ENV=production`).

## Variáveis de ambiente

Lidas e validadas uma vez, em `src/main/config.ts`. Modelo comentado em [.env.example](.env.example).

| Variável | Padrão | O que é |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` recusa `PERSISTENCIA=memoria`, `EMAIL_PROVEDOR=console`, `CORS_ORIGIN=*`, `APP_URL` http/localhost e `LINK_REENVIO_SEGUNDOS` < 60 |
| `PORT` | `3701` | porta HTTP |
| `PERSISTENCIA` | `prisma` | `prisma` (Postgres) ou `memoria` |
| `DATABASE_URL` | — | obrigatória com `prisma` |
| `CORS_ORIGIN` | `http://localhost:3700` | origens do frontend, separadas por vírgula |
| `TRUST_PROXY` | `0` | saltos de proxy confiáveis (afeta `req.ip` e o rate limit) |
| `LOG_REQUESTS` | `true` | log de acesso (morgan) com o request id |
| `RATE_LIMIT` | `true` (`false` com `NODE_ENV=test`) | limite por IP nas rotas de conta (`/auth/*`, `/me/senha`) e no `/descadastrar` |
| `JWT_SECRET` | — | obrigatória, 32+ caracteres |
| `SESSAO_DIAS` | `30` | validade da sessão |
| `LINK_MAGICO_MINUTOS` | `15` | validade do link "Criar uma senha nova" (o nome ficou do link mágico) |
| `LINK_CONFIRMACAO_HORAS` | `48` | validade do link "Confirme seu e-mail", mandado no cadastro |
| `LINK_REENVIO_SEGUNDOS` | `60` | intervalo mínimo entre dois links pro mesmo e-mail |
| `APP_URL` | `http://localhost:3700` | base dos links dos e-mails (`/entrar#token=`, `/redefinir-senha#token=`, `/descadastrar#token=`, `/check-in/AAAA-MM`) |
| `EMAIL_PROVEDOR` | `console` | `console` (imprime) ou `resend` |
| `EMAIL_REMETENTE` | `dindin <nao-responda@dindin.app>` | remetente |
| `RESEND_API_KEY` | — | obrigatória com `resend` |

## Endpoints

Base: `/api/v1` (menos os de saúde). **Auth**: `sessão` = `Authorization: Bearer <accessToken>`; `opcional` = com token mostra mais, token inválido é 401; `pública` = sem token. Conta excluída invalida a sessão na hora (401).

Em qualquer rota, além dos status listados: `400 JSON_INVALIDO`, `413` (corpo acima de 100 kb) e `500`. Lista paginada: `?limit=1..100&cursor=` → `{ items, nextCursor }`.

### Saúde

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | pública | processo vivo (não toca no banco) | 200 |
| GET | `/api/health/ready` | pública | pronto: pinga a persistência | 200 · 503 |

### Identidade (`identidade`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| POST | `/auth/cadastrar` | pública · 10/IP/15 min | `{ email, senha }` → cria a conta e já entra: `{ accessToken, expiresAt, subscriber }` + `Location: /api/v1/me`. Manda o "Confirme seu e-mail" (falha no envio não derruba o cadastro). E-mail que já tem conta (inclusive conta antiga, sem senha) → 409 | 201 · 400 · 409 · 429 |
| POST | `/auth/entrar` | pública · 10/IP/15 min | `{ email, senha }` → sessão. E-mail sem conta, senha errada e conta sem senha dão o MESMO 401 "E-mail ou senha incorretos." (e o mesmo tempo) | 200 · 400 · 401 · 429 |
| POST | `/auth/esqueci-senha` | pública · 5/IP/15 min | `{ email }` → manda o "Criar uma senha nova" depois da resposta (o 202 não espera banco nem e-mail). Mesma resposta — e mesmo tempo — pra e-mail com e sem conta, em cooldown de 60 s por endereço e com o provedor de e-mail fora do ar | 202 · 400 · 429 |
| POST | `/auth/redefinir-senha` | pública · 20/IP/15 min | `{ token, senha }` → grava a senha, confirma o e-mail, gasta o link (uso único) e devolve a sessão. Senha fora da regra é 400 e não gasta o link | 200 · 400 · 401 · 429 |
| POST | `/auth/verificar` | pública · 20/IP/15 min | `{ token }` do "Confirme seu e-mail" → sessão. Uso único; confirma o e-mail | 200 · 400 · 401 · 429 |
| GET | `/me` | sessão | a conta: `{ id, email, emailVerificadoEm, ativo, temSenha, criadoEm }` | 200 · 401 · 404 |
| POST | `/me/senha` | sessão · 10/IP/15 min | `{ senhaAtual?, senhaNova }` → troca a senha e devolve uma **sessão nova** `{ accessToken, expiresAt, subscriber }`: a senha nova encerra as sessões de antes, a do pedido inclusive. Atual errada é **400** em `details.senhaAtual` (nunca 401). `senhaAtual` só é dispensada na conta antiga, sem senha | 200 · 400 · 401 · 404 · 429 |
| POST | `/me/descadastrar` | sessão | para o e-mail mensal (`ativo=false`; a sessão continua) | 200 · 401 · 404 |
| POST | `/me/reativar` | sessão | volta a receber o e-mail mensal | 200 · 401 · 404 |
| POST | `/descadastrar` | pública · 20/IP/15 min | `{ token }` do link do e-mail mensal; idempotente. Token de sessão não serve | 204 · 400 · 401 · 429 |

Senha: 8 a 128 caracteres, só espaços não vale ("A senha precisa ter pelo menos 8 caracteres." / "A senha pode ter no máximo 128 caracteres."), nunca trimada nem normalizada. O entrar sem senha (`POST /auth/link-magico`) saiu da API e responde 404; conta antiga, criada por ele, cria a senha pelo Esqueci a senha ou em `POST /me/senha` só com a nova.

Senha nova (redefinir ou trocar) encerra as sessões que já existiam: o token de sessão leva a versão das sessões da conta (`versao_sessao`), e token de versão velha é 401. Cada link do e-mail só serve pra sua rota: o do "Confirme seu e-mail" não redefine senha e o de "Criar uma senha nova" não abre sessão no `/auth/verificar`.

### Privacidade — LGPD (`privacidade`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/me/exportar` | sessão | arquivo JSON com tudo da pessoa (sem ids nem segredos); `Content-Disposition: attachment` | 200 · 401 · 404 |
| DELETE | `/me` | sessão | `{ "confirmacao": "EXCLUIR" }` → exclusão física de tudo, numa transação | 204 · 400 · 401 |

### Categorias (`categorias`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/categorias` | opcional | catálogo (24); com sessão, mais as personalizadas. Anônimo: cache público 1 h | 200 · 401 |
| POST | `/categorias` | sessão | `{ nome }` → cria personalizada (até 50) | 201 · 400 · 401 · 409 · 422 |
| PATCH | `/categorias/:id` | sessão | `{ nome }` → renomeia personalizada | 200 · 400 · 401 · 404 · 409 · 422 |
| DELETE | `/categorias/:id` | sessão | exclui personalizada sem gastos | 204 · 401 · 404 · 409 · 422 |

### Perfil (`perfil`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/perfil` | sessão | respostas escalares (renda, tipo, idade, moradia, custo, guardado) | 200 · 401 · 404 |
| PUT | `/perfil` | sessão | grava todas as respostas escalares | 201 (criou) · 200 · 400 · 401 |
| PATCH | `/perfil` | sessão | altera só as informadas | 200 · 400 · 401 · 404 |
| GET | `/perfil/completo` | sessão | perfil + gastos + dívidas **no formato do motor** (o do localStorage) | 200 · 401 · 404 |
| PUT | `/perfil/completo` | sessão | substitui tudo no formato do onboarding: `"outro"` + nome vira categoria personalizada (ou a do catálogo com esse nome), linhas da mesma categoria somam | 200 · 400 · 401 |

### Gastos fixos (`gastos-fixos`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/perfil/gastos-fixos` | sessão | `{ items (com a categoria inteira), total }` | 200 · 401 |
| POST | `/perfil/gastos-fixos` | sessão | `{ categoriaId, valor }` — um por categoria, até 20, exige perfil | 201 · 400 · 401 · 404 · 409 · 422 |
| PATCH | `/perfil/gastos-fixos/:id` | sessão | `{ valor }` | 200 · 400 · 401 · 404 |
| DELETE | `/perfil/gastos-fixos/:id` | sessão | remove | 204 · 401 · 404 |

### Dívidas (`dividas`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/perfil/dividas` | sessão | lista com `taxaAnualUsada`, `classe` e `jurosMensais` calculados pelo motor | 200 · 401 |
| POST | `/perfil/dividas` | sessão | `{ tipo, saldo, parcela?, taxaAnual? }` — até 6, exige perfil | 201 · 400 · 401 · 422 |
| PATCH | `/perfil/dividas/:id` | sessão | parcial; `null` limpa parcela ou taxa | 200 · 400 · 401 · 404 |
| DELETE | `/perfil/dividas/:id` | sessão | remove | 204 · 401 · 404 |

### Planos (`planos`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| POST | `/planos/simular` | pública | roda o motor com o perfil do corpo (formato do motor); não grava | 200 · 400 |
| POST | `/planos` | sessão | gera com o perfil **salvo**; sem mudança devolve a última versão | 201 (versão nova) · 200 · 401 · 409 · 422 |
| GET | `/planos` | sessão | histórico resumido, da mais nova pra mais antiga | 200 · 400 · 401 |
| GET | `/planos/atual` | sessão | a versão mais nova `{ versao, criadoEm, entrada, resultado }` | 200 · 401 · 404 |
| GET | `/planos/:versao` | sessão | uma versão do histórico | 200 · 400 · 401 · 404 |

### Metas (`metas`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/metas` | sessão | metas com projeção (quanto falta, meses, mês estimado) | 200 · 401 |
| POST | `/metas` | sessão | `{ nome, valorAlvo, aporteMensal` **ou** `prazoMeses, acumulado? }` — até 20 | 201 · 400 · 401 · 422 |
| GET | `/metas/publicas/:slug` | pública · cache 5 min | `{ nome, progresso, atingida }` — nunca valores em reais | 200 · 400 · 404 |
| GET | `/metas/:id` | sessão | uma meta | 200 · 401 · 404 |
| PATCH | `/metas/:id` | sessão | parcial; troca aporte↔prazo mandando o novo e `null` no outro | 200 · 400 · 401 · 404 · 422 |
| DELETE | `/metas/:id` | sessão | remove | 204 · 401 · 404 |
| POST | `/metas/:id/publicar` | sessão | dá um endereço público (idempotente) | 200 · 401 · 404 · 409 |
| DELETE | `/metas/:id/publicar` | sessão | tira do ar | 200 · 401 · 404 |

### Check-ins (`check-ins`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/check-ins` | sessão | meses respondidos/abertos, do mais recente | 200 · 400 · 401 |
| GET | `/check-ins/:competencia` | sessão | um mês (`AAAA-MM`) com a comparação com o plano atual | 200 · 400 · 401 · 404 |
| PUT | `/check-ins/:competencia` | sessão | `{ rendaReal, gastoReal, guardadoReal }` — abre se o job ainda não abriu; mês futuro é 400 | 200 · 400 · 401 · 409 |

A comparação usa a versão do plano **que valia naquele mês** (`findEmVigorEm`), não a mais nova: trocar o ritmo em setembro não reescreve o veredito de agosto. Quem ainda não tinha plano no mês perguntado compara com a versão mais antiga dela.

### Organização do excedente (`organizacao`)

| Método | Caminho | Auth | O que faz | Status |
| --- | --- | --- | --- | --- |
| GET | `/organizacao` | sessão | a árvore de grupos do excedente; sem nada organizado, `{ grupos: [] }` | 200 · 401 |
| PUT | `/organizacao` | sessão | substitui a árvore inteira: `{ grupos: [{ id, nome, icone?, valor, contaParaMeta?, rendimentoMensal?, doSistema?, itens? }] }` | 200 · 400 · 401 |

O corpo da resposta é exatamente o corpo do próximo PUT (sem dono, sem ordem, sem data), porque a mesma árvore vive no `localStorage` do aparelho. O id vem do cliente e a chave primária é composta com o dono.

## Formato de erro

Todo erro, de qualquer rota:

```json
{ "error": { "code": "VALIDACAO", "message": "Confira os campos destacados.", "details": { "gastosFixos.2.valor": "No máximo 2 casas decimais" }, "requestId": "…" } }
```

O cliente decide pelo `code` (estável) e mostra a `message` (pt-BR, pronta pra tela). `details` vem por campo quando faz sentido. O `requestId` também sai no header `X-Request-Id` e no log. Erro inesperado nunca vaza stack nem mensagem interna.

| `code` | Status | Quando |
| --- | --- | --- |
| `VALIDACAO` | 400 | formato ou valor inválido |
| `JSON_INVALIDO` | 400 | corpo não é JSON |
| `REQUISICAO_INVALIDA` | 4xx | requisição malformada (encoding, charset) |
| `NAO_AUTENTICADO` | 401 | sem sessão, sessão vencida, conta excluída, link inválido, e-mail ou senha incorretos |
| `PROIBIDO` | 403 | reservado |
| `NAO_ENCONTRADO` | 404 | não existe **ou é de outra pessoa** (as duas respondem igual) |
| `ROTA_NAO_ENCONTRADA` | 404 | caminho inexistente |
| `CONFLITO` | 409 | duplicado, categoria em uso, corrida concorrente |
| `CORPO_GRANDE_DEMAIS` | 413 | corpo acima de 100 kb |
| `REGRA_DE_NEGOCIO` | 422 | válido, mas o produto não permite (sem perfil, limite atingido) |
| `MUITAS_REQUISICOES` | 429 | rate limit por IP |
| `ERRO_INTERNO` | 500 | bug — registrado com o `requestId` |

## Testes

| Comando | O que roda |
| --- | --- |
| `yarn typecheck` | `tsc` em tudo, testes e `prisma/` inclusive |
| `yarn test` | sem banco: domínio, casos de uso (repositórios em memória), contratos em memória, HTTP (supertest), teste de arquitetura e o **e2e em memória** |
| `yarn test:integration` | `*.integration.test.ts` contra **Postgres de verdade**: cada `Prisma<X>Repository` roda o MESMO contrato da versão em memória, mais a sincronização do perfil, a exclusão LGPD com rollback e o **e2e no Postgres** |
| `yarn db:check-migrations` | aplica `prisma/migrations` num Postgres descartável e compara com o `schema.prisma` (sai com 1 e mostra o SQL que falta) |
| `yarn motor:check` | o motor copiado bate com o do frontend |

**Ponta a ponta** (`src/test/e2e-fluxo.ts`): a composição inteira da produção (`loadConfig` → `createContainer` → `createApp` + `mountModules`), só com e-mail em memória e relógio fixo injetados. Duas pessoas: uma cria a conta com senha (e o mesmo e-mail de novo é 409), confirma o e-mail pelo link, esquece a senha e cria outra pelo e-mail (o reenvio em menos de 60 s é segurado), troca a senha na conta, sincroniza o perfil do onboarding, faz CRUD de gastos e dívidas, gera o plano (201, depois 200, depois versão 2), cria e publica meta, responde o check-in, recebe o e-mail do job com o descadastro no fragmento, se descadastra, exporta, exclui a conta e perde a sessão; a outra entra no meio e sai intacta. No fim, confere que nenhuma resposta trouxe id de outra pessoa, senha, hash de senha ou de token, nem campo interno. O mesmo fluxo roda em memória (`e2e.test.ts`) e no Postgres (`e2e.integration.test.ts`, que ainda confere no banco que só restaram as linhas da segunda pessoa e as 24 categorias do catálogo).

**Integração sem Docker**: o banco é o [PGlite](https://pglite.dev) (Postgres 18 em WASM) servido por TCP, com o mesmo PrismaClient e adapter da produção — ver `src/test/test-database.ts`. **O que ele não cobre**: concorrência (é uma sessão só — corridas, `FOR UPDATE` e isolamento dependem das constraints do banco e estão documentados no código) e diferenças do Postgres 16 de produção. Pra isso, rode contra um Postgres real no CI.

## Job mensal — abrir check-ins

```bash
yarn job:abrir-check-ins                      # desenvolvimento (tsx)
node dist/main/jobs/abrir-check-ins.js        # produção, depois do yarn build
```

Abre o check-in do mês que acabou pra cada pessoa **ativa e com e-mail confirmado** e manda a pergunta, com o link de descadastro no fragmento (`${APP_URL}/descadastrar#token=…`). Imprime o relatório em JSON na última linha do stdout — `{ competencia, abertos, jaExistiam, enviados, jaEnviados, falhas }` — e sai com **1 se houve falha** (ou se não conseguiu rodar).

- **Agende depois das 03:00 UTC do dia 1** (ex.: `30 3 1 * *` = 00:30 em São Paulo). Antes disso ainda é o último dia do mês em Brasília e ele abriria o mês retrasado.
- **Idempotente**: o envio é reservado (compare-and-set) antes de mandar e desfeito se falhar. Rodar de novo — inclusive em paralelo, ou depois de `falhas > 0` — não duplica check-in nem e-mail.
- Com `PERSISTENCIA=memoria` roda num banco vazio: só serve com Postgres.

## Motor sincronizado

`src/shared/motor/` é **cópia gerada** de `dindinFrontend/src/domain` (mais `src/lib/format.ts`), com os testes: a cascata do plano, projeções, textos, schema do perfil e o catálogo de categorias. É o que permite gerar o plano no servidor com exatamente as mesmas regras e mensagens da tela.

- Não edite no backend: mude no frontend e rode `yarn motor:sync`.
- `yarn motor:check` falha se as cópias divergirem (frontend em `../dindinFrontend` ou `DINDIN_FRONTEND_DIR`).
- Os `slug` do catálogo são contrato com o frontend e com a migration: slug publicado não muda.

## Checagens antes de subir

```bash
yarn typecheck && yarn test && yarn test:integration && yarn build && yarn motor:check && yarn db:check-migrations
```
