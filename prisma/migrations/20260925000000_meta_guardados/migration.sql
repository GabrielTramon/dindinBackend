-- A parte do que a pessoa ja tem guardado que ela pos na meta, em potes (CDB,
-- poupanca...), cada um com o seu valor e o seu rendimento ao mes:
-- [{ "id", "nome", "valor", "rendimentoMensal"? }] — o Meta.guardados do motor.
--
-- NULA e sem DEFAULT, como as outras colunas da meta: NULL e "nao respondeu",
-- e e diferente de [] ("nao, e a minha reserva"). Um DEFAULT mudaria o snapshot
-- de todo plano ja gravado e criaria uma versao nova pra base inteira.

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN "meta_guardados" JSONB;
