import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { PasswordHasher } from '../../application/ports';

/*
  Hash de senha com scrypt, do node:crypto (sem dependência nova).

  Formato gravado — carrega os próprios parâmetros, então dá pra endurecer o
  custo no futuro sem invalidar as senhas antigas (cada uma confere com os
  parâmetros com que foi feita):

    scrypt$16384$8$1$<sal em base64>$<hash em base64>

  N=16384, r=8, p=1 (~16 MiB de memória por hash), sal aleatório de 16 bytes,
  64 bytes de saída. A comparação é com timingSafeEqual: o tempo não diz quantos
  bytes bateram.

  A senha vai como a pessoa digitou (UTF-8, sem trim nem normalização Unicode).
*/

const PREFIXO = 'scrypt';
const N = 16384;
const R = 8;
const P = 1;
const TAMANHO_DO_SAL = 16;
const TAMANHO_DO_HASH = 64;

/*
  Tetos pra conferir um hash lido do banco. O hash vem do nosso próprio banco,
  mas um valor corrompido com N gigante travaria o processo (memória = 128·N·r):
  fora da faixa, a senha simplesmente não confere.
*/
const N_MAXIMO = 2 ** 20;
const R_MAXIMO = 32;
const P_MAXIMO = 16;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function derivar(senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // a string vira UTF-8 aqui, sem normalize(): "é" composto e decomposto são senhas diferentes
    scrypt(senha, sal, tamanho, opcoes, (erro, chave) =>
      erro ? reject(erro) : resolve(chave),
    );
  });
}

/** memória que o scrypt precisa com folga: sem isso, N·r alto estoura o maxmem padrão (32 MiB) */
function memoriaPara(n: number, r: number): number {
  return 128 * n * r * 2;
}

function inteiro(texto: string | undefined): number | null {
  if (texto === undefined || !/^\d{1,8}$/.test(texto)) return null;
  return Number(texto);
}

interface HashLido {
  n: number;
  r: number;
  p: number;
  sal: Buffer;
  hash: Buffer;
}

function ler(guardado: string): HashLido | null {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== PREFIXO) return null;
  const [, nTexto, rTexto, pTexto, salTexto, hashTexto] = partes;
  const n = inteiro(nTexto);
  const r = inteiro(rTexto);
  const p = inteiro(pTexto);
  if (n === null || r === null || p === null) return null;
  // N potência de 2 maior que 1, como o scrypt exige
  if (n < 2 || n > N_MAXIMO || (n & (n - 1)) !== 0) return null;
  if (r < 1 || r > R_MAXIMO || p < 1 || p > P_MAXIMO) return null;
  if (!salTexto || !hashTexto || !BASE64.test(salTexto) || !BASE64.test(hashTexto)) return null;
  const sal = Buffer.from(salTexto, 'base64');
  const hash = Buffer.from(hashTexto, 'base64');
  if (sal.length === 0 || hash.length < 16 || hash.length > 128) return null;
  return { n, r, p, sal, hash };
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(senha: string): Promise<string> {
    const sal = randomBytes(TAMANHO_DO_SAL);
    const hash = await derivar(senha, sal, TAMANHO_DO_HASH, { N, r: R, p: P, maxmem: memoriaPara(N, R) });
    return [PREFIXO, N, R, P, sal.toString('base64'), hash.toString('base64')].join('$');
  }

  async verify(senha: string, guardado: string): Promise<boolean> {
    const lido = ler(guardado);
    if (!lido) return false;
    try {
      const calculado = await derivar(senha, lido.sal, lido.hash.length, {
        N: lido.n,
        r: lido.r,
        p: lido.p,
        maxmem: memoriaPara(lido.n, lido.r),
      });
      return timingSafeEqual(calculado, lido.hash);
    } catch {
      // parâmetro que o scrypt recusou: pra quem entra, é só "não confere"
      return false;
    }
  }
}
