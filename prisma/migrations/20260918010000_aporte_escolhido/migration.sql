-- O valor que a pessoa decidiu guardar por mes, no lugar do que o ritmo sugere.
-- Nulo, sem default, pelo mesmo motivo das outras: NULL distingue "nao escolheu"
-- de "escolheu esse valor", e um default mudaria o snapshot de quem ja tem plano.

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "aporte_escolhido" DECIMAL(12,2);
