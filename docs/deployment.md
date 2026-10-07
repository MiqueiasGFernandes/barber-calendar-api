# Implantação

A API e o worker usam a mesma imagem OCI e processos separados. O schema é preparado externamente antes de qualquer processo NestJS.

## Ordem obrigatória

1. Execute `database/releases/<release>/up.sql` com uma identidade proprietária usando `psql -v ON_ERROR_STOP=1`.
2. Execute o `verify.sql` da release e `database/verify/assertions.sql`.
3. Confirme que `app_meta.schema_build.revision` é `001-tenant-authentication-v3`.
4. Inicie/atualize API e worker com a identidade `barber_runtime`.
5. Libere tráfego somente quando `/ready` confirmar a revisão suportada.

O processo deve falhar antes do tráfego quando a revisão divergir. API e worker nunca recebem credenciais de owner e não executam scripts de schema.

## Rollback

Pare o rollout da aplicação, execute o `rollback.sql` revisado da release com o owner, rode as verificações correspondentes e restaure a versão da aplicação compatível. Backups e ensaio de rollback são obrigatórios para ambientes persistentes.

