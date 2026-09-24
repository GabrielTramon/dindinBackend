import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from './scrypt-password-hasher';

const hasher = new ScryptPasswordHasher();
const FORMATO = /^scrypt\$16384\$8\$1\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

describe('ScryptPasswordHasher', () => {
  it('formato scrypt$16384$8$1$<sal 16 bytes>$<hash 64 bytes>, e a senha não aparece nele', async () => {
    const hash = await hasher.hash('minha senha boa');
    const partes = FORMATO.exec(hash);
    expect(partes).not.toBeNull();
    expect(Buffer.from(partes![1]!, 'base64')).toHaveLength(16);
    expect(Buffer.from(partes![2]!, 'base64')).toHaveLength(64);
    expect(hash).not.toContain('minha senha boa');
  });

  it('é o scrypt de verdade com esses parâmetros (confere com o scryptSync do Node)', async () => {
    const hash = await hasher.hash('conferir por fora');
    const [, , , , sal, esperado] = hash.split('$');
    const calculado = scryptSync('conferir por fora', Buffer.from(sal!, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    expect(calculado.toString('base64')).toBe(esperado);
  });

  it('confere a senha certa e recusa as outras', async () => {
    const hash = await hasher.hash('minha senha boa');
    expect(await hasher.verify('minha senha boa', hash)).toBe(true);
    expect(await hasher.verify('minha senha boA', hash)).toBe(false);
    expect(await hasher.verify('', hash)).toBe(false);
  });

  it('sem trim nem normalização: espaço a mais e "é" decomposto são outras senhas', async () => {
    const hash = await hasher.hash('café com leite');
    expect(await hasher.verify(' café com leite', hash)).toBe(false);
    expect(await hasher.verify('café com leite '.trimEnd(), hash)).toBe(true);
    expect(await hasher.verify('café com leite', hash)).toBe(false);
  });

  it('sal aleatório: a mesma senha dá hashes diferentes, e cada um confere', async () => {
    const [a, b] = [await hasher.hash('repetida123'), await hasher.hash('repetida123')];
    expect(a).not.toBe(b);
    expect(await hasher.verify('repetida123', a)).toBe(true);
    expect(await hasher.verify('repetida123', b)).toBe(true);
  });

  it('confere com os parâmetros gravados no hash (dá pra endurecer o custo sem perder as senhas antigas)', async () => {
    const sal = Buffer.from('0123456789abcdef');
    const antigo = scryptSync('senha de antes', sal, 32, { N: 1024, r: 4, p: 2 });
    const gravado = `scrypt$1024$4$2$${sal.toString('base64')}$${antigo.toString('base64')}`;
    expect(await hasher.verify('senha de antes', gravado)).toBe(true);
    expect(await hasher.verify('outra', gravado)).toBe(false);
  });

  it.each([
    ['vazio', ''],
    ['outro algoritmo', 'bcrypt$10$abc$def'],
    ['partes a menos', 'scrypt$16384$8$1$c2Fs'],
    ['N que não é potência de 2', 'scrypt$1000$8$1$c2FsLXNhbC1zYWwtc2Fs$aGFzaC1oYXNoLWhhc2gtaGFzaA=='],
    ['N gigante (travaria o processo)', 'scrypt$1073741824$8$1$c2FsLXNhbC1zYWwtc2Fs$aGFzaC1oYXNoLWhhc2gtaGFzaA=='],
    ['r zero', 'scrypt$16384$0$1$c2FsLXNhbC1zYWwtc2Fs$aGFzaC1oYXNoLWhhc2gtaGFzaA=='],
    ['número com sinal', 'scrypt$-16384$8$1$c2FsLXNhbC1zYWwtc2Fs$aGFzaC1oYXNoLWhhc2gtaGFzaA=='],
    ['base64 inválido', 'scrypt$16384$8$1$!!!$aGFzaC1oYXNoLWhhc2gtaGFzaA=='],
    ['hash curto demais', 'scrypt$16384$8$1$c2FsLXNhbC1zYWwtc2Fs$YWJj'],
    ['sal vazio', 'scrypt$16384$8$1$$aGFzaC1oYXNoLWhhc2gtaGFzaA=='],
  ])('hash malformado (%s) → false, sem lançar', async (_caso, gravado) => {
    await expect(hasher.verify('qualquer senha', gravado)).resolves.toBe(false);
  });
});
