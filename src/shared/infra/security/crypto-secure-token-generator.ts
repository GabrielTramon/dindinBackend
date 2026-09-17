import { createHash, randomBytes } from 'node:crypto';
import type { SecureTokenGenerator } from '../../application/ports';

/** 32 bytes aleatórios em base64url (43 caracteres, cabe numa URL sem escape). Hash: SHA-256 em hex. */
export class CryptoSecureTokenGenerator implements SecureTokenGenerator {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
