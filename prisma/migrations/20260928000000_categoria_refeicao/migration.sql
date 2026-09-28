-- Categoria nova no catálogo: "Refeição fora" (slug refeicao), o almoço do dia
-- de trabalho — é o gasto que o vale-refeição paga no plano
-- (dindinFrontend/src/domain/beneficios.ts). Espelha
-- dindinFrontend/src/domain/categorias.ts.
--
-- Ela entra primeiro no grupo PESSOAL, e as outras descem uma posição: é a
-- mesma numeração que o `yarn db:seed` daria (10, 20, 30… na ordem do catálogo).
-- Só o catálogo global (subscriber_id nulo); categoria criada por uma pessoa não
-- tem slug e não é tocada. ON CONFLICT deixa a migration repetível num banco
-- que já rodou o seed com o catálogo novo.

-- Data
UPDATE "categorias_gasto_fixo"
SET "ordem" = "ordem" + 10
WHERE "subscriber_id" IS NULL
  AND "grupo" = 'PESSOAL'
  AND "slug" IN ('celular', 'streaming', 'pet', 'anuidade_cartao')
  AND NOT EXISTS (SELECT 1 FROM "categorias_gasto_fixo" WHERE "slug" = 'refeicao');

INSERT INTO "categorias_gasto_fixo" ("id", "slug", "nome", "grupo", "icone", "ordem") VALUES
  (gen_random_uuid(), 'refeicao', 'Refeição fora', 'PESSOAL', 'Utensils', 10)
ON CONFLICT ("slug") DO NOTHING;
