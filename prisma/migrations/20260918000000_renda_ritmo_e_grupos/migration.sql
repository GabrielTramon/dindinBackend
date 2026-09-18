-- Renda bruta, ritmo, meta principal e os grupos que repartem o que sobra.
--
-- Toda coluna nova do perfil e NULA e sem DEFAULT, de proposito: quem respondeu
-- antes disso informou o liquido e nao escolheu ritmo, e NULL e o unico valor
-- que distingue "nao escolheu" de "escolheu o padrao". Um DEFAULT mudaria o
-- snapshot de todo plano ja gravado e criaria uma versao nova pra base inteira.
--
-- grupos/itens_grupo tem chave primaria composta com o dono porque o id vem do
-- cliente (e o mesmo do localStorage): sem o dono na chave, o id de uma pessoa
-- colidiria com o de outra.

-- CreateEnum
CREATE TYPE "renda_informada" AS ENUM ('BRUTA', 'LIQUIDA');

-- CreateEnum
CREATE TYPE "ritmo" AS ENUM ('LEVE', 'EQUILIBRADO', 'ACELERADO');

-- CreateEnum
CREATE TYPE "meta_tipo" AS ENUM ('CARRO', 'CASA', 'LIBERDADE', 'EMERGENCIA', 'VIAGEM', 'ESTUDOS', 'OUTRO');

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "competencia_tabela" TEXT,
ADD COLUMN     "dependentes" INTEGER,
ADD COLUMN     "meta_nome" TEXT,
ADD COLUMN     "meta_tipo" "meta_tipo",
ADD COLUMN     "meta_valor_alvo" DECIMAL(12,2),
ADD COLUMN     "renda_informada" "renda_informada",
ADD COLUMN     "ritmo" "ritmo",
ADD COLUMN     "salario_bruto" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "grupos" (
    "id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "icone" TEXT NOT NULL DEFAULT 'Tag',
    "valor" DECIMAL(12,2) NOT NULL,
    "conta_para_meta" BOOLEAN NOT NULL DEFAULT false,
    "rendimento_mensal" DECIMAL(6,4),
    "do_sistema" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grupos_pkey" PRIMARY KEY ("subscriber_id","id")
);

-- CreateTable
CREATE TABLE "itens_grupo" (
    "id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "grupo_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "itens_grupo_pkey" PRIMARY KEY ("subscriber_id","grupo_id","id")
);

-- CreateIndex
CREATE INDEX "grupos_subscriber_id_ordem_idx" ON "grupos"("subscriber_id", "ordem");

-- CreateIndex
CREATE INDEX "itens_grupo_subscriber_id_grupo_id_ordem_idx" ON "itens_grupo"("subscriber_id", "grupo_id", "ordem");

-- AddForeignKey
ALTER TABLE "grupos" ADD CONSTRAINT "grupos_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_grupo" ADD CONSTRAINT "itens_grupo_subscriber_id_grupo_id_fkey" FOREIGN KEY ("subscriber_id", "grupo_id") REFERENCES "grupos"("subscriber_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
