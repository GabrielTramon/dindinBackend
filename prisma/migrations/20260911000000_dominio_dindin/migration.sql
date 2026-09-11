-- dindin — domínio completo do planejador financeiro.
-- Gerada com: prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
-- O catálogo de gastos fixos é semeado no fim do arquivo.


-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tipo_renda" AS ENUM ('CLT', 'PJ', 'INFORMAL');

-- CreateEnum
CREATE TYPE "moradia" AS ENUM ('PAIS', 'ALUGUEL', 'DIVIDIDO', 'PROPRIA', 'FINANCIADA');

-- CreateEnum
CREATE TYPE "grupo_categoria" AS ENUM ('MORADIA', 'CASA', 'TRANSPORTE', 'SAUDE', 'EDUCACAO', 'PESSOAL', 'OUTROS');

-- CreateEnum
CREATE TYPE "tipo_divida" AS ENUM ('ROTATIVO', 'CHEQUE_ESPECIAL', 'EMPRESTIMO', 'FINANCIAMENTO', 'OUTRA');

-- CreateTable
CREATE TABLE "subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "subscriber_id" TEXT NOT NULL,
    "renda_mensal" DECIMAL(12,2) NOT NULL,
    "tipo_renda" "tipo_renda" NOT NULL,
    "idade" INTEGER NOT NULL,
    "moradia" "moradia" NOT NULL,
    "custo_moradia" DECIMAL(12,2) NOT NULL,
    "guardado" DECIMAL(12,2) NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("subscriber_id")
);

-- CreateTable
CREATE TABLE "categorias_gasto_fixo" (
    "id" TEXT NOT NULL,
    "slug" TEXT,
    "nome" TEXT NOT NULL,
    "grupo" "grupo_categoria" NOT NULL DEFAULT 'OUTROS',
    "icone" TEXT NOT NULL DEFAULT 'Tag',
    "ordem" INTEGER NOT NULL DEFAULT 999,
    "subscriber_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_gasto_fixo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gastos_fixos" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "categoria_id" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gastos_fixos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividas" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "tipo" "tipo_divida" NOT NULL,
    "saldo" DECIMAL(12,2) NOT NULL,
    "parcela" DECIMAL(12,2),
    "taxa_anual" DECIMAL(8,4),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dividas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "input_snap" JSONB NOT NULL,
    "resultado" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valor_alvo" DECIMAL(12,2) NOT NULL,
    "aporte_mensal" DECIMAL(12,2),
    "prazo_meses" INTEGER,
    "acumulado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "public_slug" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "renda_real" DECIMAL(12,2),
    "gasto_real" DECIMAL(12,2),
    "guardado_real" DECIMAL(12,2),
    "enviado_em" TIMESTAMP(3),
    "respondido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_email_key" ON "subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_token_key" ON "subscribers"("token");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_gasto_fixo_slug_key" ON "categorias_gasto_fixo"("slug");

-- CreateIndex
CREATE INDEX "categorias_gasto_fixo_subscriber_id_idx" ON "categorias_gasto_fixo"("subscriber_id");

-- CreateIndex
CREATE INDEX "categorias_gasto_fixo_grupo_ordem_idx" ON "categorias_gasto_fixo"("grupo", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_gasto_fixo_subscriber_id_nome_key" ON "categorias_gasto_fixo"("subscriber_id", "nome");

-- CreateIndex
CREATE INDEX "gastos_fixos_profile_id_idx" ON "gastos_fixos"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "gastos_fixos_profile_id_categoria_id_key" ON "gastos_fixos"("profile_id", "categoria_id");

-- CreateIndex
CREATE INDEX "dividas_profile_id_idx" ON "dividas"("profile_id");

-- CreateIndex
CREATE INDEX "plans_subscriber_id_criado_em_idx" ON "plans"("subscriber_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "plans_subscriber_id_versao_key" ON "plans"("subscriber_id", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "goals_public_slug_key" ON "goals"("public_slug");

-- CreateIndex
CREATE INDEX "goals_subscriber_id_idx" ON "goals"("subscriber_id");

-- CreateIndex
CREATE INDEX "check_ins_subscriber_id_idx" ON "check_ins"("subscriber_id");

-- CreateIndex
CREATE UNIQUE INDEX "check_ins_subscriber_id_competencia_key" ON "check_ins"("subscriber_id", "competencia");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_gasto_fixo" ADD CONSTRAINT "categorias_gasto_fixo_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos_fixos" ADD CONSTRAINT "gastos_fixos_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("subscriber_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos_fixos" ADD CONSTRAINT "gastos_fixos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_gasto_fixo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividas" ADD CONSTRAINT "dividas_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("subscriber_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================
-- Seed do catálogo
-- ============================================================

-- Catálogo de gastos fixos.
-- Espelha dindinFrontend/src/domain/categorias.ts — os slugs são o contrato
-- entre os dois. ON CONFLICT deixa a migration repetível sem duplicar linha.
INSERT INTO "categorias_gasto_fixo" ("id", "slug", "nome", "grupo", "icone", "ordem") VALUES
  (gen_random_uuid(), 'aluguel', 'Aluguel', 'MORADIA', 'House', 10),
  (gen_random_uuid(), 'financiamento_imovel', 'Financiamento do imóvel', 'MORADIA', 'Landmark', 20),
  (gen_random_uuid(), 'condominio', 'Condomínio', 'MORADIA', 'Building2', 30),
  (gen_random_uuid(), 'mercado', 'Mercado', 'CASA', 'ShoppingCart', 10),
  (gen_random_uuid(), 'luz', 'Luz', 'CASA', 'Zap', 20),
  (gen_random_uuid(), 'agua', 'Água', 'CASA', 'Droplets', 30),
  (gen_random_uuid(), 'internet', 'Internet', 'CASA', 'Wifi', 40),
  (gen_random_uuid(), 'gas', 'Gás', 'CASA', 'Flame', 50),
  (gen_random_uuid(), 'transporte_publico', 'Transporte', 'TRANSPORTE', 'Bus', 10),
  (gen_random_uuid(), 'combustivel', 'Combustível', 'TRANSPORTE', 'Fuel', 20),
  (gen_random_uuid(), 'financiamento_veiculo', 'Financiamento do carro', 'TRANSPORTE', 'Car', 30),
  (gen_random_uuid(), 'seguro_veiculo', 'Seguro do carro', 'TRANSPORTE', 'ShieldCheck', 40),
  (gen_random_uuid(), 'plano_saude', 'Plano de saúde', 'SAUDE', 'HeartPulse', 10),
  (gen_random_uuid(), 'academia', 'Academia', 'SAUDE', 'Dumbbell', 20),
  (gen_random_uuid(), 'remedios', 'Remédios', 'SAUDE', 'Pill', 30),
  (gen_random_uuid(), 'terapia', 'Terapia', 'SAUDE', 'Brain', 40),
  (gen_random_uuid(), 'faculdade', 'Faculdade', 'EDUCACAO', 'GraduationCap', 10),
  (gen_random_uuid(), 'escola', 'Escola', 'EDUCACAO', 'School', 20),
  (gen_random_uuid(), 'curso', 'Curso', 'EDUCACAO', 'BookOpen', 30),
  (gen_random_uuid(), 'celular', 'Celular', 'PESSOAL', 'Smartphone', 10),
  (gen_random_uuid(), 'streaming', 'Streaming e assinaturas', 'PESSOAL', 'Tv', 20),
  (gen_random_uuid(), 'pet', 'Pet', 'PESSOAL', 'PawPrint', 30),
  (gen_random_uuid(), 'anuidade_cartao', 'Anuidade do cartão', 'PESSOAL', 'CreditCard', 40),
  (gen_random_uuid(), 'outro', 'Outro', 'OUTROS', 'Tag', 10)
ON CONFLICT ("slug") DO NOTHING;
