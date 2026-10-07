# Tarefas: Autenticação de Tenant sem Senha

**Entrada**: Documentos em `/specs/001-tenant-authentication/`

**Pré-requisitos**: `plan.md`, `spec.md`, `research.md`, `data-model.md` e `contracts/openapi.yaml`

**Testes**: A constituição exige TDD, testes de domínio, integração real com PostgreSQL, contratos de API, isolamento multi-tenant e concorrência. Em cada história, escreva os testes antes da implementação e confirme que falham.

**Organização**: As tarefas são agrupadas por história para permitir entrega incremental. Fundação comum inclui a infraestrutura que todas as histórias precisam.

## Formato: `[ID] [P?] [História] Descrição`

- **[P]**: Pode ser executada em paralelo, em arquivos diferentes e sem dependência de tarefa incompleta.
- **[História]**: História a que a tarefa pertence: US1, US2 ou US3.
- Cada tarefa aponta os arquivos concretos que cria ou altera.

## Fase 1: Preparação

**Objetivo**: Criar o workspace NestJS e a estrutura executável do monólito modular.

- [X] T001 Criar `package.json` com scripts `build`, `start:dev`, `start:prod`, `worker`, `lint`, `typecheck`, `test:unit`, `test:integration`, `test:contract` e `test:e2e`, fixar Node.js 24 e pnpm 12 em `package.json` e `.npmrc`.
- [X] T002 Configurar TypeScript 6 ESM estrito, `NodeNext`, `strict`, `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes` em `tsconfig.json`, `tsconfig.build.json` e `nest-cli.json`.
- [X] T003 [P] Configurar ESLint, Prettier e regras para proibir deep imports/ciclos entre módulos em `eslint.config.mjs` e `.prettierrc.json`.
- [X] T004 Criar a estrutura inicial NestJS com entrypoints HTTP em `src/main.ts`, composição em `src/app.module.ts`, módulos em `src/modules/` e utilitários mínimos em `src/shared/`.
- [X] T005 Configurar Vitest, cobertura e projetos separados para unitário, integração, contrato e E2E em `vitest.config.ts`, `vitest.integration.config.ts`, `vitest.contract.config.ts` e `vitest.e2e.config.ts`.
- [X] T006 Criar Dockerfile multiestágio Node.js 24, usuário não-root e `.dockerignore` em `Dockerfile` e `.dockerignore`.
- [X] T007 [P] Criar Compose de desenvolvimento para PostgreSQL 18.6 e Mailpit, healthchecks e redes privadas em `compose.yaml`.
- [X] T008 Criar Compose E2E isolado com PostgreSQL 18.6 em `compose.e2e.yaml`, armazenamento efêmero, project name parametrizável, bootstrap SQL read-only e healthcheck condicionado a `app_meta.schema_build`.
- [X] T009 Criar o orquestrador E2E com subida, espera de healthcheck, execução serial da suíte e teardown `down -v --remove-orphans` garantido em `scripts/test-e2e.sh`.

---

## Fase 2: Fundação

**Objetivo**: Disponibilizar fronteiras arquiteturais, schema SQL, transações e componentes comuns exigidos por todas as histórias.

**CRÍTICO**: Nenhuma história começa antes desta fase terminar. O runtime não pode executar DDL; o banco E2E deve nascer vazio pelos scripts SQL.

- [X] T010 Criar `database/init/00-bootstrap.sql` com `ON_ERROR_STOP`, criação do database de teste antes da transação e inclusão explícita, em ordem, dos scripts canônicos em `database/schema/`.
- [X] T011 Criar schemas PostgreSQL, extensão UUID necessária, role owner, role runtime sem `CREATE`/`ALTER`/`DROP` e grants DML-only em `database/schema/001_extensions.sql`, `database/schema/010_schemas.sql` e `database/schema/090_grants.sql`.
- [X] T012 Criar marcador do snapshot SQL suportado pela aplicação em `database/schema/090_schema_manifest.sql`; readiness deve comparar o valor com a revisão esperada.
- [X] T013 Criar assertions SQL para schemas, objetos e grants essenciais em `database/verify/assertions.sql`.
- [X] T014 Criar teste que inicia PostgreSQL E2E vazio via Compose, verifica o marcador e executa `database/verify/assertions.sql` em `test/integration/database-bootstrap.spec.ts`.
- [X] T015 Criar a abstração de conexão, pool único e `TransactionRunner` que empresta o mesmo `PoolClient` entre BEGIN/COMMIT/ROLLBACK em `src/shared/database/postgres-pool.ts` e `src/shared/database/transaction-runner.ts`.
- [X] T016 Criar testes unitários para rollback, liberação do client e propagação de erro transacional em `test/unit/shared/database/transaction-runner.spec.ts`.
- [X] T017 Criar módulo de configuração validada no bootstrap para `DATABASE_URL`, `AUTH_SESSION_TTL` (padrão `PT24H`, mínimo `PT15M`, máximo `P7D`) e chaves externas em `src/shared/config/environment.schema.ts` e `src/shared/config/config.module.ts`.
- [X] T018 Criar testes para configuração padrão, limites inclusivos e rejeição de duração inválida em `test/unit/shared/config/environment.schema.spec.ts`.
- [X] T019 Criar os contratos de aplicação `OtpGenerator`, `OtpDigest`, `EmailSender`, `TokenIssuer`, `TokenVerifier`, `SecurityEventWriter` e `Clock` em `src/shared/application/ports/`.
- [X] T020 Implementar adapters de OTP com `node:crypto`, HMAC-SHA-256 versionado e comparação em tempo constante, e de envelope da outbox com AES-256-GCM e chave distinta em `src/shared/infrastructure/crypto/otp-crypto.adapter.ts` e `src/shared/infrastructure/crypto/outbox-crypto.adapter.ts`.
- [X] T021 Criar testes unitários de seis dígitos sem viés, HMAC vinculado ao desafio e finalidade, comparação segura e cifra autenticada/versionada em `test/unit/shared/crypto/otp-crypto.adapter.spec.ts` e `test/unit/shared/crypto/outbox-crypto.adapter.spec.ts`.
- [X] T022 Configurar logger JSON, correlação por requisição e redaction de headers/campos sensíveis em `src/shared/observability/logger.ts` e `src/main.ts`.
- [X] T023 Criar filtro HTTP para Problem Details, correlação e mapeamento uniforme de erros sem revelar elegibilidade em `src/shared/http/problem-details.filter.ts`.
- [X] T024 Criar validação request/response do OpenAPI 3.1 em CI e geração de tipos de transporte em `scripts/check-openapi.sh` e `src/shared/http/openapi-types.ts`, usando `specs/001-tenant-authentication/contracts/openapi.yaml` como fonte.
- [X] T025 Criar testes ArchUnit-equivalentes por ESLint/import graph para impedir dependências de domínio em NestJS, Fastify, `pg` ou provedores em `test/architecture/module-boundaries.spec.ts`.

**Ponto de verificação**: Bootstrap SQL comprovado em banco vazio; role runtime sem DDL; API e worker compilam; configuração e portas comuns testadas; fronteiras entre módulos verificadas.

---

## Fase 3: História de Usuário 1 - Estabelecer e Verificar o Primeiro Administrador (Prioridade: P1) 🎯 MVP

**Objetivo**: Solicitar cadastro provisório e, após OTP válido, criar atomicamente tenant, conta, vínculo administrador, evento e sessão restrita ao tenant.

**Teste independente**: Iniciar cadastro e confirmar ausência de registros definitivos; buscar OTP no Mailpit; verificar o código e conferir criação atômica e acesso apenas ao tenant criado. Confirmar que corrida por e-mail/slug deixa exatamente um cadastro e nenhum estado parcial.

### Testes da História 1

> Escreva e execute estes testes antes da implementação; confirme a falha esperada.

- [X] T026 [P] [US1] Criar testes de contrato para `POST /v1/tenants/register` e `POST /v1/auth/otp-verifications` em `test/contract/registration.contract.spec.ts`, cobrindo schemas OpenAPI, status, headers e Problem Details.
- [X] T027 [P] [US1] Criar testes E2E do cadastro provisório, verificação válida, OTP inválido e ausência de estado parcial em `test/e2e/registration.e2e-spec.ts`.
- [X] T028 [P] [US1] Criar teste de concorrência com 100 confirmações do mesmo e-mail/slug e uma única criação definitiva em `test/integration/registration-concurrency.spec.ts`.
- [X] T029 [P] [US1] Criar teste de integração que inspeciona entidades após iniciar cadastro e confirma que somente Tentativa, Desafio, Outbox e Evento existem em `test/integration/registration-provisional-state.spec.ts`.

### Implementação da História 1

- [X] T030 [US1] Criar tabelas SQL de Tenant e Conta: nome do tenant “1–160 caracteres”, slug “globalmente única, 3–80 caracteres”, e-mail normalizado “globalmente única”, conta “nasce após verificação” e status conforme `data-model.md` em `database/schema/020_tables.sql` e `database/schema/030_constraints.sql`.
- [X] T031 [US1] Criar tabelas SQL de Tentativa de Cadastro, Desafio OTP, Outbox e Evento de Segurança com status/referências exigidos e `code_digest bytea` de 32 bytes em `database/schema/020_tables.sql` e `database/schema/030_constraints.sql`.
- [X] T032 [US1] Criar tabelas SQL de Vínculo e Sessão: `(tenant_id, user_id)` único, `jti` único e `expires_at > issued_at`; papel `administrator|member`; sessão `active|expired|revoked` em `database/schema/020_tables.sql` e `database/schema/030_constraints.sql`.
- [X] T033 [US1] Criar índices únicos, parciais e de busca necessários para identidade normalizada, slug e desafio `status = 'pending'`, sem predicado temporal baseado em `now()`, em `database/schema/040_indexes.sql`.
- [X] T034 [US1] Atualizar fixture de E2E com usuário runtime DML-only e estado inicial vazio/reproduzível em `database/tests/fixtures/registration.sql`.
- [X] T035 [US1] Implementar entidades/regras de domínio para Tentativa de Cadastro e transições permitidas em `src/modules/authentication/domain/registration-attempt.ts` e `src/modules/authentication/domain/otp-challenge.ts`.
- [X] T036 [US1] Implementar repositórios SQL parametrizados para Tentativa, Tenant, Conta, Vínculo, Desafio, Sessão e Evento em `src/modules/authentication/infrastructure/persistence/registration.repository.ts` e `src/modules/tenancy/infrastructure/persistence/tenant.repository.ts`.
- [X] T037 [US1] Implementar caso de uso de cadastro provisório que normaliza e-mail, aplica validação, cria Tentativa/Desafio/Outbox/Evento na mesma transação e não cria Tenant/Conta/Vínculo em `src/modules/authentication/application/use-cases/start-registration.use-case.ts`.
- [X] T038 [US1] Implementar caso de uso de verificação de cadastro que bloqueia e consome o Desafio, cria Tenant/Conta/Vínculo/Sessão/Evento na mesma transação e emite JWT somente após commit em `src/modules/authentication/application/use-cases/verify-registration-otp.use-case.ts`.
- [X] T039 [US1] Implementar endpoints e DTOs de registro/verificação com validação estrita e mapeamento fiel ao OpenAPI em `src/modules/authentication/infrastructure/http/registration.controller.ts` e `src/modules/authentication/infrastructure/http/dto/`.
- [X] T040 [US1] Implementar emissão e validação JWT RS256 com `kid`, `iss`, `aud`, `sub`, `sid`, `jti`, `tenant_id`, `membership_id`, `role`, `iat` e `exp = expires_at` em `src/modules/authentication/infrastructure/token/jwt-token.adapter.ts`.
- [X] T041 [US1] Implementar worker Nest standalone que reivindica outbox com `FOR UPDATE SKIP LOCKED`, valida desafio pendente, envia fora da transação, aplica retry/backoff e expurga ciphertext terminal em `src/worker.ts` e `src/modules/outbox/infrastructure/outbox-dispatcher.ts`.
- [X] T042 [US1] Implementar adapter Brevo REST e adapter SMTP para Mailpit atrás de `EmailSender`, com idempotency key igual ao ID da outbox e sem logging do payload em `src/modules/notifications/infrastructure/email/brevo-email-sender.ts` e `src/modules/notifications/infrastructure/email/mailpit-email-sender.ts`.
- [X] T043 [US1] Criar teste E2E de entrega via Mailpit, falha transitória, desafio expirado/substituído e expurgo do envelope em `test/e2e/outbox-delivery.e2e-spec.ts`.
- [X] T044 [US1] Implementar guard JWT que busca Sessão, Conta, Tenant e Vínculo ativos no PostgreSQL antes de autorizar, sem confiar apenas nas claims em `src/modules/authentication/infrastructure/http/tenant-session.guard.ts`.
- [X] T045 [US1] Atualizar assertions de schema para todas as tabelas/constraints introduzidas por US1 em `database/verify/assertions.sql`.

**Ponto de verificação**: História 1 executa por HTTP e Mailpit; a confirmação é atômica; corrida cria exatamente um cadastro; nenhum token é emitido em falha.

---

## Fase 4: História de Usuário 2 - Retornar com um OTP por E-mail (Prioridade: P2)

**Objetivo**: Permitir que uma conta existente solicite OTP, receba resposta pública uniforme e crie sessão restrita a vínculo ativo.

**Teste independente**: Solicitar OTP para membro ativo, verificar e acessar o tenant autorizado; repetir com identidade desconhecida/inativa e comprovar resposta equivalente sem entrega utilizável; verificar a duração configurada e sessões simultâneas.

### Testes da História 2

> Escreva e execute estes testes antes da implementação; confirme a falha esperada.

- [X] T046 [P] [US2] Criar testes de contrato para solicitação e verificação de OTP de login, enumeração e sessão em `test/contract/login-otp.contract.spec.ts`.
- [X] T047 [P] [US2] Criar testes E2E para login ativo, resposta equivalente para identidade inelegível, tenant cruzado e conta/tenant/vínculo suspenso em `test/e2e/login-otp.e2e-spec.ts`.
- [X] T048 [P] [US2] Criar testes unitários para configuração `AUTH_SESSION_TTL` padrão `PT24H`, limites inclusivos `PT15M..P7D`, rejeição de valores fora da faixa, `exp` imutável e sessões paralelas em `test/unit/authentication/session-lifetime.spec.ts`.

### Implementação da História 2

- [X] T049 [US2] Implementar caso de uso de solicitação de OTP que resolve tenant/e-mail/vínculo ativos, substitui desafio pendente e grava Desafio/Outbox/Evento na mesma transação em `src/modules/authentication/application/use-cases/request-login-otp.use-case.ts`.
- [X] T050 [US2] Implementar trabalho equivalente para identidades inelegíveis, retornando `202` idêntico sem código utilizável e sem revelar a condição em `src/modules/authentication/application/use-cases/request-login-otp.use-case.ts` e `src/modules/authentication/infrastructure/http/otp-request.controller.ts`.
- [X] T051 [US2] Implementar verificação de OTP de login com lock do desafio, revalidação de Conta/Tenant/Vínculo e criação de sessão sem invalidar sessões anteriores em `src/modules/authentication/application/use-cases/verify-login-otp.use-case.ts`.
- [X] T052 [US2] Implementar `POST /v1/auth/otp-requests` e integrar `POST /v1/auth/otp-verifications` com o contrato em `src/modules/authentication/infrastructure/http/otp-request.controller.ts` e `src/modules/authentication/infrastructure/http/otp-verification.controller.ts`.
- [X] T053 [US2] Criar scripts SQL manuais de alteração incremental para índices/constraints de lookup de login e sessão em `database/releases/001-login-otp/up.sql`, com verificação em `database/releases/001-login-otp/verify.sql` e rollback em `database/releases/001-login-otp/rollback.sql`.
- [X] T054 [US2] Atualizar snapshot canônico para banco novo com as alterações de login em `database/schema/020_tables.sql`, `database/schema/030_constraints.sql`, `database/schema/040_indexes.sql` e `database/schema/090_schema_manifest.sql`.
- [X] T055 [US2] Criar testes de integração para login concorrente do mesmo OTP (um token), sessões simultâneas preservadas e revalidação imediata após suspensão/inativação em `test/integration/login-session-concurrency.spec.ts` e `test/integration/tenant-session-authorization.spec.ts`.
- [X] T056 [US2] Atualizar assertions de schema para tabelas/índices de login e sessão em `database/verify/assertions.sql`.

**Ponto de verificação**: História 2 funciona sem depender de cadastro no mesmo caso de teste (seed SQL de membro ativo); identidades inelegíveis não recebem OTP utilizável; sessões anteriores permanecem válidas até suas próprias expirações.

---

## Fase 5: História de Usuário 3 - Reemitir com Segurança (Prioridade: P3)

**Objetivo**: Controlar reenvios, falhas cumulativas e abuso por e-mail/IP sem reiniciar limites entre desafios.

**Teste independente**: Solicitar antes e depois de 60 segundos, provar que somente o OTP recente funciona, atingir cada limite por identidade/IP e verificar `429`/`Retry-After` sem entrega adicional.

### Testes da História 3

> Escreva e execute estes testes antes da implementação; confirme a falha esperada.

- [X] T057 [P] [US3] Criar testes unitários para contagem de falhas por desafio e política de janela móvel em `test/unit/authentication/otp-throttle-policy.spec.ts`.
- [X] T058 [P] [US3] Criar testes E2E para intervalo de reenvio de 60 segundos, limites 5/e-mail e 20/IP por 15 minutos, limites 10/e-mail e 50/IP por hora e `Retry-After` em `test/e2e/otp-throttling.e2e-spec.ts`.
- [X] T059 [P] [US3] Criar teste de integração concorrente nas fronteiras das janelas móveis para provar ausência de burst e reinício de contador em `test/integration/otp-throttle-concurrency.spec.ts`.

### Implementação da História 3

- [X] T060 [US3] Criar tabelas SQL `identity.throttle_subjects` e `identity.throttle_events`, com digest HMAC `bytea` de 32 bytes e unicidade `(scope_type, scope_digest)` em `database/schema/020_tables.sql` e `database/schema/030_constraints.sql`.
- [X] T061 [US3] Criar índices SQL para consultas por `(subject_id, action, occurred_at)` e expurgo das janelas em `database/schema/040_indexes.sql`.
- [X] T062 [US3] Implementar repositório de limitação com lock dos sujeitos em ordem determinística, contagem de janela móvel e gravação atômica dos eventos em `src/modules/authentication/infrastructure/persistence/throttle.repository.ts`.
- [X] T063 [US3] Integrar limites de cadastro/solicitação por e-mail e IP e de falha de verificação entre desafios em `src/modules/authentication/application/services/otp-throttle.service.ts` e `src/modules/authentication/application/use-cases/`.
- [X] T064 [US3] Implementar respostas `429` uniformes com `Retry-After` sem identificar qual escopo foi limitado em `src/shared/http/problem-details.filter.ts` e `src/modules/authentication/infrastructure/http/otp-request.controller.ts`.
- [X] T065 [US3] Implementar rotina de expurgo de eventos de limitação anteriores à maior janela mais margem, sem DDL e sem remover eventos ainda contados, em `src/modules/authentication/infrastructure/persistence/throttle-retention.job.ts`.
- [X] T066 [US3] Atualizar seed E2E para identidade conhecida, desconhecida e origens controláveis por teste em `database/seeds/e2e.sql`.
- [X] T067 [US3] Atualizar assertions do snapshot SQL e versão esperada para rate limiting em `database/verify/assertions.sql` e `database/schema/090_schema_manifest.sql`.

**Ponto de verificação**: Reenvio e limites resistem a concorrência e reemissão; resposta não revela escopo limitado; nenhum novo e-mail é criado quando o limite é excedido.

---

## Fase Final: Refinamento e Aspectos Transversais

- [X] T068 [P] Adicionar revisão automatizada de grants para provar que o usuário runtime não executa DDL em `database/verify/assertions.sql` e `test/integration/database-privileges.spec.ts`.
- [X] T069 [P] Adicionar comparação CI de `pg_dump --schema-only` normalizado com o snapshot esperado em `scripts/check-schema-drift.sh` e `.github/workflows/ci.yml`.
- [X] T070 Adicionar scripts SQL manuais de release com `up.sql`, `verify.sql` e `rollback.sql` ao checklist de revisão de alterações estruturais em `CONTRIBUTING.md`.
- [X] T071 [P] Adicionar métricas de baixa cardinalidade para decisões OTP, limitação, idade/retry/falha terminal da outbox e latência de entrega em `src/shared/observability/metrics.ts`.
- [X] T072 [P] Adicionar testes de redação para logs, eventos e traces confirmando ausência de OTP, JWT, e-mail/IP bruto e envelope decriptado em `test/integration/security-redaction.spec.ts`.
- [X] T073 Executar todos os comandos e cenários de `specs/001-tenant-authentication/quickstart.md` e corrigir diferenças entre documentação e comportamento em `specs/001-tenant-authentication/quickstart.md`.
- [X] T074 Atualizar registro canônico do schema no bootstrap e a documentação de deploy para garantir que `psql` rode antes de API/worker e falhe sem revisão compatível em `database/schema/090_schema_manifest.sql` e `docs/deployment.md`.

## Dependências e Ordem

- Preparação não depende de outras fases.
- Fundação depende da Preparação e bloqueia todas as histórias. O bootstrap PostgreSQL e as assertions SQL devem existir antes dos testes E2E.
- US1 depende da Fundação e estabelece o modelo de Tenant, Conta, Vínculo, Desafio, Sessão e Outbox.
- US2 depende da Fundação e dos contratos/entidades de sessão e desafio criados em US1; a solicitação/verificação de login pode ser validada com seed independente.
- US3 depende da persistência de desafio e dos fluxos de solicitação/verificação de US1/US2 para integrar os limites cumulativos.
- Refinamento depende das histórias que farão parte da entrega.

### Grafo de dependências

```text
Preparação
    └── Fundação
         ├── US1 (P1 - MVP)
         │    └── US2 (P2)
         │          └── US3 (P3)
         └────────────── Refinamento
```

US2 e US3 compartilham arquivos de aplicação e SQL com histórias anteriores; portanto, podem paralelizar apenas testes e tarefas em arquivos exclusivos. Não paralelize edições simultâneas dos mesmos arquivos SQL/serviço.

### Oportunidades de paralelismo

- Preparação: T003, T007 e T008 podem avançar em paralelo depois de T001/T002; T006 também é independente após existir o manifesto do package.
- Fundação: T013, T016, T018, T020/T021, T022/T023 e T024 podem ser feitos em paralelo quando suas tarefas de base estiverem prontas; T014 depende de T008/T010/T013.
- US1: T026–T029 são testes em arquivos diferentes e podem ser escritos em paralelo; T035, T040 e T042 são implementações em arquivos distintos após os contratos/ports.
- US2: T046–T048 podem avançar em paralelo; T049 e testes de duração T048 não compartilham implementação.
- US3: T057–T059 são testes independentes e podem avançar em paralelo antes de T060–T065.
- Refinamento: T068, T069, T071 e T072 podem ser distribuídas por arquivos independentes após o schema e as histórias estabilizarem.

## Estratégia de Implementação

### MVP primeiro

1. Concluir Preparação e Fundação, incluindo criação de PostgreSQL vazio por scripts SQL no Compose E2E.
2. Concluir US1: cadastro provisório, e-mail via outbox, confirmação atômica e sessão tenant-scoped.
3. Validar os critérios independentes de US1 e os cenários de concorrência antes de avançar.
4. Entregar US2 e depois US3 em incrementos separados.

### Entrega incremental

Cada história começa pelos testes falhando, preserva contratos e constraints, e termina com seus testes unitários, de integração e E2E. O snapshot SQL canônico é atualizado no mesmo incremento que os scripts de release manuais. A aplicação runtime nunca executa alterações de schema.

## Observações

- `[P]` indica arquivos diferentes e ausência de dependência em tarefa incompleta.
- Todo SQL de schema é manual e versionado; ORM migrations, migration runners, schema sync e DDL no startup são proibidos.
- O script E2E deve encerrar o Compose com volume efêmero mesmo quando testes falharem.
- O formato checklist das tarefas é `- [ ] T### [P?] [US#?] Descrição com caminhos de arquivo`.
