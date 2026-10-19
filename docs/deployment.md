# Implantação

A API e o worker usam a mesma imagem OCI e processos separados. O schema é preparado externamente antes de qualquer processo NestJS.

## Ordem obrigatória

1. Execute `database/releases/<release>/up.sql` com uma identidade proprietária usando `psql -v ON_ERROR_STOP=1`.
2. Execute o `verify.sql` da release e `database/verify/assertions.sql`.
3. Confirme que `app_meta.schema_build.revision` é `001-tenant-authentication-v3`.
4. Inicie/atualize API e worker com a identidade `barber_runtime`.
5. Libere tráfego somente quando `/ready` confirmar a revisão suportada.

O processo deve falhar antes do tráfego quando a revisão divergir. API e worker nunca recebem credenciais de owner e não executam scripts de schema.

## Observabilidade

API e worker escrevem logs JSON com correlation ID e trace/span IDs. Os logs aceitam somente campos estruturados permitidos; corpos HTTP, credenciais, e-mail, IP, erros crus e payloads da outbox não são registrados. Os spans usam operações fixas e IDs de correlação; métricas usam somente operação e resultado como rótulos.

Para exportar traces e métricas, configure `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` e `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` nos ambientes da API e do worker, apontando aos endpoints HTTP OTLP separados do Collector (normalmente `http://otel-collector:4318/v1/traces` e `/v1/metrics`). Sem esses valores, o processo mantém logging correlacionado e métricas locais, e não inicia exportação de rede. Proteja o tráfego ao Collector e não inclua segredos nos atributos de telemetria.

## Rollback

Pare o rollout da aplicação, execute o `rollback.sql` revisado da release com o owner, rode as verificações correspondentes e restaure a versão da aplicação compatível. Backups e ensaio de rollback são obrigatórios para ambientes persistentes.
