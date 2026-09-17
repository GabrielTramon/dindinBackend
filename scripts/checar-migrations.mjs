#!/usr/bin/env node
/*
  As migrations batem com o schema.prisma?

  Aplica prisma/migrations num Postgres descartável e compara o resultado com
  prisma/schema.prisma. Se alguém mudou o schema e esqueceu a migration (ou
  editou uma migration à mão e ela divergiu), o diff não é vazio e este script
  falha mostrando o SQL que falta. Rode no CI, junto com `yarn motor:check`.

    node scripts/checar-migrations.mjs     (yarn db:check-migrations)

  Saída: 0 = em dia · 1 = há diferença (o SQL vai pro stdout) · 2 = não deu pra checar

  Sem Docker e sem senha: o banco-sombra é o PGlite (Postgres 18 em WASM, o
  mesmo dos testes de integração) servido por TCP numa porta livre, em UTC.
  No Prisma 7 não existe mais a flag --shadow-database-url: o banco-sombra vem
  do `datasource.shadowDatabaseUrl` de um prisma config — por isso o script
  escreve um config temporário e passa com --config.
*/

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(RAIZ, 'prisma', 'migrations');
const SCHEMA = join(RAIZ, 'prisma', 'schema.prisma');

/**
 * Processo filho SEM bloquear: o PGlite roda neste processo, e um spawnSync
 * congelaria o event loop — o servidor não aceitaria a conexão do Prisma (P1001).
 */
function executar(comando, argumentos) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(comando, argumentos, {
      cwd: RAIZ,
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    filho.stdout.setEncoding('utf8').on('data', (parte) => (stdout += parte));
    filho.stderr.setEncoding('utf8').on('data', (parte) => (stderr += parte));
    filho.on('error', rejeitar);
    filho.on('close', (status) => resolver({ status, stdout, stderr }));
  });
}

/** O CLI do Prisma chamado pelo node, sem npx: o shim quebra com espaço no caminho no Windows. */
function prismaCli() {
  const pacote = join(RAIZ, 'node_modules', 'prisma');
  const { bin } = JSON.parse(readFileSync(join(pacote, 'package.json'), 'utf8'));
  return join(pacote, typeof bin === 'string' ? bin : bin.prisma);
}

async function main() {
  // mesmo cuidado do test-database.ts: sem timezone, o PGlite herda o fuso da máquina
  const pglite = await PGlite.create({ postgresqlconf: ["timezone = 'UTC'"] });
  // o migrate abre mais de uma conexão; o padrão do pglite-socket é 1
  const server = new PGLiteSocketServer({ db: pglite, host: '127.0.0.1', port: 0, maxConnections: 16 });
  const pasta = mkdtempSync(join(tmpdir(), 'dindin-checar-migrations-'));

  try {
    await server.start();
    const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;

    const config = join(pasta, 'prisma.config.mjs');
    writeFileSync(
      config,
      [
        '// gerado por scripts/checar-migrations.mjs — apagado no fim',
        `export default ${JSON.stringify(
          {
            schema: SCHEMA,
            migrations: { path: MIGRATIONS },
            datasource: { url, shadowDatabaseUrl: url },
          },
          null,
          2,
        )};`,
        '',
      ].join('\n'),
    );

    const resultado = await executar(process.execPath, [
      prismaCli(),
      'migrate',
      'diff',
      '--from-migrations',
      MIGRATIONS,
      '--to-schema',
      SCHEMA,
      '--script',
      '--exit-code',
      '--config',
      config,
    ]);

    // --exit-code: 0 = diff vazio, 2 = há diferença, 1 = erro
    if (resultado.status === 0) {
      console.info('Migrations em dia: aplicar prisma/migrations chega exatamente no schema.prisma.');
      return 0;
    }
    if (resultado.status === 2) {
      console.error('As migrations NÃO batem com o schema.prisma. Falta isto (crie uma migration com `yarn prisma:migrate`):\n');
      console.info(resultado.stdout.trim());
      return 1;
    }
    console.error(`prisma migrate diff falhou (código ${resultado.status}):\n${resultado.stderr || resultado.stdout}`);
    return 2;
  } finally {
    rmSync(pasta, { recursive: true, force: true });
    await server.stop().catch(() => {});
    await pglite.close().catch(() => {});
  }
}

// importado por engano não roda nada
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (codigo) => {
      process.exitCode = codigo;
    },
    (erro) => {
      console.error(erro instanceof Error ? erro.stack ?? erro.message : erro);
      process.exitCode = 2;
    },
  );
}
