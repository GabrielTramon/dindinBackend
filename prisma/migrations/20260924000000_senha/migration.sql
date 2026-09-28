-- Conta com e-mail e senha.
--
-- Só o hash scrypt da senha é gravado (formato scrypt$N$r$p$<sal>$<hash>).
-- Nulo, sem default: as contas antigas, criadas pelo link mágico, não têm senha
-- até a pessoa criar uma (em "Esqueci a senha" ou na página da conta).

-- AlterTable
ALTER TABLE "subscribers" ADD COLUMN "senha_hash" TEXT;
