#!/usr/bin/env node
/*
  Copia o motor do plano do frontend para src/shared/motor.

  O motor (a cascata, as projeções, os textos, o catálogo de categorias) é
  domínio puro e precisa rodar nos dois lados: no frontend pra renderizar as
  páginas estáticas, no backend pra gerar o plano sem confiar no cliente.
  Como são dois repositórios, o código vive duas vezes — e este script é o
  que impede as duas cópias de divergirem.

    node scripts/sincronizar-motor.mjs            copia (sobrescreve)
    node scripts/sincronizar-motor.mjs --check    só compara; sai com 1 se divergir

  O frontend é procurado em ../dindinFrontend; outro lugar via DINDIN_FRONTEND_DIR.

  Os testes do motor vêm junto, então a suíte do backend também protege a
  regra do produto.
*/

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = resolve(process.env.DINDIN_FRONTEND_DIR ?? join(RAIZ, '..', 'dindinFrontend'));
const DESTINO = join(RAIZ, 'src', 'shared', 'motor');
const CHECAR = process.argv.includes('--check');

const CABECALHO = (origem) =>
  [
    '/*',
    `  GERADO a partir de dindinFrontend/${origem} — NÃO EDITE AQUI.`,
    '  Altere no frontend e rode `yarn motor:sync` no backend.',
    '*/',
    '',
    '',
  ].join('\n');

/** @returns {Map<string, string>} nome do arquivo de destino → conteúdo */
function montar() {
  const dominio = join(FRONTEND, 'src', 'domain');
  const format = join(FRONTEND, 'src', 'lib', 'format.ts');
  if (!existsSync(dominio) || !existsSync(format)) {
    console.error(`Frontend não encontrado em ${FRONTEND}. Defina DINDIN_FRONTEND_DIR.`);
    process.exit(2);
  }

  const arquivos = new Map();
  for (const nome of readdirSync(dominio).filter((n) => n.endsWith('.ts')).sort()) {
    const fonte = readFileSync(join(dominio, nome), 'utf8')
      .replace(/\r\n/g, '\n')
      // o alias @/ do Next não existe no backend: format.ts vem pra mesma pasta
      .replace(/from "@\/lib\/format"/g, 'from "./format"');
    if (/from "@\//.test(fonte)) {
      console.error(`${nome}: importa outro módulo "@/..." além de @/lib/format. Ajuste o script.`);
      process.exit(2);
    }
    arquivos.set(nome, CABECALHO(`src/domain/${nome}`) + fonte);
  }
  arquivos.set(
    'format.ts',
    CABECALHO('src/lib/format.ts') + readFileSync(format, 'utf8').replace(/\r\n/g, '\n'),
  );
  return arquivos;
}

const esperados = montar();
const existentes = existsSync(DESTINO) ? readdirSync(DESTINO).filter((n) => n.endsWith('.ts')) : [];

if (CHECAR) {
  const divergentes = [];
  for (const [nome, conteudo] of esperados) {
    const caminho = join(DESTINO, nome);
    if (!existsSync(caminho)) divergentes.push(`faltando: ${nome}`);
    else if (readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n') !== conteudo) divergentes.push(`diferente: ${nome}`);
  }
  for (const nome of existentes) if (!esperados.has(nome)) divergentes.push(`sobrando: ${nome}`);

  if (divergentes.length > 0) {
    console.error('O motor do backend divergiu do frontend:\n  ' + divergentes.join('\n  '));
    console.error('Rode `yarn motor:sync`.');
    process.exit(1);
  }
  console.log(`Motor em dia com o frontend (${esperados.size} arquivos).`);
  process.exit(0);
}

mkdirSync(DESTINO, { recursive: true });
for (const nome of existentes) if (!esperados.has(nome)) rmSync(join(DESTINO, nome));
for (const [nome, conteudo] of esperados) writeFileSync(join(DESTINO, nome), conteudo);
console.log(`Motor sincronizado: ${esperados.size} arquivos em ${basename(RAIZ)}/src/shared/motor.`);
