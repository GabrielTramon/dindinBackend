-- Login por link mágico.
--
-- subscribers.token passa a guardar o SHA-256 do token (o token em si só vive
-- no e-mail). Duas colunas novas: quando o link expira e quando o e-mail foi
-- confirmado — sem confirmação, o endereço pode ter sido digitado por outra
-- pessoa, e o e-mail mensal nunca é enviado.
--
-- Corrige também criadoEm/atualizadoEm, as únicas colunas do schema que tinham
-- ficado em camelCase. RENAME em vez de DROP + ADD: preserva dados se a
-- migration anterior já tiver sido aplicada em algum lugar.

ALTER TABLE "subscribers" RENAME COLUMN "criadoEm" TO "criado_em";
ALTER TABLE "subscribers" RENAME COLUMN "atualizadoEm" TO "atualizado_em";

ALTER TABLE "subscribers" ADD COLUMN "token_expira_em" TIMESTAMP(3);
ALTER TABLE "subscribers" ADD COLUMN "email_verificado_em" TIMESTAMP(3);
