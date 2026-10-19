# Tarefas: Agendamento de Serviços

**Entrada**: Documentos em `/specs/002-appointment-scheduling/`

**Pré-requisitos**: `plan.md` e `spec.md`; também foram usados `research.md`, `data-model.md`, `contracts/openapi.yaml`, `quickstart.md` e `.specify/memory/constitution.md`.

**Testes**: Obrigatórios pela constituição do projeto: TDD para regras de domínio, PostgreSQL real para persistência, autorização, isolamento e concorrência, e testes HTTP/contratuais para capacidades públicas e administrativas.

**Organização**: As tarefas estão agrupadas por história, na ordem P1 → P2. Os testes de cada incremento devem passar independentemente com dados fixture quando dependerem de configuração feita por outra história.

## Formato: `[ID] [P?] [História] Descrição`

- **[P]**: Pode executar em paralelo, em arquivos diferentes e sem dependências de tarefas incompletas.
- **[História]**: História atendida pela tarefa: US1, US2 ou US3.
- Toda descrição aponta os caminhos concretos a alterar ou criar.

## Fase 1: Preparação

**Objetivo**: Preparar a resolução por aliases de módulos, a integração do módulo e a validação dos contratos da feature.

- [ ] T001 Configurar aliases de módulos (incluindo `@scheduling` e `@audit`) e sua resolução em execução compilada e nos testes em `tsconfig.json`, `package.json`, `vitest.config.ts`, `vitest.integration.config.ts` e `vitest.contract.config.ts`; criar `test/architecture/module-aliases.spec.ts` para impedir imports relativos profundos entre módulos e confirmar que imports internos do módulo continuam relativos.
- [ ] T002 Criar os diretórios `src/modules/scheduling/domain/`, `src/modules/scheduling/application/ports/`, `src/modules/scheduling/application/services/`, `src/modules/scheduling/application/use-cases/`, `src/modules/scheduling/infrastructure/http/` e `src/modules/scheduling/infrastructure/persistence/`; registrar `SchedulingModule` em `src/modules/scheduling/scheduling.module.ts` e `src/app.module.ts`.
- [ ] T003 Estender `package.json` e `scripts/check-openapi.sh` para validar os contratos de autenticação e agendamento sem substituir `src/shared/http/openapi-types.ts`; gerar os tipos de agendamento em `src/modules/scheduling/infrastructure/http/openapi-types.ts` a partir de `specs/002-appointment-scheduling/contracts/openapi.yaml`.

---

## Fase 2: Fundação

**Objetivo**: Criar a base SQL versionada, o escopo multi-tenant e os recursos compartilhados que bloqueiam todas as histórias.

**CRÍTICO**: Nenhuma história começa antes desta fase terminar.

- [ ] T004 [P] Instalar `btree_gist` em `database/schema/001_extensions.sql`, criar o schema `scheduling` e configurar seu proprietário em `database/schema/010_schemas.sql`.
- [ ] T005 [P] Acrescentar `time_zone text NOT NULL DEFAULT 'America/Sao_Paulo'` à tabela de tenant em `database/schema/020_tables.sql` e validar nomes de zona IANA na camada de entrada; alterações de fuso não devem recalcular instantes UTC existentes.
- [ ] T006 Definir em `database/schema/020_tables.sql` as tabelas `services`, `professionals`, `professional_services`, `weekly_work_periods` e `availability_exceptions` conforme `data-model.md`; aplicar literalmente as regras: name “Obrigatório, 1–120 caracteres após trim”; description “Opcional, texto simples limitado”; duration_minutes “Inteiro positivo, máximo de 480 minutos”; price_minor “Inteiro não negativo em unidade monetária menor”; currency_code “ISO 4217; padrão inicial BRL”; status “`active` ou `inactive`”; display_name “Obrigatório, 1–120 caracteres após trim”; created_at/updated_at “Instantes UTC”; unicidade `(tenant_id, professional_id, service_id)` e FKs compostas por tenant; “iso_weekday (1–7)”; “Exigir início menor que fim”; cruzar meia-noite com duas jornadas/dias; pausas recorrentes com períodos separados; “valid_until opcional”; kinds `break`, `time_off`, `holiday`, `blocked`; “Validar `ends_at > starts_at`, vínculo do profissional ao tenant e acesso do ator”; “reason opcional”; `created_by_membership_id` e `tenant_id` obrigatórios.
- [ ] T007 Definir em `database/schema/020_tables.sql` as tabelas `appointments`, `appointment_idempotency` e `appointment_events` conforme `data-model.md`; aplicar literalmente: intervalo com instantes UTC, “`ends_at > starts_at`” e `[starts_at, ends_at)`; status `confirmed`, `cancelled`, `attended`, `no_show`; guest_name “Obrigatório, 1–160 caracteres após trim”; guest_phone “Obrigatório, formato E.164 após normalização”; guest_email “Obrigatório, normalizado para comparação e validação de formato”; snapshots de nome/duração/preço/moeda; unicidade de idempotência `(tenant_id, key_hash)`, validade de 24 horas, mesmo hash retorna reserva original e corpo diferente resulta em conflito; event_type `created`, `rescheduled`, `cancelled`, `attended`, `no_show`; ator nulo somente na criação pública; eventos append-only sem nome, telefone ou e-mail; timestamps “Instantes UTC”.
- [ ] T008 Criar em `database/schema/030_constraints.sql` FKs compostas e unicidades por `(tenant_id, id)` e `(tenant_id, professional_id, service_id)`, validar que serviço e profissional pertencem ao mesmo tenant, e aplicar constraint GiST de exclusão ao intervalo semiaberto `[starts_at, ends_at)` para impedir sobreposição do mesmo profissional enquanto o estado for `confirmed`.
- [ ] T009 Criar em `database/schema/040_indexes.sql` índices para consultas por tenant, profissional, data e estado, unicidade `(tenant_id, key_hash)` para idempotência e índices necessários aos filtros da agenda.
- [ ] T010 Configurar privilégios mínimos de DML para `barber_runtime` em `database/schema/090_grants.sql`; atualizar as verificações de schema e privilégios em `database/verify/assertions.sql` e `test/integration/database-privileges.spec.ts`.
- [ ] T011 Atualizar `database/init/00-bootstrap.sql`, `database/schema/090_schema_manifest.sql`, `database/schema/schema.sha256`, `database/releases/002-appointment-scheduling/up.sql`, `database/releases/002-appointment-scheduling/verify.sql` e `database/releases/002-appointment-scheduling/rollback.sql` para aplicar e reverter a revisão `002-appointment-scheduling-v1` sem DDL no startup.
- [ ] T012 [P] Atualizar `database/seeds/e2e.sql`, `test/integration/database-bootstrap.spec.ts` e `test/e2e/support.ts` com um tenant, administrador, serviço, profissional, jornada e fixtures de agendamento para testes reproduzíveis.
- [ ] T013 [P] Criar em `src/modules/scheduling/application/ports/scheduling-repository.ts` e `src/modules/scheduling/application/ports/scheduling-transaction.ts` as portas de persistência e transação sem dependência de NestJS ou `pg`.

**Ponto de verificação**: Bootstrap e release criam a revisão esperada; runtime tem somente os privilégios necessários; o módulo resolve aliases; histórias podem ser implementadas.

---

## Fase 3: História de Usuário 1 - Encontrar e Reservar um Horário (Prioridade: P1) 🎯 MVP

**Objetivo**: Permitir ao cliente consultar serviço e disponibilidade de uma barbearia e confirmar como convidado uma reserva livre, sem conflito mesmo sob concorrência.

**Teste independente**: Com fixtures SQL de serviço, profissional, jornada e exceções, consultar dia disponível e indisponível, reservar com nome/telefone/e-mail, confirmar que o horário deixa de aparecer e provar que duas reservas concorrentes para o mesmo intervalo produzem exatamente uma confirmação.

### Testes da História 1

> Escrever os testes antes da implementação e confirmar que falham pelos motivos esperados.

- [ ] T014 [P] [US1] Criar testes unitários em `test/unit/scheduling/availability.spec.ts` cobrindo início/fim semiaberto, serviço que cabe integralmente na jornada, pausas/exceções, intervalos ocupados, incremento de 15 minutos e limite de 30 dias corridos no fuso do tenant.
- [ ] T015 [P] [US1] Criar testes de contrato em `test/contract/scheduling-public.contract.spec.ts` para listar serviços ativos, consultar horários e criar reserva, validando schemas, `Idempotency-Key`, códigos HTTP e ausência de dados de terceiros conforme `specs/002-appointment-scheduling/contracts/openapi.yaml`.
- [ ] T016 [P] [US1] Criar teste de integração PostgreSQL em `test/integration/scheduling-booking-concurrency.spec.ts` que dispare até 100 inserções concorrentes para o mesmo profissional e intervalo, confirme somente uma reserva e aceite intervalos adjacentes sem conflito.
- [ ] T017 [P] [US1] Criar testes E2E em `test/e2e/appointments.e2e-spec.ts` para consulta pública, validação dos três dados obrigatórios do convidado, sucesso, conflito recuperável e remoção do horário reservado da disponibilidade.

### Implementação da História 1

- [ ] T018 [US1] Implementar em `src/modules/scheduling/domain/availability.ts` o cálculo de inícios candidatos em passos de 15 minutos sobre períodos locais convertidos por fuso IANA para instantes UTC; excluir intervalos que excedam a jornada, atravessem pausas/exceções ou conflitem com reservas; aceitar somente hoje até hoje + 30 dias corridos no fuso da barbearia.
- [ ] T019 [US1] Implementar em `src/modules/scheduling/domain/appointment.ts` o agregado e validações de intervalo `[starts_at, ends_at)`, exigindo `ends_at > starts_at`, estado inicial `confirmed` e snapshot do nome, duração, preço e moeda do serviço.
- [ ] T020 [P] [US1] Implementar a consulta de serviços publicados por slug e tenant em `src/modules/scheduling/infrastructure/persistence/public-catalog.repository.ts`, retornando apenas serviços `active` e profissionais ativos habilitados para o serviço.
- [ ] T021 [P] [US1] Implementar em `src/modules/scheduling/infrastructure/persistence/availability.repository.ts` carregamento tenant-scoped de jornadas, exceções e intervalos confirmados; nenhuma consulta pode confiar em `tenant_id` fornecido pelo cliente sem resolver o slug público.
- [ ] T022 [US1] Implementar os casos de uso de listagem de serviços e consulta de disponibilidade em `src/modules/scheduling/application/use-cases/list-public-services.use-case.ts` e `src/modules/scheduling/application/use-cases/get-public-availability.use-case.ts`; para “qualquer profissional”, escolher entre os elegíveis pelo menor total de minutos confirmados naquele dia local e desempatar por UUID; escolha explícita prevalece.
- [ ] T023 [US1] Criar em `src/modules/scheduling/infrastructure/http/public-catalog.controller.ts` as rotas `GET /public/tenants/{tenant_slug}/services` e `GET /public/tenants/{tenant_slug}/availability`, retornando data/hora local, duração, serviço e profissional ou profissionais elegíveis conforme o contrato OpenAPI.
- [ ] T024 [US1] Implementar a persistência transacional da reserva em `src/modules/scheduling/infrastructure/persistence/appointment.repository.ts`, revalidando tenant, serviço, profissional, jornada, exceções e disponibilidade antes de inserir agendamento e evento `created` na mesma transação.
- [ ] T025 [US1] Implementar em `src/modules/scheduling/application/use-cases/create-guest-appointment.use-case.ts` validação de guest_name “Obrigatório, 1–160 caracteres após trim”, guest_phone “Obrigatório, formato E.164 após normalização” e guest_email “Obrigatório, normalizado para comparação e validação de formato”; nunca criar conta de cliente.
- [ ] T026 [US1] Implementar em `src/modules/scheduling/infrastructure/persistence/appointment-idempotency.repository.ts` armazenamento tenant-scoped de `key_hash`, `request_hash`, resultado e validade de 24 horas; a mesma chave e o mesmo hash retornam a reserva original, enquanto a mesma chave com corpo diferente retorna conflito; remover expirados transacionalmente antes de novas operações.
- [ ] T027 [US1] Criar em `src/modules/scheduling/infrastructure/http/public-appointments.controller.ts` a rota `POST /public/tenants/{tenant_slug}/appointments`, exigindo `Idempotency-Key` e devolvendo somente dados da reserva criada, sem expor dados de outros clientes ou agendamentos.
- [ ] T028 [US1] Mapear a violação da constraint GiST para resposta HTTP 409 recuperável em `src/modules/scheduling/infrastructure/http/scheduling-exception.filter.ts`, sem nome, telefone, e-mail, SQL ou conteúdo de outro agendamento na resposta.
- [ ] T029 [US1] Aplicar rate limit às consultas e reservas públicas em `src/modules/scheduling/infrastructure/http/public-booking-rate-limit.guard.ts`, reutilizando controles existentes ou limitando por IP sem persistir IP bruto; garantir que logs e telemetria omitam nome, telefone, e-mail e chave original em `src/modules/scheduling/infrastructure/http/public-appointments.controller.ts`.

**Ponto de verificação**: A História 1 pode ser demonstrada com fixtures, confirma somente reservas válidas e mantém uma única confirmação sob disputa concorrente.

---

## Fase 4: História de Usuário 2 - Configurar Serviços e Disponibilidade (Prioridade: P1)

**Objetivo**: Permitir ao responsável autenticado configurar serviços, profissionais habilitados, fuso, jornadas semanais e exceções para que a busca pública reflita a agenda real.

**Teste independente**: Criar dois profissionais com jornadas e serviços diferentes, registrar pausa e folga, e verificar que as opções públicas mudam conforme configuração, duração e fuso; nenhuma alteração pode modificar compromissos confirmados silenciosamente.

- [ ] T030 [P] [US2] Criar testes unitários em `test/unit/scheduling/work-periods.spec.ts` para `iso_weekday` entre 1 e 7, início menor que fim, jornada atravessando meia-noite representada por dois dias e pausas recorrentes representadas por períodos separados.
- [ ] T031 [P] [US2] Criar testes de contrato em `test/contract/scheduling-management.contract.spec.ts` para rotas protegidas de fuso, serviços, profissionais, jornadas e exceções; confirmar que os schemas respeitam `specs/002-appointment-scheduling/contracts/openapi.yaml`.
- [ ] T032 [P] [US2] Criar testes de integração em `test/integration/scheduling-configuration-authorization.spec.ts` que rejeitem membro sem papel administrativo, sessão ausente e tenant divergente em toda rota de gestão.
- [ ] T033 [P] [US2] Criar testes E2E em `test/e2e/scheduling-configuration.e2e-spec.ts` cobrindo dois profissionais, serviços com durações distintas, pausa, folga, feriado, timezone configurável e atualização visível na disponibilidade pública.
- [ ] T034 [US2] Criar schema de entrada e autorização administrativa em `src/modules/scheduling/infrastructure/http/administrator.guard.ts` e `src/modules/scheduling/infrastructure/http/dto/scheduling.schemas.ts`; rejeitar acesso sem sessão administrativa tenant-scoped e validar nomes IANA reconhecidos pelo runtime.
- [ ] T035 [P] [US2] Implementar CRUD de serviços em `src/modules/scheduling/application/use-cases/manage-services.use-cases.ts` e `src/modules/scheduling/infrastructure/persistence/service.repository.ts`, aplicando literalmente: “Obrigatório, 1–120 caracteres após trim”; “Opcional, texto simples limitado”; “Inteiro positivo, máximo de 480 minutos”; “Inteiro não negativo em unidade monetária menor”; “ISO 4217; padrão inicial BRL”; “`active` ou `inactive`”.
- [ ] T036 [P] [US2] Implementar CRUD de profissionais e elegibilidade serviço-profissional em `src/modules/scheduling/application/use-cases/manage-professionals.use-cases.ts` e `src/modules/scheduling/infrastructure/persistence/professional.repository.ts`, aplicando literalmente: “Obrigatório, 1–120 caracteres após trim”; “`active` ou `inactive`”; FKs compostas por tenant e unicidade `(tenant_id, professional_id, service_id)`.
- [ ] T037 [P] [US2] Implementar leitura e substituição transacional de jornadas semanais em `src/modules/scheduling/application/use-cases/manage-weekly-work-periods.use-cases.ts` e `src/modules/scheduling/infrastructure/persistence/work-period.repository.ts`, aplicando literalmente: “1–7”; “Exigir início menor que fim”; cruzar meia-noite com duas jornadas/dias; pausas recorrentes separadas em períodos antes e depois da pausa; `valid_until` opcional.
- [ ] T038 [P] [US2] Implementar CRUD de exceções em `src/modules/scheduling/application/use-cases/manage-availability-exceptions.use-cases.ts` e `src/modules/scheduling/infrastructure/persistence/availability-exception.repository.ts`, aplicando literalmente `kind` em `break`, `time_off`, `holiday` ou `blocked`, “Validar `ends_at > starts_at`, vínculo do profissional ao tenant e acesso do ator”, `reason` opcional; exceções removem disponibilidade, mas não criam jornada.
- [ ] T039 [P] [US2] Implementar consulta e atualização do fuso da barbearia em `src/modules/scheduling/application/use-cases/manage-tenant-time-zone.use-cases.ts` e `src/modules/scheduling/infrastructure/persistence/tenant-scheduling.repository.ts`, preservando instantes UTC existentes e aplicando o novo fuso somente às jornadas locais futuras.
- [ ] T040 [US2] Criar em `src/modules/scheduling/infrastructure/http/scheduling-management.controller.ts` as rotas de gestão protegidas de serviços, profissionais, jornadas, exceções e fuso descritas no contrato, sempre derivando o tenant da sessão no servidor.
- [ ] T041 [US2] Cobrir alterações que afetam compromissos existentes em `test/integration/scheduling-configuration-conflicts.spec.ts`, confirmando que a configuração retorna os conflitos antes de aplicar e que nenhum agendamento confirmado muda sem ação explícita do responsável.
- [ ] T042 [US2] Detectar compromissos futuros afetados por mudanças de serviço, profissional ou jornada em `src/modules/scheduling/application/use-cases/manage-services.use-cases.ts`, `src/modules/scheduling/application/use-cases/manage-professionals.use-cases.ts` e `src/modules/scheduling/application/use-cases/manage-weekly-work-periods.use-cases.ts`; responder com os conflitos antes da aplicação e nunca alterar/cancelar compromissos confirmados silenciosamente.

**Ponto de verificação**: O responsável consegue configurar catálogo, equipe e disponibilidade; as consultas públicas refletem cada configuração e conflitos futuros são explicitados sem alterações silenciosas.

---

## Fase 5: História de Usuário 3 - Acompanhar e Alterar Agendamentos (Prioridade: P2)

**Objetivo**: Permitir ao responsável autorizado consultar a agenda, cancelar ou reagendar compromissos e registrar atendimento ou não comparecimento com histórico auditável.

**Teste independente**: Criar e listar um agendamento tenant-scoped, cancelá-lo e confirmar que o intervalo volta a ficar disponível; reagendá-lo atomicamente; registrar `attended` ou `no_show` e confirmar que o histórico permanece consultável.

- [ ] T043 [P] [US3] Criar testes unitários em `test/unit/scheduling/appointment-transitions.spec.ts` para transições permitidas `confirmed → cancelled|attended|no_show`, impedir transições finais duplicadas e validar que apenas cancelamento libera disponibilidade futura.
- [ ] T044 [P] [US3] Criar testes de contrato em `test/contract/scheduling-appointments-management.contract.spec.ts` para listagem por período/profissional/estado, cancelamento, reagendamento e atualização de resultado conforme OpenAPI.
- [ ] T045 [P] [US3] Criar testes de integração PostgreSQL em `test/integration/scheduling-appointment-lifecycle.spec.ts` para isolamento entre tenants, concorrência entre cancelamento e nova reserva, reagendamento atômico e gravação append-only dos eventos.
- [ ] T046 [P] [US3] Criar testes E2E em `test/e2e/scheduling-appointment-management.e2e-spec.ts` para consulta da agenda, cancelamento, reagendamento, `attended`, `no_show` e liberação do intervalo após commit.
- [ ] T047 [P] [US3] Implementar consulta paginada por tenant, período, profissional e estado em `src/modules/scheduling/application/use-cases/list-appointments.use-case.ts` e `src/modules/scheduling/infrastructure/persistence/appointment-query.repository.ts`; incluir bloqueios correspondentes e nunca retornar dados de outro tenant.
- [ ] T048 [US3] Implementar o endpoint de agenda em `src/modules/scheduling/infrastructure/http/appointment-management.controller.ts`, exigindo papel administrativo e aceitando os filtros documentados no contrato OpenAPI.
- [ ] T049 [P] [US3] Implementar gravação append-only de `created`, `rescheduled`, `cancelled`, `attended` e `no_show` em `src/modules/scheduling/infrastructure/persistence/appointment-event.repository.ts`; registrar `actor_membership_id` nulo somente na criação pública e nunca duplicar nome, telefone ou e-mail nos eventos.
- [ ] T050 [US3] Implementar cancelamento transacional em `src/modules/scheduling/application/use-cases/cancel-appointment.use-case.ts` e `src/modules/scheduling/infrastructure/persistence/appointment-lifecycle.repository.ts`, alterando estado e gravando evento `cancelled` com ator, instante, tenant e correlação; liberar o intervalo somente após commit.
- [ ] T051 [US3] Implementar reagendamento atômico em `src/modules/scheduling/application/use-cases/reschedule-appointment.use-case.ts` e `src/modules/scheduling/infrastructure/persistence/appointment-lifecycle.repository.ts`, revalidando jornada, exceções e conflito no novo intervalo, preservando o intervalo antigo em caso de falha e registrando valores anteriores/novos no evento `rescheduled`.
- [ ] T052 [US3] Implementar atualização de resultado em `src/modules/scheduling/application/use-cases/record-appointment-outcome.use-case.ts` e `src/modules/scheduling/infrastructure/persistence/appointment-lifecycle.repository.ts`, permitindo somente `attended` ou `no_show` a partir de estado válido e mantendo estados finais consultáveis no histórico.
- [ ] T053 [US3] Criar as rotas de listagem, cancelamento, reagendamento e resultado em `src/modules/scheduling/infrastructure/http/appointment-management.controller.ts`; filtrar tenant pela sessão e omitir PII dos eventos, logs e erros.

**Ponto de verificação**: Agenda e ciclo de vida são consultáveis e auditáveis, com isolamento, atomicidade e regras de disponibilidade preservadas.

---

## Fase Final: Refinamento e Aspectos Transversais

- [ ] T054 [P] Atualizar `specs/002-appointment-scheduling/quickstart.md` com comandos e cenários efetivamente implementados, incluindo geração/verificação dos tipos OpenAPI próprios de scheduling e release SQL.
- [ ] T055 [P] Ampliar `test/integration/security-redaction.spec.ts` para garantir que nome, telefone, e-mail, chave de idempotência original e dados de outros tenants não apareçam em logs, telemetria ou respostas de erro.
- [ ] T056 Revisar `src/modules/scheduling/` e `test/architecture/module-boundaries.spec.ts` para confirmar separação domínio/aplicação/infraestrutura, uso de aliases de módulos como `@audit` em imports entre módulos e ausência de ORM/DDL no startup.
- [ ] T057 Executar `yarn lint`, `yarn typecheck`, `yarn test:unit`, `yarn test:integration`, `yarn test:contract`, `yarn contract:check`, `yarn schema:check`, `yarn test:e2e` e `yarn ci:check`; corrigir falhas sem atualizar silenciosamente contratos, dados ou revisões de schema.
- [ ] T058 Executar os passos de `specs/002-appointment-scheduling/quickstart.md` contra PostgreSQL descartável e release local; confirmar `database/releases/002-appointment-scheduling/verify.sql` e rollback em banco de teste antes da entrega.

## Dependências e Ordem

- Preparação (T001–T003) precede Fundação.
- Fundação (T004–T013) bloqueia todas as histórias.
- US1 (T014–T029) é o incremento MVP de reserva pública e pode ser testado com fixtures antes das rotas de configuração.
- US2 (T030–T042) depende do schema e usa o fluxo público da US1 para comprovar os efeitos de configuração.
- US3 (T043–T053) depende da criação de agendamentos da US1 e da autorização administrativa estabelecida na US2.
- Refinamento (T054–T058) depende das histórias que a entrega incluir.

```text
Preparação → Fundação → US1 (P1) → US2 (P1) → US3 (P2) → Refinamento
```

### Oportunidades de execução paralela

- Preparação: T001, T002 e T003 são sequenciais porque alteram resolução, integração do módulo e geração de contratos que precisam ser validadas em conjunto.
- Fundação: T004 e T005 podem avançar em paralelo; T006 e T007 alteram `020_tables.sql` em sequência; T008–T011 seguem os objetos definidos; T012 depende do schema pronto; T013 pode avançar em paralelo com SQL, pois altera somente portas de aplicação.
- US1: T014–T017 são testes em arquivos separados; T020 e T021 podem ser desenvolvidas em paralelo após T013; T022 depende de T018, T020 e T021; T023 e T027 dependem dos casos de uso respectivos.
- US2: T030–T033 são testes em arquivos separados; T035–T039 podem avançar em paralelo depois de T034 e T013, mantendo repositórios e casos de uso em arquivos distintos; T040 liga os casos de uso prontos; T041 deve passar antes de T042 implementar a detecção de conflitos.
- US3: T043–T046 são testes em arquivos separados; T047 e T049 podem ser desenvolvidas em paralelo em arquivos distintos após US1/US2; T050–T052 compartilham `appointment-lifecycle.repository.ts` e devem ser integradas sem edição concorrente; T048 e T053 integram os casos de uso prontos.
- Refinamento: T054 e T055 podem ser paralelizadas; T056–T058 exigem que as implementações estejam integradas.

## Estratégia de Implementação

### MVP primeiro

1. Concluir Preparação e Fundação.
2. Implementar US1 para catálogo de leitura, consulta de disponibilidade e reserva pública segura, com fixtures de serviços/profissionais/jornadas.
3. Validar isoladamente disponibilidade, idempotência, fuso, janela de 30 dias e concorrência PostgreSQL.
4. Implementar US2 para que o responsável configure a agenda real sem seed manual.
5. Entregar US3 após a gestão básica, mantendo o histórico e as transições auditáveis.

### Entrega incremental

Concluir uma história por vez, executar seus testes independentes e manter as histórias anteriores utilizáveis. O incremento US1 depende de configuração prévia de dados e pode ser demonstrado com fixtures; a gestão operacional completa só é alcançada após US2.

## Critérios independentes por história

- **US1**: Cliente consulta horários válidos, cria reserva com nome/telefone/e-mail válidos; a opção é removida, duplicatas idempotentes retornam o resultado original e até 100 concorrentes não confirmam mais de uma reserva no mesmo intervalo.
- **US2**: Responsável autorizado administra serviços, profissionais, fuso, jornadas e exceções; a disponibilidade muda de acordo; mudanças que atinjam reservas confirmadas mostram conflitos sem alterá-las silenciosamente.
- **US3**: Responsável autorizado filtra agenda da própria barbearia, cancela ou reagenda atomicamente e registra `attended`/`no_show`; estados e eventos permanecem consultáveis e o intervalo só é liberado após commit de cancelamento.
