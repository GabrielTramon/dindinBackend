-- Senha nova encerra as sessões de antes.
--
-- O token de sessão (JWT) leva a versão das sessões da conta quando saiu; cada
-- senha nova (redefinir pelo e-mail ou trocar na página da conta) sobe a versão,
-- e token de outra versão deixa de valer. Default 0: as contas que já existem
-- ficam na versão 0, e os tokens emitidos antes desta regra (sem versão) contam
-- como 0 — continuam valendo até a primeira senha nova.

-- AlterTable
ALTER TABLE "subscribers" ADD COLUMN "versao_sessao" INTEGER NOT NULL DEFAULT 0;
