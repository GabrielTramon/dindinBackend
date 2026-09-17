import { z } from 'zod';

/*
  Configuração lida do ambiente UMA vez, no boot, e validada inteira. Faltou
  algo → o processo não sobe e diz exatamente o quê. Nada no resto do código
  lê process.env.
*/

const booleano = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3333),

    /** prisma = Postgres; memoria = tudo na RAM, some ao reiniciar (desenvolvimento e demo) */
    PERSISTENCIA: z.enum(['prisma', 'memoria']).default('prisma'),
    DATABASE_URL: z.string().optional(),

    /** origens separadas por vírgula; "*" só fora de produção */
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    /** saltos de proxy confiáveis (0 = sem proxy); afeta req.ip e o rate limit */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    LOG_REQUESTS: booleano.default(true),

    // obrigatoriedade e tamanho checados no superRefine: assim um boot quebrado lista TODOS os problemas
    JWT_SECRET: z.string().optional(),
    SESSAO_DIAS: z.coerce.number().int().min(1).max(365).default(30),
    LINK_MAGICO_MINUTOS: z.coerce.number().int().min(5).max(1440).default(15),

    /** onde o frontend roda: base dos links que vão nos e-mails */
    APP_URL: z.url({ error: 'APP_URL precisa ser uma URL' }).default('http://localhost:3000'),

    EMAIL_PROVEDOR: z.enum(['console', 'resend']).default('console'),
    EMAIL_REMETENTE: z.string().default('dindin <nao-responda@dindin.app>'),
    RESEND_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const problema = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

    if (!env.JWT_SECRET) problema('JWT_SECRET', 'obrigatória (gere uma: veja .env.example)');
    else if (env.JWT_SECRET.length < 32) problema('JWT_SECRET', 'precisa de pelo menos 32 caracteres');

    if (env.PERSISTENCIA === 'prisma') {
      if (!env.DATABASE_URL) problema('DATABASE_URL', 'obrigatória com PERSISTENCIA=prisma');
      else if (env.DATABASE_URL.includes('SUA_SENHA') || env.DATABASE_URL.includes('USUARIO:SENHA')) {
        problema('DATABASE_URL', 'ainda tem a senha de exemplo — preencha, ou suba com PERSISTENCIA=memoria');
      }
    }
    if (env.EMAIL_PROVEDOR === 'resend' && !env.RESEND_API_KEY) {
      problema('RESEND_API_KEY', 'obrigatória com EMAIL_PROVEDOR=resend');
    }
    if (env.NODE_ENV === 'production') {
      if (env.PERSISTENCIA === 'memoria') problema('PERSISTENCIA', 'memoria não é permitida em produção');
      if (env.EMAIL_PROVEDOR === 'console') problema('EMAIL_PROVEDOR', 'console não envia e-mail de verdade');
      if (env.CORS_ORIGIN.split(',').some((o) => o.trim() === '*')) problema('CORS_ORIGIN', '"*" não é permitido em produção');
      // os links de login vão por e-mail com essa base: http ou localhost mandaria gente pra lugar errado
      try {
        const url = new URL(env.APP_URL);
        if (url.protocol !== 'https:') problema('APP_URL', 'precisa ser https em produção');
        if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) problema('APP_URL', 'não pode ser localhost em produção');
      } catch {
        /* formato já reportado pelo schema */
      }
    }
  });

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  persistence: 'prisma' | 'memoria';
  databaseUrl: string | undefined;
  corsOrigins: string[] | '*';
  trustProxy: number;
  logRequests: boolean;
  jwtSecret: string;
  sessionTtlSeconds: number;
  magicLinkTtlMinutes: number;
  appUrl: string;
  mail: { provider: 'console' | 'resend'; from: string; resendApiKey: string | undefined };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(source);
  if (!result.success) {
    const linhas = result.error.issues.map((i) => `  - ${i.path.join('.') || '(ambiente)'}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${linhas.join('\n')}\nVeja .env.example.`);
  }
  const e = result.data;
  const origins = e.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    persistence: e.PERSISTENCIA,
    databaseUrl: e.DATABASE_URL,
    corsOrigins: origins.includes('*') ? '*' : origins,
    trustProxy: e.TRUST_PROXY,
    logRequests: e.LOG_REQUESTS,
    jwtSecret: e.JWT_SECRET ?? '',
    sessionTtlSeconds: e.SESSAO_DIAS * 24 * 60 * 60,
    magicLinkTtlMinutes: e.LINK_MAGICO_MINUTOS,
    appUrl: e.APP_URL.replace(/\/+$/, ''),
    mail: { provider: e.EMAIL_PROVEDOR, from: e.EMAIL_REMETENTE, resendApiKey: e.RESEND_API_KEY },
  };
}
