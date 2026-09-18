import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  A regra de dependência do CLAUDE.md, verificada. Se alguém importa o que não
  pode, o `yarn test` quebra com a lista de violações — com vários agentes (ou
  várias pessoas) mexendo em módulos ao mesmo tempo, regra só no papel não segura.
*/

const SRC = path.resolve(__dirname, '..');
const MODULES = path.join(SRC, 'modules');

/** Quem cada módulo pode importar (só pelo index). */
const GRAFO: Record<string, readonly string[]> = {
  identidade: [],
  categorias: [],
  dividas: [],
  metas: [],
  planos: [],
  // organizacao só GUARDA a árvore de grupos: quem calcula a base (o excedente) é o motor, no cliente
  organizacao: [],
  'gastos-fixos': ['categorias'],
  perfil: ['categorias', 'gastos-fixos', 'dividas'],
  'check-ins': ['planos', 'identidade'],
  privacidade: [
    'identidade',
    'categorias',
    'perfil',
    'gastos-fixos',
    'dividas',
    'planos',
    'metas',
    'check-ins',
    // exportar e excluir tudo (LGPD) alcança a árvore de grupos também
    'organizacao',
  ],
};

interface Arquivo {
  abs: string;
  rel: string;
  teste: boolean;
}

function listar(dir: string): Arquivo[] {
  const out: Arquivo[] = [];
  for (const nome of readdirSync(dir)) {
    const abs = path.join(dir, nome);
    if (statSync(abs).isDirectory()) {
      if (nome === 'generated' || nome === 'node_modules') continue;
      out.push(...listar(abs));
    } else if (nome.endsWith('.ts') && !nome.endsWith('.d.ts')) {
      const rel = path.relative(SRC, abs).split(path.sep).join('/');
      out.push({ abs, rel, teste: /\.test\.ts$|\.contract\.ts$/.test(nome) || rel.startsWith('test/') });
    }
  }
  return out;
}

function imports(fonte: string): string[] {
  const achados = new Set<string>();
  const padroes = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s+['"]([^'"]+)['"]/gm];
  for (const p of padroes) for (const m of fonte.matchAll(p)) achados.add(m[1]!);
  return [...achados];
}

/** Resolve um import relativo pro caminho relativo a src/, sem extensão ("modules/categorias/index"). */
function resolver(de: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(de), spec);
  const candidatos = [`${base}.ts`, path.join(base, 'index.ts')];
  const achado = candidatos.find((c) => existsSync(c)) ?? `${base}.ts`;
  return path.relative(SRC, achado).split(path.sep).join('/').replace(/\.ts$/, '');
}

function moduloDe(rel: string): string | null {
  const m = /^modules\/([^/]+)\//.exec(rel);
  return m ? m[1]! : null;
}

const arquivos = listar(SRC);

function violacoes(regra: (a: Arquivo, spec: string, alvo: string | null) => string | null): string[] {
  const out: string[] = [];
  for (const a of arquivos) {
    for (const spec of imports(readFileSync(a.abs, 'utf8'))) {
      const msg = regra(a, spec, resolver(a.abs, spec));
      if (msg) out.push(`${a.rel}: ${msg} (import '${spec}')`);
    }
  }
  return out;
}

describe('arquitetura', () => {
  it('todo módulo existente está no grafo declarado', () => {
    const existentes = readdirSync(MODULES).filter((n) => statSync(path.join(MODULES, n)).isDirectory());
    expect(existentes.filter((m) => !(m in GRAFO))).toEqual([]);
  });

  it('entre módulos, só pelo index — e só nas arestas permitidas', () => {
    const erros = violacoes((a, _spec, alvo) => {
      const origem = moduloDe(a.rel);
      const destino = alvo ? moduloDe(`${alvo}/`) ?? moduloDe(alvo) : null;
      if (!origem || !destino || origem === destino) return null;
      const peloIndex = alvo === `modules/${destino}/index` || alvo === `modules/${destino}`;
      // teste pode montar os adaptadores reais do vizinho (repositório em memória, Prisma), mas só pelo infra.ts dele
      const testePeloInfra = a.teste && alvo === `modules/${destino}/infra`;
      if (!peloIndex && !testePeloInfra) {
        return `importa o interior de "${destino}"; use o index`;
      }
      // a aresta vale pra teste também: teste de "dividas" que precisa de "perfil" é sinal de dependência errada
      if (!GRAFO[origem]?.includes(destino)) return `"${origem}" não pode depender de "${destino}"`;
      return null;
    });
    expect(erros).toEqual([]);
  });

  it('main só usa um módulo pelo index ou pelo infra.ts', () => {
    const erros = violacoes((a, _spec, alvo) => {
      if (!a.rel.startsWith('main/') || !alvo) return null;
      const destino = moduloDe(`${alvo}/`) ?? moduloDe(alvo);
      if (!destino) return null;
      const permitidos = [`modules/${destino}`, `modules/${destino}/index`, `modules/${destino}/infra`];
      return permitidos.includes(alvo) ? null : `importa o interior de "${destino}"; use o index ou o infra.ts`;
    });
    expect(erros).toEqual([]);
  });

  it('infra de um módulo só é importada pelo próprio módulo, pelo main ou por testes', () => {
    const erros = violacoes((a, _spec, alvo) => {
      if (!alvo) return null;
      const m = /^modules\/([^/]+)\/infra(\/|$)/.exec(alvo);
      if (!m) return null;
      const dono = m[1];
      if (moduloDe(a.rel) === dono || a.rel.startsWith('main/') || a.teste) return null;
      return `usa adaptador de "${dono}"`;
    });
    expect(erros).toEqual([]);
  });

  it('domain e application não conhecem Express, Prisma nem a própria infra', () => {
    const erros = violacoes((a, spec, alvo) => {
      if (a.teste) return null;
      const camada = /^modules\/[^/]+\/(domain|application)\//.exec(a.rel)?.[1];
      if (!camada) return null;
      if (/^(express|@prisma\/|pg$|jsonwebtoken|express-rate-limit)/.test(spec)) return `${camada} importa "${spec}"`;
      if (alvo && /(^|\/)generated\/prisma/.test(alvo)) return `${camada} importa o client do Prisma`;
      if (alvo && /^(modules\/[^/]+\/infra|shared\/infra)(\/|$)/.test(alvo)) return `${camada} importa infra`;
      if (camada === 'domain' && alvo && /^modules\/[^/]+\/application\//.test(alvo)) return 'domain importa application';
      return null;
    });
    expect(erros).toEqual([]);
  });

  it('shared não conhece módulos nem main; motor gerado é puro', () => {
    const erros = violacoes((a, spec, alvo) => {
      if (!a.rel.startsWith('shared/')) return null;
      if (alvo && /^(modules|main)\//.test(alvo)) return 'shared importa módulo/main';
      if (a.rel.startsWith('shared/motor/') && !a.teste && !spec.startsWith('.') && spec !== 'zod') {
        return `motor importa "${spec}"`;
      }
      return null;
    });
    expect(erros).toEqual([]);
  });

  it('código de produção não importa src/test', () => {
    const erros = violacoes((a, _spec, alvo) => (!a.teste && alvo?.startsWith('test/') ? 'importa helper de teste' : null));
    expect(erros).toEqual([]);
  });
});
