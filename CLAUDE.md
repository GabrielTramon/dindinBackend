# dindin — backend

API do dindin: planejador financeiro gratuito em pt-BR. Monólito modular com clean architecture sobre Express 5, Prisma 7 (Postgres) e TypeScript 7. O frontend (`../dindinFrontend`) funciona sozinho com localStorage; esta API é o que permite salvar o plano, receber o e-mail mensal e usar em mais de um aparelho.

## Comandos

- `yarn dev` (tsx watch) · `yarn build` · `yarn start`
- `yarn test` (vitest, rápido, sem banco) · `yarn typecheck` (inclui testes e `prisma/`)
- `yarn test:integration` — `*.integration.test.ts` contra Postgres 18 de verdade (PGlite em WASM, sem Docker nem senha; ver `src/test/test-database.ts`)
- `yarn motor:sync` / `yarn motor:check` — ver "Motor" abaixo
- `yarn prisma:generate` · `yarn prisma:deploy` · `yarn db:seed`
- `yarn db:check-migrations` — aplica `prisma/migrations` num PGlite e compara com o `schema.prisma` (sai com 1 e mostra o SQL). No Prisma 7 não existe `--shadow-database-url`: o script escreve um prisma config temporário com `datasource.shadowDatabaseUrl`
- `yarn job:abrir-check-ins` — o job do dia 1 (`src/main/jobs/`); agendar depois das 03:00 UTC
- Antes de entregar: `yarn typecheck && yarn test && yarn test:integration && yarn build && yarn motor:check && yarn db:check-migrations`
- CLIs sempre via `npx` — o shim do Yarn 1 quebra com o espaço no caminho do usuário. `yarn add` e `yarn <script>` funcionam.
- Subir sem banco: `PERSISTENCIA=memoria JWT_SECRET=<32+ chars> yarn dev`. Os e-mails ("Confirme seu e-mail", "Criar uma senha nova") aparecem no terminal com o link (`EMAIL_PROVEDOR=console`). Pra testar à mão sem mexer na API de ninguém, suba noutra porta (`PORT=3702`).

## Arquitetura

```
src/
  main/                 composição: config, container, routes, app, server, jobs — o ÚNICO lugar que escolhe implementações
  shared/
    domain/             errors (AppError e subclasses), guards
    application/        ports (Clock, IdGenerator, TransactionManager, AuthTokenService, SecureTokenGenerator, PasswordHasher, Mailer), pagination, use-case
    infra/              database (PrismaDatabase + transação via AsyncLocalStorage), http, security, mail, system, in-memory (dublês)
    motor/              GERADO a partir do frontend. Não edite.
  modules/<modulo>/
    index.ts            API pública: SÓ contratos (entidades, interfaces de repositório, tipos, constantes)
    infra.ts            adaptadores + create<Modulo>Module(deps) — só o main (e testes) importam
    domain/             entidade(s) + interface do repositório
    application/        casos de uso (um por arquivo) + ports.ts (o que o módulo precisa de fora)
    infra/database/     mapper, Prisma<X>Repository, InMemory<X>Repository, <x>-repository.contract.ts
    infra/http/         <modulo>.routes.ts, <modulo>.schemas.ts, <x>.presenter.ts
  test/kit.ts           createTestKit(): portas em memória + app com o pipeline de produção
  test/e2e-fluxo.ts     o fluxo ponta a ponta com a composição real (main), rodado em memória e no Postgres
```

**Módulo de referência: `modules/categorias`.** Todo módulo novo segue a mesma forma, os mesmos nomes de arquivo e o mesmo estilo de teste.

### Regra de dependência

- `domain` não importa nada de `application` nem `infra`. Pode importar `shared/domain` e `shared/motor`.
- `application` importa `domain` e `shared/application`. Nunca Express, Prisma ou zod de HTTP.
- `infra` implementa as interfaces de `domain`/`application`.
- **Entre módulos, só pelo `index.ts`** (`import type { CategoriasRepository } from '../../categorias'`). Nunca `../../categorias/infra/...` nem `../../categorias/domain/...`.
  - Exceção só pra **teste** (`*.test.ts`, `*.contract.ts`, `src/test/`): pode importar o `infra.ts` do vizinho (`../../categorias/infra`) pra usar o repositório em memória ou Prisma de verdade — nunca o interior dele, e só nas arestas do grafo. Prefira isso a um dublê local do repositório do vizinho (dublê fora de `*.test.ts` ainda entra no `dist`).
  - `main/` usa módulos só pelo `index.ts` ou pelo `infra.ts`.
- O grafo não tem ciclo:
  ```
  identidade, categorias, dividas, metas, planos, organizacao → (nenhum módulo)
  gastos-fixos → categorias
  perfil       → categorias, gastos-fixos, dividas
  check-ins    → planos, identidade
  privacidade  → todos (organizacao inclusive: exportar e excluir alcançam os grupos)
  ```
  Quando um módulo precisa de algo de outro sem poder importá-lo, ele declara uma porta em `application/ports.ts` e o main liga:
  - `gastos-fixos` e `dividas` perguntam se o perfil existe via `PerfilGateway` (perfil depende deles, então não podem importar perfil);
  - `planos` recebe o perfil completo no formato do motor via `PerfilDoMotorReader`, ligado ao `CarregarPerfilDoMotorUseCase` de `perfil`.
- **Tudo isso é verificado por `src/test/architecture.test.ts`** (roda no `yarn test`). Módulo novo ou aresta nova: atualize o `GRAFO` de lá e este diagrama juntos.

### Campos novos no perfil (a lição de 18/09/2026)

O perfil ganhou renda informada, salário bruto, dependentes, competência da tabela, ritmo, aporte escolhido e meta — todos **opcionais**. Opcional é o modo mais fácil de perder dado em silêncio aqui, porque o projeto copia campo a campo de propósito e o TypeScript não acusa a falta:

- São **oito** listas entre o corpo HTTP e o banco: `Perfil.criar`, `validar`, `atualizar`, `toDados`, o mapper (ida e volta), `salvarPerfilBody`/`atualizarPerfilBody`, as rotas, os dois presenters e `SincronizarPerfilCompletoUseCase`. Esquecer uma delas = 200 mudo, escolha perdida no F5, ou exportação LGPD incompleta.
- No domínio, ausente é **`undefined`, nunca `null`**, e `toDados`/`toSnapshot` **omitem a chave**: é isso que mantém o `inputSnap` de quem já tem plano idêntico ao de antes. No mapper, a ida usa spread condicional (`?? undefined` deixaria a chave presente) e a volta usa `?? null` (é o null que apaga a coluna).
- **PUT substitui, PATCH mescla.** `Perfil.substituir` apaga opcional ausente — sem isso a escolha ficaria gravada pra sempre. Limpar um campo é o PUT sem ele.
- O que prova tudo isso é o contrato do repositório (roda em memória e no Postgres) mais o passo do e2e que vai do PATCH até o `inputSnap` da versão gravada.

### Nomes

- **Vocabulário do negócio em pt-BR**: `Categoria`, `Perfil`, `GastoFixo`, `Meta`, `renomear`, `consumirLinkMagico`, `CriarCategoriaPersonalizadaUseCase`.
- **Palavras de padrão técnico em inglês**: `Repository`, `UseCase`, `Mapper`, `Presenter`, métodos de repositório (`findById`, `save`, `listBySubscriber`, `deleteAllBySubscriber`), portas (`Clock`, `Mailer`), erros (`NotFoundError`).
- Props das entidades usam os nomes de campo do `schema.prisma` (exceção documentada: `Subscriber.tokenHash` ↔ coluna `token`; `subscriberId` ↔ `profileId` em gastos e dívidas).
- Arquivos em kebab-case: `renomear-categoria.use-case.ts`, `prisma-categorias-repository.ts`.
- Estilo: aspas simples, ponto e vírgula, 2 espaços. Comentário explica o porquê, em pt-BR.

### Entidades

- Construtor privado. `criar(...)` valida invariantes; `restaurar(props)` reconstrói do banco sem validar.
- Getters pros campos; métodos com nome de comportamento pra mudar estado. Nada de setter.
- `restaurar` e `toSnapshot` usam `structuredClone` (cópia profunda: Date e objetos aninhados inclusive).
- `atualizar(dados)` monta o objeto validado **campo a campo**. Nunca espalhe a entrada (`{...dados}`): uma chave extra vinda do chamador (`subscriberId`, `id`) trocaria o dono.
- Quando o motor já tem a regra (`shared/motor/schema.ts`), valide COM o schema do motor (`validateField(perfilSchema.shape.idade, …)`) — mesmos limites e mensagens do frontend.
- **Dinheiro**: `isValidMoney` / `ensureMoneyPrecision` / `hasAtMostDecimals` de `shared/domain/guards`. No máximo 2 casas (taxa: 4). **Nunca** `Math.round(v * 100) === v * 100` — erro de ponto flutuante recusava 13% dos valores válidos (R$ 19,99). O motor não limita casas; a entidade limita, senão o Decimal do banco arredonda calado e a memória diverge.
- Datas vêm de fora (`agora: Date`), nunca `new Date()` dentro do domínio.

### Casos de uso

- Classe `<Acao>UseCase implements UseCase<Input, Output>`, dependências no construtor (interfaces), um `execute`.
- Recebem `subscriberId` do chamador e **nunca** confiam em id de dono vindo do corpo.
- Recurso de outra pessoa responde `NotFoundError` (igual a inexistente — não confirma que o id existe).
- Escrita em mais de um repositório → `transactions.run(async () => { ... })`.
- **Dentro de `run`, nunca capture erro de banco e siga**: no Postgres, depois de qualquer erro a transação fica abortada (25P02) e toda consulta seguinte falha — a memória não mostra isso. Pra tentar de novo (ex.: versão concorrente), repita o `run` inteiro.
- "Uso único" e "não duplicar sob concorrência" não se garantem com ler-e-depois-gravar: use o método compare-and-set do repositório (`saveMagicLinkConsumption`, `savePasswordReset`, `claimSend`) ou a constraint do banco.
- Lançam `AppError` (`ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `BusinessRuleError` 422). Mensagem em pt-BR pronta pra tela; `details` por campo quando fizer sentido.
- Não mutam a entidade antes de terminar as checagens que podem falhar.

### Repositórios

- Todo repositório tem **três** arquivos: interface (domain), Prisma, em memória — e um **contrato** (`<x>-repository.contract.ts`) rodado contra a versão em memória (`in-memory-<x>-repository.test.ts`) e, quando há banco, contra a Prisma (`*.integration.test.ts`).
- Métodos que recebem `subscriberId` filtram por ele. Não existe `findById(id)` sem dono em recurso privado.
- Prisma: pegue o cliente com `this.db.client` a cada operação (pode ser a transação em andamento). Converta violações com `prisma-errors.ts`: unique → `ConflictError`, FK → `ConflictError`/`BusinessRuleError`, not found em delete → ignore.
- Enums: banco MAIÚSCULO (`CASA`), domínio e API minúsculo (`casa`), convertidos no mapper. Dinheiro: `Decimal` ⇄ `number` via `shared/infra/database/decimal.ts`.
- **Não use `equals` + `mode: 'insensitive'`** do Prisma: vira `ILIKE` sem escapar curinga ("C%" casou com "Clube", provado). Compare em JS quando o conjunto é pequeno, ou normalize numa coluna.
- `replaceAll` (troca a lista inteira do perfil) trava a linha do perfil antes do delete — `SELECT 1 FROM profiles WHERE subscriber_id = $1 FOR NO KEY UPDATE` — dentro de `this.db.transaction(...)`. Sem isso, dois PUTs simultâneos somam as listas (provado em Postgres real).
- Paginação: decodifique o cursor com `decodeIntCursor` / `decodeCursor(c, validador)` de `shared/application/pagination`. Cursor lixo vira 400, nunca `NaN` no banco.
- Ordem com empate (mesmo `criadoEm` depois de `replaceAll`): desempate por `id` nas duas implementações.
- Em memória: guarda **`structuredClone`** do snapshot, devolve instâncias novas via `restaurar`, emula unique/FK que o caso de uso depende (inclusive em operações em lote, "todas ou nenhuma"), ordena igual à consulta Prisma. Dependência de outro repositório entra por callback no construtor (ex.: `isInUse`), ligado pelo container.

### HTTP

- Router por módulo, montado em `/api/v1`, com caminhos completos (`/perfil/gastos-fixos/:id`).
- Handler: `parseParams`/`parseBody`/`parseQuery` (zod) → caso de uso → presenter. Sem regra de negócio no handler. Express 5 já repassa exceção assíncrona pro error handler — não use try/catch pra responder erro.
- Autenticação: `deps.auth.requireAuth` ou `optionalAuth`; dono via `authOf(req).subscriberId`. Os dois conferem se a conta ainda existe (conta excluída = 401) e `optionalAuth` já manda `Vary: Authorization` — rota pública com `Cache-Control: public` precisa dele.
- Recurso que referencia outro por id vindo do cliente (gasto → categoria) confere que o referenciado é visível pra pessoa (`categoria.ehVisivelPara(subscriberId)`), senão 404. A FK do banco não impede apontar pra categoria de outra pessoa.
- Schema HTTP confere formato e tetos; regra fica no domínio.
- JSON de resposta em camelCase pt-BR, enums minúsculos, datas ISO. Lista: `{ items, nextCursor? }`. Criação: `201` + `Location`. Exclusão: `204`.
- Erro sempre `{ error: { code, message, details?, requestId } }`.
- Presenter nunca expõe `subscriberId`, hash de token nem campo interno.

### Testes

- `yarn test` roda sem banco: domínio, casos de uso (repositórios em memória), contratos em memória e HTTP (supertest em `createTestKit().app(...)`).
- Relógio fixo (`FixedClock`), ids sequenciais (`SequentialIdGenerator`), e-mail em memória (`InMemoryMailer`). Nada de `vi.useFakeTimers` pra data de negócio.
- Todo endpoint testa: sucesso, sem token (401), recurso de outra pessoa (404), entrada inválida (400) e a regra principal de negócio. Termine o arquivo de rotas conferindo `kit.unexpectedErrors` vazio.
- **Integração** (`yarn test:integration`): todo `Prisma<X>Repository` roda a MESMA suíte de contrato da versão em memória, num `prisma-<x>-repository.integration.test.ts` (modelo: `modules/categorias/infra/database/`). Um banco por arquivo (`startTestDatabase` no `beforeAll`), `db.reset()` antes de cada teste (o harness do contrato chama), `src/test/fixtures.ts` pra linhas que só satisfazem FK.
- PGlite é **uma sessão só**: não reproduz concorrência (corridas, locks, isolamento). Teste de corrida não vai em integração; documente a garantia no código e confie na constraint do banco.
- **Ponta a ponta** (`src/test/e2e-fluxo.ts`): a composição real (`loadConfig` → `createContainer(config, { mailer, clock })` → `createApp` + `mountModules`), rodada em `e2e.test.ts` (memória) e `e2e.integration.test.ts` (Prisma sobre `startTestDatabase().url`). Endpoint ou ligação nova no main: acrescente um passo ao fluxo, não um e2e paralelo.

## Motor

`src/shared/motor/` é cópia de `dindinFrontend/src/domain` + `src/lib/format.ts`, gerada por `yarn motor:sync` (com os testes). É o que permite gerar o plano no servidor sem confiar no cliente. **Não edite aqui**: mude no frontend e sincronize. `yarn motor:check` falha se as cópias divergirem — rode no CI.

## Autenticação: conta com e-mail e senha (desde 24/09/2026)

A conta é grátis e opcional — o app inteiro funciona sem ela, com o plano no navegador. Ela serve pra baixar o PDF do plano (o frontend confere a sessão com um `GET /me` novo antes de liberar), salvar no servidor e receber o e-mail mensal. O login por link mágico (sem senha) saiu: `POST /auth/link-magico` responde 404.

| Rota | O que faz |
| --- | --- |
| `POST /auth/cadastrar` `{ email, senha }` | `CadastrarComSenhaUseCase`: cria a conta com o hash, abre a sessão (201) e manda o "Confirme seu e-mail" (`/entrar#token=`, `LINK_CONFIRMACAO_HORAS`, padrão 48). Falha no envio NÃO derruba o cadastro: anula o link e segue (o router loga um aviso). E-mail que já tem conta — inclusive conta antiga, sem senha — é 409; corrida no UNIQUE também vira 409 |
| `POST /auth/entrar` `{ email, senha }` | `EntrarComSenhaUseCase`: e-mail sem conta, senha errada e conta sem senha dão o MESMO 401 "E-mail ou senha incorretos." — e sem conta/sem senha roda um verify contra um hash "de mentira" (gerado uma vez por processo), pro tempo não revelar quem tem conta. Não exige e-mail confirmado |
| `POST /auth/esqueci-senha` `{ email }` | `SolicitarRedefinicaoDeSenhaUseCase`: valida o e-mail (400) e responde 202 com a mesma frase **sem esperar nada**: a busca da conta, a gravação do link e o envio do "Criar uma senha nova" (`/redefinir-senha#token=`, `LINK_MAGICO_MINUTOS`, padrão 15) rodam depois da resposta (`BackgroundJobs`). Assim o tempo e o status não dizem quem tem conta (antes, com conta esperava o banco e o provedor, e provedor fora do ar virava 500 só pra quem tinha conta). Sem reenvio se o último link do endereço saiu há menos de 60 s. Envio que falhou anula o link e vai pro log da tarefa |
| `POST /auth/redefinir-senha` `{ token, senha }` | `RedefinirSenhaUseCase`: só aceita o link de senha nova. Grava a senha, confirma o e-mail e gasta o link numa escrita só (`savePasswordReset`, compare-and-set) e devolve a sessão — as sessões de antes caem (`versaoSessao`). Senha fora da regra é 400 e NÃO gasta o link |
| `POST /auth/verificar` `{ token }` | `VerificarLinkMagicoUseCase`: só o link do "Confirme seu e-mail" (o de senha nova aqui é 401: seria entrar sem senha). Confirma e abre sessão (`saveMagicLinkConsumption`) |
| `POST /me/senha` `{ senhaAtual?, senhaNova }` | `TrocarSenhaUseCase`: **200 com uma sessão nova** (`{ accessToken, expiresAt, subscriber }`, `no-store`): a senha nova derruba TODAS as sessões de antes, a do pedido inclusive, e o cliente troca o token guardado por este. Senha atual errada/ausente é **400** em `details.senhaAtual`, NUNCA 401 (o front trata 401 como sessão vencida). `senhaAtual` só é dispensada na conta antiga, sem senha |
| `GET /me` | a conta + `temSenha` (a página da conta decide entre "Trocar senha" e "Criar senha") |

- **Senha**: 8 a 128 caracteres (unidades UTF-16, como o `maxLength` do navegador), só espaços não vale. Regras e mensagens em `identidade/domain/senha.ts`, IGUAIS às do frontend. **Nunca trimada nem normalizada** — só validada; o e-mail continua passando por `normalizarEmail`. No entrar, só "não vazia" e o teto de 128 (se o mínimo subir um dia, quem já tem senha continua entrando).
- **Hash**: porta `PasswordHasher` (`shared/application/ports.ts`); em produção `ScryptPasswordHasher` (`node:crypto`, sal de 16 bytes, N=16384 r=8 p=1, 64 bytes, `scrypt$N$r$p$<sal b64>$<hash b64>`, `timingSafeEqual`, confere com os parâmetros gravados no hash). Nos testes, `PredictablePasswordHasher` (`"senha(abc)"`, instantâneo); o e2e usa o scrypt de verdade.
- **A senha só muda por `savePassword` / `savePasswordReset`**. O `save()` de uma linha existente NÃO grava `senhaHash` nem `versaoSessao` (só no insert): um descadastro ou link novo gravado a partir de uma entidade lida antes nunca desfaz uma troca de senha feita no meio — nem devolve a validade às sessões que ela derrubou.
- **Senha nova encerra as sessões de antes**: `Subscriber.versaoSessao` (coluna `versao_sessao`, default 0) sobe a cada `definirSenha` (redefinir, trocar, primeira senha da conta antiga) e vai no JWT como `ver`. `requireAuth`/`optionalAuth` perguntam ao `SessionAccounts.sessionVersion(id)` (uma busca por chave primária): conta excluída (`null`) ou versão diferente → 401. Token sem `ver` (emitido antes da regra) conta como 0. Fecha o caso "alguém criou a conta com o meu e-mail e ficou com a sessão de 30 dias": a dona usa o Esqueci a senha e a sessão da intrusa cai. O cadastro nasce na versão 0 (não passa por `definirSenha`).
- **Nunca sai**: presenter, sessão, exportação LGPD (`GET /me/exportar`) e log não levam hash nem senha — só `temSenha` no `/me`. O e2e e o contrato da privacidade conferem.
- **Links por e-mail** (`application/links-por-email.ts`, `EmissorDeLinks`): UM link pendente por vez na coluna `token` (o token só existe no e-mail). Confirmação e senha nova dividem a coluna (um substitui o outro), mas **cada link só serve pra sua finalidade**: a coluna guarda `chaveDoLink` = `"<finalidade>:<sha256>"` (`confirmacao:` ou `redefinicao:`) e cada rota procura só pela sua — o de confirmação (48 h) não cria senha e o de senha nova não abre sessão sem trocar a senha. Como a finalidade está no próprio valor, o compare-and-set do consumo já confere as duas coisas. O de senha nova também confirma o e-mail. Uso único; expira. O limite de 60 s por endereço deduz a emissão pela validade, testando as duas.
- **Tokens vão no fragmento da URL, nunca na query**: `${APP_URL}/entrar#token=…`, `${APP_URL}/redefinir-senha#token=…`, `${APP_URL}/descadastrar#token=…`. O fragmento não chega em servidor, log, `Referer` nem script de anúncio/analytics.
- **Limite por IP** (`LIMITES_POR_IP` em `identidade.routes.ts`), um contador por rota, a cada 15 min: cadastrar 10, entrar 10, esqueci-senha 5, redefinir-senha 20, verificar 20, `/me/senha` 10 (depois do `requireAuth`), descadastrar 20.
- **Tarefas em segundo plano** (`BackgroundJobs`, `shared/infra/background-jobs.ts`): no próprio processo, sem fila nem retentativa; o trabalho começa num `setImmediate` (depois de a resposta sair), falha vai pro log. `container.close()` espera as pendentes antes de fechar o banco; os testes chamam `idle()` antes de olhar o e-mail (o e2e faz isso a cada chamada).

## Produto (não negociável)

- Conta com e-mail e senha (ver "Autenticação" acima). A senha só existe como hash scrypt; o token dos links só existe no e-mail e o banco guarda o SHA-256. Link é de uso único (compare-and-set) e expira.
- Respostas que não revelam quem tem conta: esqueci-senha é sempre 202 com a mesma frase; entrar dá o mesmo 401 (e o mesmo tempo) pra e-mail sem conta, senha errada e conta sem senha. O cadastro é a exceção aceita pelo produto (409 "Já existe uma conta com esse e-mail…").
- E-mail mensal só pra quem confirmou o endereço (`emailVerificadoEm`) e está `ativo`. O job reserva o envio com `claimSend` antes de mandar e desfaz com `releaseSendClaim` se falhar: execuções sobrepostas não duplicam e-mail.
- LGPD: exportar e excluir tudo (módulo `privacidade`). Exclusão é física, não flag, numa transação, apagando na ordem das FKs: gastos fixos → dívidas → perfil → categorias personalizadas → planos, metas, check-ins → subscriber.
- Nunca recomendar produto, banco, corretora ou emissor em nenhum texto.
- Dinheiro sem centavo quebrado: no máximo 2 casas.

## Banco

- Migrations em `prisma/migrations`, SQL escrito/revisado à mão quando há rename (Prisma gera DROP+ADD).
- Migration nova no código = `yarn prisma:deploy` (`prisma migrate deploy`) no banco ANTES de usar a API: o Prisma lê todas as colunas do model, então coluna faltando (ex.: `senha_hash`, de `20260924000000_senha`, e `versao_sessao`, de `20260924010000_versao_da_sessao`) derruba com 500 toda rota que lê a conta, inclusive o middleware de sessão. `/api/health/ready` continua ok nesse caso.
- O catálogo de categorias é semeado na migration e reaplicável com `yarn db:seed` (lê do motor).
- `.env` do usuário tem a senha do Postgres local como placeholder: não tente adivinhar. Sem banco, use `PERSISTENCIA=memoria`.
