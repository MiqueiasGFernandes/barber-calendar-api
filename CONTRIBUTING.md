# Contribuição

## Alterações estruturais no PostgreSQL

Toda alteração de schema deve ser SQL manual e revisável. A aplicação e o usuário runtime não executam DDL.

Checklist obrigatório:

- Atualizar o snapshot canônico em `database/schema/` para bancos novos.
- Criar `database/releases/<release>/up.sql`, `verify.sql` e `rollback.sql` para bancos persistentes.
- Executar o `up.sql` e o `verify.sql` em uma cópia isolada; testar o `rollback.sql` antes da revisão.
- Atualizar `app_meta.schema_build`, `database/verify/assertions.sql` e o hash de drift no mesmo commit.
- Executar `yarn schema:check` e `yarn test:e2e` a partir de um PostgreSQL vazio.
- Confirmar que `barber_runtime` mantém somente CONNECT/USAGE e DML necessários, sem CREATE/ALTER/DROP.

Nunca introduza ORM migrations, auto-sync, `db push` ou DDL no bootstrap da API/worker.
