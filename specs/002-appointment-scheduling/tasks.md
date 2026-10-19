# Tarefas: Agendamento de Serviços

**Entrada**: `specs/002-appointment-scheduling/` — `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/openapi.yaml`, `contracts/configuration-audit.md` e `quickstart.md`.

**Atualização**: 2026-10-19, incorporando o incremento v2 de auditoria administrativa (FR-023/SC-009), sem novo endpoint, e preservando as tarefas e evidências da base v1.

**Testes**: Obrigatórios pelos cenários da especificação e pela constituição (`.specify/memory/constitution.md`). Em cada incremento, escrever os testes, observar falha pertinente, implementar e refatorar. Não marcar tarefa como concluída apenas por criar um teste ainda falhando.

**Organização**: TypeScript/NestJS/Fastify e PostgreSQL existentes; reaproveitar infraestrutura. Os caminhos abaixo são relativos à raiz. Novos endpoints ficam em `/v1`, preservando autenticação existente. T001–T064 estão concluídas; T065 permanece pendente por depender de ensaio com consumidor e participantes, conforme registrado em `quickstart.md`. T066–T089 estão concluídas e validadas em ambiente descartável; comandos e resultados v2 estão registrados em `quickstart.md`. T065 não bloqueia esse incremento técnico. IDs e marcações da base foram preservados; as novas tarefas seguem a ordem de dependências descrita abaixo.

## Formato: `[ID] [P?] [História] Descrição`

`[P]` indica arquivos independentes dentro do lote descrito em Dependências, após cumprir seus pré-requisitos. `[US1]`, `[US2]` e `[US3]` identificam histórias; preparação, fundação e refinamento não recebem rótulo de história.

## Fase 1: Preparação

**Objetivo**: Preparar integração, contratos e execução de testes sem recriar o projeto.

- [X] T001 Preservar a intenção da tarefa anterior de aliases: configurar resolução ESM compilada e de testes com `#scheduling`/`#audit` em `tsconfig.json`, `package.json` e configurações Vitest; verificar imports com `test/architecture/module-aliases.spec.ts`. O prefixo `@` não funciona no mecanismo nativo `package.json#imports` do Node ESM.

- [X] T002 Criar a estrutura domínio/aplicação/infraestrutura e o módulo vazio em `src/modules/scheduling/scheduling.module.ts`; registrar em `src/app.module.ts` sem mover rotas de autenticação para `/v1`.

- [X] T003 Estender geração e verificação dos dois contratos em `package.json` e `scripts/check-openapi.sh`; gerar `src/modules/scheduling/infrastructure/http/openapi-types.ts` sem sobrescrever os tipos de autenticação.

- [X] T004 Incluir a suíte PostgreSQL no fluxo com banco descartável via `scripts/test-e2e.sh`; preservar cleanup, isolamento e suítes E2E existentes, sem depender de banco de produção.

## Fase 2: Fundação

**Objetivo**: Entregar schema, escopo e protocolo transacional comum. **Bloqueia todas as histórias.** Testes de infraestrutura devem falhar antes da implementação correspondente.

- [X] T005 [P] Criar testes de schema, FKs entre tenants, exclusão de intervalos adjacentes/sobrepostos, settings e eventos append-only em `test/integration/scheduling/schema.spec.ts`; ampliar `test/integration/database-privileges.spec.ts` para runtime sem DDL e sem UPDATE/DELETE de eventos.

- [X] T006 [P] Criar testes de lock por tenant, rollback, isolamento entre barbearias, replay concorrente, expiração e chave/corpo divergentes em `test/integration/scheduling/mutation-protocol.spec.ts`; testar autorização antes de replay e ausência de evento duplicado.

- [X] T007 [P] Definir portas tipadas de repositório, unidade transacional, conversão de zona e cifra em `src/modules/scheduling/application/ports/scheduling-repository.ts`, `scheduling-transaction.ts`, `time-zone.ts` e `idempotency-cipher.ts` nesse diretório; reutilizar `src/shared/application/ports/clock.ts` e transação existentes, sem NestJS/pg no domínio.

- [X] T008 Criar extensão `btree_gist` em `database/schema/001_extensions.sql` e schema `scheduling` em `database/schema/010_schemas.sql`; manter propriedade operacional e nenhum DDL no startup.

- [X] T009 Adicionar tenant e tabelas catálogo/jornadas/configuração em `database/schema/020_tables.sql`: IDs “UUID PK”; tenant “UUID FK para `tenancy.tenants`”; timestamps “Instantes UTC”; fuso IANA “`tenancy.tenants.time_zone text NOT NULL DEFAULT 'America/Sao_Paulo'`”; settings “`tenant_id` PK/FK”, “`slot_interval_minutes integer NOT NULL DEFAULT 15 CHECK (> 0)`” e “`minimum_advance_minutes integer NOT NULL DEFAULT 30 CHECK (>= 0)`”; serviço/profissional com nome “Obrigatório, 1–120 caracteres após trim”, descrição “Opcional, texto simples limitado” (máximo 1000 no contrato), duração “Inteiro positivo, máximo de 480 minutos”, preço “Inteiro não negativo em unidade monetária menor”, moeda “ISO 4217; padrão inicial `BRL`”, status “`active` ou `inactive`”; jornada “`iso_weekday` (1–7)” e “Exigir início menor que fim”, horas “`HH:mm:ss` sem offset”; exceção “`kind` (`break`, `time_off`, `holiday` ou `blocked`)”, “`reason` opcional” (máximo 240 no contrato), “Validar `ends_at > starts_at`, vínculo do profissional ao tenant e acesso do ator”, com `created_by_membership_id`.

- [X] T010 Adicionar agendamentos, eventos, idempotência e throttle em `database/schema/020_tables.sql`: agendamento “UUID PK e identificador público da reserva”, “FKs compostas `(tenant_id, id)`”, “Instantes UTC; `ends_at > starts_at`; intervalo lógico `[starts_at, ends_at)`”, estados “`confirmed`, `cancelled`, `attended`, `no_show`”; nome “Obrigatório, 1–160 caracteres após trim”, telefone “Obrigatório, formato E.164 após normalização”, e-mail “Obrigatório, normalizado para comparação e validação de formato” (máximo 254 no contrato); snapshots “Nome apresentado no instante da reserva”, “Duração do serviço no instante da reserva” e “Preço informativo acordado ao reservar”; idempotência com “`actor_scope` (membership UUID ou literal público)”, “`appointment_id` opcional com FK composta”, response_status/headers/ciphertext e “Expiração de 24 horas”; eventos “Registro append-only”, tipos “`created`, `rescheduled`, `cancelled`, `attended`, `no_show`”, “`actor_membership_id` nulo somente para criação pública”, previous_status/new_status, correlation_id, instantes/intervalos anterior e novo; throttle “`operation_group` (`read` ou `booking`)”, window_start/count/expires_at, sem IP bruto.

- [X] T011 Criar em `database/schema/030_constraints.sql` CHECKs das regras de T009/T010, unicidade `(tenant_id, id)` e `(tenant_id, professional_id, service_id)`, FKs compostas incluindo ator e agendamento, proibição de remoção de recursos referenciados e GiST de `[starts_at, ends_at)` para `status = 'confirmed'`; impedir jornadas sobrepostas do mesmo profissional/dia.

- [X] T012 Criar em `database/schema/040_indexes.sql` índices “`(tenant_id, professional_id, starts_at)`”, “`(tenant_id, status, starts_at)`”, “`(tenant_id, professional_id, iso_weekday)`”, evento por tenant/agendamento/instante, expiração e índice único “`(tenant_id, actor_scope, operation, resource_scope, key_hash)`”; throttle com “chave composta nos quatro primeiros campos” tenant_id/ip_hash/operation_group/window_start.

- [X] T013 Atualizar `database/schema/090_grants.sql`, `database/init/00-bootstrap.sql`, `database/schema/090_schema_manifest.sql`, `database/schema/schema.sha256`, `database/verify/assertions.sql` e criar `database/releases/002-appointment-scheduling/up.sql`, `verify.sql`, `rollback.sql`; revisão `002-appointment-scheduling-v1`, settings preenchidos para tenants existentes, grants mínimos (eventos INSERT/SELECT) e reversão operacional em banco isolado; ajustar revisão esperada em `compose.yaml`, `compose.e2e.yaml` e `src/shared/http/health.controller.ts`.

- [X] T014 Criar settings junto ao tenant na mesma transação em `src/modules/authentication/infrastructure/persistence/registration.repository.ts`; atualizar `test/integration/database-bootstrap.spec.ts` e `test/integration/registration-concurrency.spec.ts` para comprovar defaults 15/30, ausência de tenant parcialmente provisionado e compatibilidade do release.

- [X] T015 Criar fixtures de dois tenants, administrador/membro, catálogo, jornada, settings e compromissos em `database/tests/fixtures/scheduling.sql` e `test/e2e/scheduling-support.ts`; usar fixtures independentes das rotas de configuração e relógio substituível, sem dados pessoais reais.

- [X] T016 [P] Criar testes 401/403/escopo e implementar autorização administrativa em `test/unit/scheduling/administrator-guard.spec.ts` e `src/modules/scheduling/infrastructure/http/administrator.guard.ts`; combinar sessão ativa existente com papel `administrator`, derivando tenant/membership no servidor.

- [X] T017 [P] Testar e implementar cifra autenticada de respostas idempotentes em `test/unit/scheduling/idempotency-cipher.spec.ts` e `src/modules/scheduling/infrastructure/crypto/idempotency-cipher.adapter.ts`; configurar chave própria e segredo HMAC do throttle em `src/shared/config/environment.schema.ts`, `test/unit/shared/config/environment.schema.spec.ts` e `.env.example`, seguindo padrão AES-GCM existente sem reutilizar a porta de e-mail; falhar em chaves inválidas, nunca registrar segredos.

- [X] T018 Implementar protocolo em `src/modules/scheduling/infrastructure/persistence/scheduling-transaction.adapter.ts` e `src/modules/scheduling/application/services/scheduling-mutation.service.ts`: uma conexão/transação, lock `SELECT ... FOR UPDATE` em settings antes de leituras, `READ COMMITTED`, depois agendamentos em ordem UUID; revalidar relógio após espera, sem chamadas externas sob lock; rollback integral. Fazer T006 passar.

- [X] T019 Implementar `src/modules/scheduling/infrastructure/persistence/appointment-idempotency.repository.ts` e `src/modules/scheduling/application/services/idempotent-mutation.service.ts`: escopo tenant/ator/operação/recurso/hash da chave, JSON canônico, resposta original criptografada quando contém PII, status/cabeçalhos, commit com mutação/evento; replay antes da revalidação temporal, corpo diferente 409; limpar expirados após 24h sob lock sem apagar operação em andamento. Fazer T006 passar.

- [X] T020 Implementar gravação append-only em `src/modules/scheduling/infrastructure/persistence/appointment-event.repository.ts`: ator nulo somente na criação pública, tenant, instante, correlação, transição e intervalos; nenhuma duplicação de nome/telefone/e-mail; usar transação do chamador, inclusive na criação US1.

- [X] T021 Implementar schemas comuns e tradução de erros em `src/modules/scheduling/infrastructure/http/dto/common.schemas.ts` e `src/modules/scheduling/infrastructure/http/scheduling-exception.filter.ts`; `Idempotency-Key` obrigatório de 16–128 caracteres, 404 fora do escopo, 409 de conflito/transição, 422 inválido, IDs de conflitos somente ao administrador, sem SQL/PII. Registrar providers compartilhados em `src/modules/scheduling/scheduling.module.ts`.

**Ponto de verificação**: Schema/release e protocolo transacional validados; administração e idempotência disponíveis antes das histórias.

## Fase 3: História de Usuário 1 — Encontrar e Reservar um Horário (P1) — MVP

**Objetivo**: Consulta pública e reserva de convidado com integridade concorrente.

**Teste independente**: Usar fixtures, consultar dia com/sem disponibilidade, reservar e verificar remoção do intervalo; 100 concorrentes produzem uma confirmação. Não depende da implementação US2.

### Testes da História 1

- [X] T022 [P] [US1] Criar testes em `test/unit/scheduling/availability.spec.ts` para grade 15/20 ancorada por período, duração integral, bordas adjacentes, pausas, antecedência 30/zero/limiar, janela inclusiva hoje..hoje+30, escolha explícita e desempate por carga/UUID.

- [X] T023 [P] [US1] Criar testes das operações `listPublicServices`, `getPublicAvailability`, `createGuestAppointment` em `test/contract/scheduling-public.contract.spec.ts`: schemas, 201/404/409/422/429, slots vazios, offset local, três contatos obrigatórios, idempotência e ausência de PII de terceiros.

- [X] T024 [P] [US1] Criar testes PostgreSQL em `test/integration/scheduling/booking-concurrency.spec.ts`: 100 chaves distintas disputam um intervalo (1 sucesso/99 conflitos), intervalos adjacentes, replay concorrente, rollback, múltiplos profissionais elegíveis e relógio expirando após lock; isolar throttle nessa fixture.

- [X] T025 [P] [US1] Criar `test/e2e/appointments.e2e-spec.ts` cobrindo os dez cenários US1, consulta após reserva, entrada malformada, tenant inexistente e respostas privadas; usar relógio controlado sem esperas reais.

### Implementação da História 1

- [X] T026 [US1] Implementar agregado em `src/modules/scheduling/domain/appointment.ts`: “`ends_at > starts_at`”, intervalo “[starts_at, ends_at)”, estado inicial `confirmed`, snapshots de nome/duração/preço/moeda, sem aceitar fim/preço/duração fornecidos pelo convidado; exigir contatos com regras de T010.

- [X] T027 [US1] Testar e implementar adapter de zona em `test/unit/scheduling/time-zone.spec.ts` e `src/modules/scheduling/infrastructure/time/iana-time-zone.adapter.ts`: zonas IANA reconhecidas, ignorar horários inexistentes e emitir dois instantes com offsets para horários repetidos; duração em minutos decorridos e janela por data local.

- [X] T028 [US1] Implementar `src/modules/scheduling/domain/availability.ts` e `src/modules/scheduling/domain/booking-policy.ts`: passo `slot_interval_minutes` ancorado em cada período, serviço cabe integralmente sem conflitos, antecedência inclusiva quando positiva e início estritamente futuro quando zero, hoje..hoje+30; estado/serviço/profissional elegíveis.

- [X] T029 [P] [US1] Implementar `src/modules/scheduling/infrastructure/persistence/public-catalog.repository.ts` e `src/modules/scheduling/application/use-cases/list-public-services.use-case.ts`; resolver slug validado, retornar somente serviços/profissionais ativos associados no tenant.

- [X] T030 [P] [US1] Implementar snapshot consistente de consulta em `src/modules/scheduling/infrastructure/persistence/availability.repository.ts` e `src/modules/scheduling/application/use-cases/get-public-availability.use-case.ts`; carregar settings/jornadas/exceções/confirmed sem lock de escrita, retornar todas as opções elegíveis ou slots vazios.

- [X] T031 [US1] Implementar `src/modules/scheduling/infrastructure/persistence/appointment.repository.ts` e `src/modules/scheduling/application/use-cases/create-guest-appointment.use-case.ts`; usar protocolo comum, replay antes de revalidar, ler dados após lock, capturar relógio e revalidar grade/antecedência; escolher menor total de minutos confirmados no dia e desempate UUID quando profissional omitido; persistir reserva/evento/resultado juntos.

- [X] T032 [US1] Testar e implementar `test/integration/scheduling/public-throttle.spec.ts`, `src/modules/scheduling/infrastructure/persistence/public-throttle.repository.ts` e `src/modules/scheduling/infrastructure/http/public-booking-rate-limit.guard.ts`: “120 leituras e 10 reservas” por minuto/tenant/HMAC-IP, incremento atômico independente do lock da agenda, replay conta tentativa, 429/Retry-After; expirar contadores após duas janelas e confiar somente em proxies configurados.

- [X] T033 [US1] Implementar DTOs e controllers em `src/modules/scheduling/infrastructure/http/dto/public.schemas.ts`, `public-catalog.controller.ts` e `public-appointments.controller.ts` nesse diretório, montando três rotas `/v1/public/tenants/{tenant_slug}`; telefone E.164, e-mail até 254, nome 1–160, slug regex do contrato, `additionalProperties: false` onde definido; resposta sem contatos de outros clientes.

- [X] T034 [US1] Registrar providers/rotas públicas em `src/modules/scheduling/scheduling.module.ts` e executar os testes de `test/e2e/appointments.e2e-spec.ts` e `test/integration/scheduling/booking-concurrency.spec.ts`; demonstrar reserva válida e replay, sem dependência das rotas administrativas.

## Fase 4: História de Usuário 2 — Configurar Serviços e Disponibilidade (P1)

**Objetivo**: Gestão de catálogo, profissionais, jornada, bloqueios, fuso e configurações.

**Teste independente**: Configurar dois profissionais/serviços, pausa e folga; verificar opções por jornada e duração, defaults 15/30 e personalização 20/zero; mudança conflitante retorna 409 sem alterar configuração nem compromisso. Usar fixtures de reservas para independência de US3.

### Testes da História 2

- [X] T035 [P] [US2] Criar testes em `test/unit/scheduling/configuration.spec.ts`: todas as regras de T009, jornadas sem sobreposição e cruzando meia-noite divididas por dia, defaults 15/30, rejeição de intervalo zero/antecedência negativa, snapshots preservados e detecção de conflitos.

- [X] T036 [P] [US2] Criar testes em `test/contract/scheduling-configuration.contract.spec.ts` para as 15 operações de settings, fuso, serviços, profissionais, jornadas e exceções; comprovar schemas, 401/403/404/409/422, idempotência nas nove mutações e HasBookings com IDs apenas do tenant.

- [X] T037 [P] [US2] Criar `test/integration/scheduling/configuration-concurrency.spec.ts`: reserva versus bloqueio/jornada/desativação/fuso nos dois ordenamentos, rollback completo da mudança conflitante, tenant distinto sem contenção, replay administrativo e configuração não retroativa; todos escritores obedecem ao mesmo lock.

- [X] T038 [P] [US2] Criar `test/e2e/scheduling-configuration.e2e-spec.ts`: administrador configura dois profissionais, serviços e jornada; parâmetros 20/zero mudam novas opções sem reescrever reservas; conflitos impedem save; tentar novamente com nova chave após fixture resolver os compromissos.

### Implementação da História 2

- [X] T039 [US2] Implementar modelos/validações em `src/modules/scheduling/domain/service.ts`, `professional.ts`, `work-period.ts`, `availability-exception.ts` e `scheduling-settings.ts` nesse diretório, com restrições literais de T009, “Períodos semanais não podem sobrepor-se para o mesmo profissional/dia”, pausas por períodos separados, “A exceção pode sobrepor uma jornada, mas não cria disponibilidade fora dela”; settings valem para toda a barbearia sem alteração retroativa.

- [X] T040 [US2] Implementar `src/modules/scheduling/application/services/configuration-conflict.service.ts` e `src/modules/scheduling/infrastructure/persistence/configuration-conflict.repository.ts`; sob lock comparar mudança proposta a todos confirmed afetados usando snapshots, inclusive fuso/desativação/elegibilidade; retornar IDs e rejeitar tudo sem bypass; nome/preço/duração futura preservam snapshots, intervalo/antecedência não invalidam existentes.

- [X] T041 [US2] Implementar leitura/criação/alteração/desativação e substituição de professional_ids em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`; unicidade “`(tenant_id, professional_id, service_id)`”, FKs compostas, associação ativa e verificação comum de conflitos/idempotência; sem exclusão física.

- [X] T042 [US2] Implementar leitura/criação/alteração/desativação em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`; profissional não é conta, nome 1–120 após trim, status active/inactive, bloquear desativação conflitante.

- [X] T043 [US2] Implementar leitura e substituição completa da jornada semanal em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`; sem valid_from/valid_until, validar limites e sobreposição, transação/idempotência comum e rejeição de conflitos.

- [X] T044 [US2] Implementar consulta por período/criação/remoção em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`; kind/intervalo/ator/reason conforme T009, criação conflitante rejeitada, remoção idempotente e tenant-scoped; não adicionar rota de edição fora do contrato.

- [X] T045 [US2] Implementar GET/PUT de intervalo e antecedência em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`; padrões 15/30 e validações de T009, lock/idempotência comuns, sem alterar duração nem compromissos.

- [X] T046 [US2] Implementar consulta/alteração da zona IANA em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`; interpretar jornadas futuras no novo fuso, preservar instantes UTC e rejeitar conflitos antes do commit.

- [X] T047 [US2] Criar schemas em `src/modules/scheduling/infrastructure/http/dto/management.schemas.ts` e controller `src/modules/scheduling/infrastructure/http/management.controller.ts`; cobrir exatamente as 15 operações US2 sob `/v1/management`, exigir administrator e Idempotency-Key em mutações, validar campos/limites do contrato sem confiar no tenant do payload.

- [X] T048 [US2] Integrar providers em `src/modules/scheduling/scheduling.module.ts`, executar `test/e2e/scheduling-configuration.e2e-spec.ts` e `test/integration/scheduling/configuration-concurrency.spec.ts`; provar configuração completa sem seed manual e nenhuma escrita parcial após conflito.

## Fase 5: História de Usuário 3 — Acompanhar e Alterar Agendamentos (P2)

**Objetivo**: Agenda filtrada e ciclo auditável com estados finais imutáveis.

**Teste independente**: Usar fixtures confirmadas, consultar por período/profissional/estado, cancelar e verificar disponibilidade em até cinco segundos; reagendar outra reserva com rollback em conflito; registrar resultados e rejeitar reabertura. Não tentar reagendar a reserva já cancelada.

### Testes da História 3

- [X] T049 [P] [US3] Criar `test/unit/scheduling/appointment-transitions.spec.ts`: somente confirmed → cancelled/attended/no_show, finais imutáveis, reagendamento apenas confirmed, no_show exige agora >= starts_at e attended exige agora >= ends_at, replay não é nova transição; preservar snapshots e intervalo antigo em falha.

- [X] T050 [P] [US3] Criar `test/contract/scheduling-appointments-management.contract.spec.ts` para listAppointments/cancelAppointment/rescheduleAppointment/recordAppointmentOutcome; filtros de período/profissional/estado, segurança, idempotência e erros de transição/conflito segundo OpenAPI.

- [X] T051 [P] [US3] Criar `test/integration/scheduling/appointment-lifecycle.spec.ts` com cancelamento versus nova reserva, cancelamento versus reagendamento, dois resultados finais concorrentes, replay após mudança de estado e isolamento; provar transição única e eventos atômicos.

- [X] T052 [P] [US3] Criar `test/e2e/scheduling-appointment-management.e2e-spec.ts` cobrindo agenda e bloqueios via consulta de exceções, cancelamento, reagendamento, resultados, finais sem reabertura e SC-006 de liberação em até cinco segundos; usar relógio controlado.

### Implementação da História 3

- [X] T053 [US3] Adicionar transições ao agregado em `src/modules/scheduling/domain/appointment.ts`; exigir confirmed para novo comando, finais imutáveis, no_show desde starts_at e attended desde ends_at; novo agendamento é necessário após finalização, nunca restaurar o anterior.

- [X] T054 [US3] Implementar `src/modules/scheduling/application/use-cases/list-appointments.use-case.ts` e `src/modules/scheduling/infrastructure/persistence/appointment-query.repository.ts` com filtros contratuais e escopo administrativo; bloquear ranges inválidos, preservar histórico; bloqueios são consultados pelo endpoint de exceções US2, sem inventar paginação ou campos fora do contrato.

- [X] T055 [US3] Implementar cancelamento em `src/modules/scheduling/application/use-cases/cancel-appointment.use-case.ts` e `src/modules/scheduling/infrastructure/persistence/appointment-lifecycle.repository.ts`; protocolo comum, compare-and-set confirmed, evento cancelled e resposta idempotente no mesmo commit, liberar somente após commit.

- [X] T056 [US3] Implementar reagendamento em `src/modules/scheduling/application/use-cases/reschedule-appointment.use-case.ts` e `src/modules/scheduling/infrastructure/persistence/appointment-lifecycle.repository.ts`; preservar serviço/profissional/snapshots, revalidar grade/antecedência/janela/jornada após lock, ignorar próprio intervalo na colisão; evento anterior/novo e rollback preservam reserva original.

- [X] T057 [US3] Implementar resultado em `src/modules/scheduling/application/use-cases/record-appointment-outcome.use-case.ts` e `src/modules/scheduling/infrastructure/persistence/appointment-lifecycle.repository.ts`; aceitar attended/no_show só de confirmed; exigir agora >= starts_at para no_show e >= ends_at para attended; 409 antes do limiar e nos demais comandos, replay retorna resposta original sem evento adicional.

- [X] T058 [US3] Criar `src/modules/scheduling/infrastructure/http/appointment-management.controller.ts` e `dto/appointment-management.schemas.ts` nesse diretório; registrar quatro rotas no módulo `src/modules/scheduling/scheduling.module.ts`, exigir administrator e chave nas três mutações, executar testes US3.

## Fase 6: Refinamento e Validação da Base v1

**Objetivo**: Validar a entrega integrada, segurança, operação e documentação.

- [X] T059 [P] Ampliar `test/integration/security-redaction.spec.ts` para nome, telefone, e-mail, chave idempotente, IP bruto e segredos; verificar logs/telemetria, respostas públicas e ciphertext; erros administrativos podem conter apenas IDs autorizados de conflitos.

- [X] T060 [P] Adicionar métricas de latência p95, conflitos, transições, replay e limitação sem PII ou labels de alta cardinalidade em `src/shared/observability/metrics.ts` e `src/modules/scheduling/application/services/scheduling-observability.service.ts`; validar redação e correlação em `test/unit/scheduling/observability.spec.ts`, sem inventar SLA.

- [X] T061 [P] Atualizar `README.md`, `.env.example` e `specs/002-appointment-scheduling/quickstart.md` com comandos efetivos, configurações, chaves de segurança, rotas, SQL de release e validação com consumidor; manter dados de exemplo fictícios.

- [X] T062 Verificar fronteiras em `test/architecture/module-boundaries.spec.ts` e `test/architecture/module-aliases.spec.ts`; domínio independente, imports por aliases existentes, ausência de ORM/DDL no runtime e dependências de scheduling registradas em `src/modules/scheduling/scheduling.module.ts`.

- [X] T063 Executar aplicação/verificação/rollback/reaplicação em cópia descartável por `database/releases/002-appointment-scheduling/up.sql`, `verify.sql`, `rollback.sql`; verificar bootstrap limpo equivalente, grants e manifesto; registrar resultados em `specs/002-appointment-scheduling/quickstart.md`, sem aplicar em produção.

- [X] T064 Executar `yarn ci:check` via `scripts/check-ci.sh` após integrar a suíte PostgreSQL; comprovar lint, tipos, unitários, contratos, OpenAPI, schema, integração e E2E; corrigir falhas e registrar comandos/resultados em `specs/002-appointment-scheduling/quickstart.md`, sem repetir checks já aprovados sem motivo.

- [ ] T065 Executar ensaio SC-003/SC-004 com consumidor da API e registrar em `specs/002-appointment-scheduling/quickstart.md`: pelo menos 90% reservam em até três minutos; responsável configura serviço/jornada em até cinco minutos; informar amostra, tempos e limitações. Sem consumidor/participantes, registrar pendência e não declarar esses critérios aprovados.

## Fase 7: História de Usuário 2 — Incremento de Auditoria Administrativa (P1)

**Objetivo**: Completar FR-023, SC-009 e o cenário 7 de US2 com trilha administrativa atômica, consulta operacional autorizada e evolução v1 → v2. Reutilizar a base existente, sem nova história ou endpoint.

**Teste independente**: Com fixtures de dois tenants, sem depender de US3 ou de participantes, executar as nove mutações administrativas; consultar a trilha como login real de suporte autorizado somente para A; provar estado anterior/novo, ator/tenant, negação para B, concessões expiradas/revogadas, atomicidade em falha e replay sem duplicação. Atualizações idênticas não geram eventos. Provar bootstrap v2 equivalente ao upgrade e preservação da agenda v1.

### Testes da História 2 — auditoria

Escrever primeiro e observar a falha correspondente antes de implementar. Os seis arquivos abaixo podem ser escritos em paralelo após a base; não alterar fixtures compartilhadas nesse lote. As suítes PostgreSQL continuam executadas em série no banco descartável.

- [X] T066 [P] [US2] Criar `test/unit/scheduling/configuration-audit.spec.ts` para projeção tipada/diff: nove operações do contrato interno, enums de recurso, criação com “`before: null`”, remoção com “`after: null`”, conjuntos UUID sem repetição, jornadas canônicas sem IDs de linhas, ausência/nulo segundo o HTTP, comando sem mudança sem evento, redação de contatos/segredos em strings livres; comparar antes de redigir e preservar indicação de mudança quando os dois valores forem redigidos.

- [X] T067 [P] [US2] Criar `test/integration/scheduling/configuration-audit-schema.spec.ts` para campos obrigatórios/enums/JSON não vazio, unicidade por operação/recurso, FKs de tenant/ator e rejeição de ator de outro tenant; conferir índices, preservação do UUID de exceção removida, imutabilidade e runtime sem SELECT/UPDATE/DELETE/TRUNCATE, inclusive após grants genéricos e em bootstrap v2.

- [X] T068 [P] [US2] Criar `test/integration/scheduling/configuration-audit-access.spec.ts` com conexões reais de suporte por login individual: A autorizado/B não autorizado, consulta sem WHERE, concessão ausente/expirada/revogada, alteração de variável de sessão sem ganhar acesso, SET ROLE sem trocar `session_user`, impossibilidade de assumir owner/runtime, leitor sem INSERT/UPDATE/DELETE/TRUNCATE e sem alterar ACL; testar tabela de concessões visível somente ao próprio login e remover logins/concessões de teste no cleanup.

- [X] T069 [P] [US2] Criar `test/integration/scheduling/configuration-audit-atomicity.spec.ts`: nova alteração grava configuração/evento/idempotência juntos; falha no append ou no save idempotente reverte os três; conflito/422/401/403 não deixa evento de mudança concluída; replay serial/concorrente não duplica; expiração da chave trata novo comando sem apagar eventos; concorrência entre configuração e reserva continua usando o lock do tenant e antes/depois refletem a ordem real.

- [X] T070 [P] [US2] Criar `test/contract/scheduling-configuration-audit.contract.spec.ts` para `contracts/configuration-audit.md`: validar formato do evento/diff e correspondência das nove operações; preservar as 22 operações OpenAPI existentes, schemas/status de sucesso e tratamento sanitizado de erro interno; detectar rota de auditoria indevidamente adicionada, sem gerar contrato HTTP novo.

- [X] T071 [P] [US2] Criar `test/e2e/scheduling-configuration-audit.e2e-spec.ts` cobrindo as nove mutações via HTTP e leitura interna autorizada; um evento por mudança efetiva, ator/tenant corretos, exceção removida preservada no histórico, replay/no-op sem duplicação, ausência de endpoint e contatos/segredos fictícios em texto livre redigidos na trilha e ausentes de erros/logs/OTLP; usar banco isolado e relógio controlado.

### Implementação da História 2 — schema e acesso operacional

- [X] T072 [US2] Adicionar `scheduling.configuration_events` em `database/schema/020_tables.sql` com restrições de `data-model.md`: id “UUID PK gerado pela aplicação”; tenant_id “UUID obrigatório, FK para `tenancy.tenants`”; actor_membership_id “Obrigatório; FK composta `(tenant_id, actor_membership_id)` para membership do mesmo tenant; preservar autoria histórica mesmo após desativação”; operation_id “UUID gerado uma vez dentro do callback de nova mutação; não é chave idempotente bruta”; operation “Uma das nove mutações administrativas definidas no contrato interno”; resource_type “`service`, `professional`, `weekly_periods`, `availability_exception`, `time_zone` ou `tenant_settings`”; resource_id “UUID do agregado: serviço/profissional/exceção ou tenant para fuso/settings; não criar FK polimórfica que impeça preservar remoção de exceção”; occurred_at “Instante UTC recebido do relógio transacional após o lock”; correlation_id “Correlação técnica validada/gerada no servidor; sem dados de contato”; changes “JSONB objeto não vazio: cada campo alterado tem `before`, `after` e indicador de redação quando aplicável; valores normalizados e tipados”. Todas as colunas do evento são obrigatórias; nulos de criação/remoção ficam dentro do diff.

- [X] T073 [US2] Adicionar `scheduling.configuration_audit_access` em `database/schema/020_tables.sql`: campos obrigatórios “`principal_name` (nome do login PostgreSQL), `tenant_id` (FK), `granted_at`, `expires_at`, `granted_by` (identidade operacional) e `reason_code` controlado, sem justificativa livre ou segredo”; “PK `(principal_name, tenant_id)`; expiração posterior à concessão”. Em `database/schema/030_constraints.sql`, implementar constraints/enums básicos do evento e concessão, FKs de tenant/ator sem cascata e proteção append-only para UPDATE/DELETE. Em `database/schema/040_indexes.sql`, implementar “Unicidade `(tenant_id, operation_id, resource_type, resource_id)`”, índice “`(tenant_id, occurred_at, id)`” e índice “`(tenant_id, resource_type, resource_id, occurred_at, id)`”. Preservar tabelas/eventos v1.

- [X] T074 [US2] Criar políticas em `database/schema/050_configuration_audit_policies.sql` e incluí-las em `database/init/00-bootstrap.sql`; ajustar `database/schema/090_grants.sql` para `barber_audit_reader` NOLOGIN e revogações específicas após GRANTs genéricos. Runtime só INSERT na trilha, nenhum acesso à ACL; suporte só SELECT; RLS na ACL por “`principal_name = session_user`” e na trilha por concessão vigente do login/tenant no instante da instrução. Negar acesso público, não usar SECURITY DEFINER nem variável de sessão como autorização; não conceder membership owner/runtime ou SUPERUSER/BYPASSRLS/CREATEROLE aos leitores. Credenciais/concessões individuais pertencem ao provisionamento operacional, não ao cadastro de tenants. Fazer T067/T068 passar quanto ao schema/acesso.

- [X] T075 [US2] Criar `database/releases/002-appointment-scheduling-audit/up.sql`, `verify.sql` e `rollback.sql`: pré-condição v1, destino v2, DDL transacional de tabelas/constraints/índices/RLS/grants equivalente ao bootstrap, sem editar o release v1; verificar também owner, privilégios efetivos e políticas. Atualizar `database/schema/090_schema_manifest.sql`, `database/schema/schema.sha256`, `database/verify/assertions.sql`, `src/shared/http/health.controller.ts`, `compose.yaml` e `compose.e2e.yaml` para `002-appointment-scheduling-v2`. Rollback retorna v1 preservando agenda/eventos v1, remove trilha/ACL novas e documenta perda dos eventos administrativos; sem backfill fictício ou concessões automáticas. Ajustar expectativas de revisão em `test/integration/database-bootstrap.spec.ts` e `test/integration/scheduling/configuration-audit-schema.spec.ts` na mesma mudança; nenhum SQL de produção é aplicado nesta tarefa.

### Implementação da História 2 — aplicação e integração

- [X] T076 [US2] Definir evento, diff e `ConfigurationAuditWriter.append` em `src/modules/scheduling/application/ports/configuration-audit-writer.ts`, com as nove operações e seis tipos de recurso literais de T072/contrato interno, campos obrigatórios e `TransactionContext` recebido do chamador; sem NestJS/pg na porta, sem nova transação/commit/conexão e sem chave idempotente bruta ou hash no evento.

- [X] T077 [US2] Implementar `src/modules/scheduling/application/services/configuration-audit.service.ts` com campos permitidos por operação conforme `specs/002-appointment-scheduling/contracts/configuration-audit.md`; mapear aliases HTTP/colunas existentes, normalizar conjuntos e jornadas, calcular diff antes da redação, redigir strings livres e marcar valores sem cópia original; impedir serialização de corpo/resposta HTTP completos, contatos de convidados, tokens, IP e chaves. Exigir objeto changes não vazio, omitir evento em no-op, criar operation_id somente na nova mutação e não exportar valores à telemetria. Fazer T066 passar.

- [X] T078 [US2] Implementar INSERT sem RETURNING em `src/modules/scheduling/infrastructure/persistence/configuration-event.repository.ts` usando somente o `TransactionContext` fornecido, IDs já gerados pela aplicação e valores tipados de T076; não abrir conexão própria nem capturar falha como sucesso. Sem SELECT da trilha pelo runtime; erros propagam para rollback e são sanitizados na fronteira HTTP existente.

- [X] T079 [US2] Integrar auditoria de `createService`/`updateService` e `createProfessional`/`updateProfessional` em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`: ler antes/depois e associações sob lock, incluir elegibilidade no agregado serviço, ativação/desativação e campos efetivamente salvos; append no callback de nova mutação após validação, com ator/tenant do servidor e relógio recebido de `IdempotentMutationService.execute`. Replay deve retornar antes da leitura/diff/append; falha do evento reverte tudo. Não usar o writer independente de eventos de autenticação.

- [X] T080 [US2] Integrar `replaceWeeklyWorkPeriods`, `createAvailabilityException` e `deleteAvailabilityException` em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`, sequencialmente após T079 por arquivo compartilhado: capturar jornadas antigas antes do DELETE, comparar arrays sem IDs regenerados, preservar snapshot/UUID de exceção removida; criação usa anterior nulo, remoção usa novo nulo; excluir recurso já inexistente ou reenviar jornada equivalente não gera evento. Usar mesma conexão/lock/relógio e propagar falhas.

- [X] T081 [US2] Integrar `updateTenantTimeZone` e `updateSchedulingSettings` em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`, após T080: capturar valores persistidos antes/depois, recurso UUID do tenant, registrar apenas mudança efetiva na mesma transação, preservar snapshots e rejeição de conflitos existente; relógio/correlação do servidor. Não reauditar provisionamento antigo nem criar histórico retroativo.

- [X] T082 [US2] Fazer T069 passar ajustando `src/modules/scheduling/application/services/idempotent-mutation.service.ts` apenas se necessário para manter contexto/relógio compartilhados e replay antes do callback; completar injeção controlada de falhas e casos de concorrência em `test/integration/scheduling/configuration-audit-atomicity.spec.ts`. Comprovar rollback quando append falha e quando o save idempotente falha após append; limpeza de registros expirados não remove auditoria e novo comando expirado só gera evento se mudar estado.

- [X] T083 [US2] Criar `database/operations/query-configuration-audit.sql` como consulta operacional parametrizada, sem função SECURITY DEFINER: tenant UUID obrigatório; “`occurred_from` inclusivo, `occurred_before` exclusivo”, início menor que fim, resource_type/resource_id opcionais, “limite entre 1 e 100 (padrão 100)” e cursor “`(occurred_at, id)`” com ordem ascendente e avanço estrito. Validar entradas sem concatenar SQL inseguro, exigir conexão do login leitor e depender de RLS além do WHERE; não adicionar CLI com credenciais do runtime ou endpoint. Ampliar `test/integration/scheduling/configuration-audit-access.spec.ts` para filtros/paginação, limites inválidos e uso desse arquivo; concessão/revogação fica com owner operacional e remoção de concessões precede reutilização do nome de login.

- [X] T084 [US2] Registrar porta/serviço/repository em `src/modules/scheduling/scheduling.module.ts` e completar a passagem das dependências em `src/modules/scheduling/application/use-cases/manage-configuration.use-cases.ts`; manter rotas e contrato HTTP existentes. Fazer T070/T071 passar e confirmar ausência de leitura administrativa da trilha pelo runtime; corrigir fronteiras da nova porta/adapter em `test/architecture/module-boundaries.spec.ts` sem enfraquecer regras existentes.

- [X] T085 [US2] Integrar a execução dos novos testes em `scripts/test-e2e.sh` e suas fixtures em `test/e2e/scheduling-support.ts` somente se o descobrimento/cleanup atuais não bastarem; manter PostgreSQL real e execução serial. Comprovar o cenário 7 de US2 e SC-009 em `test/e2e/scheduling-configuration-audit.e2e-spec.ts`, com todos os testes T066–T071 aprovados e nenhum evento duplicado ou consulta cross-tenant; cleanup remove conexões/logins/concessões descartáveis sem apagar dados de produção.

**Ponto de verificação**: US2 inclui auditoria funcional e testada por fixtures; release e verificações finais abaixo ainda são necessários. US1/US3 devem continuar passando sem novos recursos públicos.

## Fase Final: Validação e Operação do Incremento v2

- [X] T086 Atualizar `README.md` e `specs/002-appointment-scheduling/quickstart.md` com comandos efetivos do release/consulta interna, autorização temporária por login/tenant, expiração/revogação e encerramento de sessões para revogação imediata quando necessário; explicar que novas instruções observam a revogação, sem prometer interromper consulta já em execução. Documentar janela sem escritas na troca de revisão, perda explícita da auditoria no rollback e preservação protegida de eventos quando necessária; manter PASS v1 e pendência T065, sem presumir resultados v2.

- [X] T087 Estender `scripts/check-scheduling-release.sh` e `database/verify/scheduling-release-equivalence.sql` para incluir tabelas, constraints, índices, owners/grants efetivos, roles e políticas RLS do incremento. Executar em PostgreSQL descartável autenticação → v1 → v2, upgrade com agenda/eventos v1 populados e equivalência ao bootstrap v2; testar rollback v2 → v1, reaplicação e prova v1 → autenticação separadamente, com preservação de dados pertinente a cada etapa. Registrar comandos/resultados reais em `specs/002-appointment-scheduling/quickstart.md`; sem usar banco de produção ou editar SQL histórico v1.

- [X] T088 Ampliar `test/integration/security-redaction.spec.ts` e `test/architecture/module-boundaries.spec.ts` para a nova trilha/porta, provar que valores sensíveis não aparecem em erros/logs/OTLP e que leitura interna não alcança contatos/idempotência. Revisar privilégios reais após bootstrap e upgrade por `test/integration/scheduling/configuration-audit-access.spec.ts`; manter domínios independentes, APIs compatíveis e nenhum endpoint de auditoria.

- [X] T089 Executar `yarn ci:check` via `scripts/check-ci.sh` após T086–T088 e integração do incremento; comprovar unitários, contratos, OpenAPI, schema/grants/RLS, integração PostgreSQL, E2E e revisão v2, corrigindo falhas. Atualizar `specs/002-appointment-scheduling/quickstart.md` com comandos/resultados/limitações e `specs/002-appointment-scheduling/plan.md` com o estado efetivamente validado, sem alterar evidência histórica nem declarar T065/SC-003/SC-004 aprovados sem ensaio humano.

## Dependências e Ordem

```text
Preparação (T001–T004)
  → Fundação (T005–T021)
    → US1 (T022–T034, P1)
      → US2 (T035–T048, P1)
        → US3 (T049–T058, P2)
          → Validação da base v1 (T059–T064)
            → US2 auditoria v2 (T066–T085)
              → Validação v2 (T086–T089)

Ensaio humano T065: ramo independente; não bloqueia T066–T089,
mas SC-003/SC-004 continuam pendentes até sua execução.
```

- Preparação é sequencial; preservar configurações/aliases anteriores.
- Na Fundação, T005, T006 e T007 formam um lote independente. Depois, SQL → constraints → índices → release → provisionamento → fixtures. T016 e T017 podem executar juntos após as portas/fixtures; protocolo → idempotência → eventos → integração comum são sequenciais.
- US1 depende apenas da Fundação e usa fixtures para catálogo/configurações. US2 usa US1 para comprovar o efeito na disponibilidade, mas seu domínio pode ser testado com fixtures. US3 reutiliza consulta pública e configuração US2 para o teste integrado; seus testes de transição usam reservas fixture.
- Dentro de cada história: testes primeiro, modelos antes de casos de uso, casos de uso antes de controllers, registro do módulo por último. Tarefas não marcadas `[P]` seguem a ordem numérica dentro do incremento, exceto o ramo humano T065 explicitamente independente. No ciclo TDD, testes pendentes por falta da implementação não bloqueiam escrever a implementação que os fará passar; só marcar testes concluídos depois de passarem.
- Nos testes TDD, primeiro observar a falha; a conclusão do lote exige que a implementação correspondente os faça passar. Não substituir PostgreSQL por mock nas provas de isolamento/concorrência.

### Exemplos de execução paralela por história

| História | Lote de testes independente após Fundação | Lote de implementação após pré-requisitos |
|---|---|---|
| US1 | T022, T023, T024, T025 | T029 e T030 após T028; arquivos distintos |
| US2 base | T035, T036, T037, T038 | T041–T046 sequenciais após T040; compartilham `manage-configuration.use-cases.ts` |
| US2 auditoria | T066–T071: escrita dos testes em seis arquivos independentes | T072–T085 sequenciais; schema, casos de uso e módulo compartilham arquivos |
| US3 | T049, T050, T051, T052 | Implementação sequencial: cancelamento/reagendamento/resultado compartilham repository |

O refinamento permite T059, T060 e T061 simultaneamente; demais verificações dependem desses resultados. Nunca editar `scheduling.module.ts`, schema SQL ou `appointment-lifecycle.repository.ts` em paralelo entre tarefas.

### Dependências específicas do incremento v2

- Base T001–T064 → escrita dos testes T066–T071 (lote paralelo; observar falhas pertinentes) → schema/ACL T072–T074 → release/revisão T075 → porta/projeção T076–T077 → writer T078 → integração sequencial das nove mutações T079–T081 → atomicidade T082 → consulta T083 → providers/contratos/E2E T084–T085 → documentação T086 → ensaio de release T087 → revisão transversal T088 → CI/evidências T089.
- T065 pode ocorrer independentemente quando houver consumidor/participantes; a entrega completa mantém essa pendência visível.
- Dentro do incremento v2, somente a escrita de T066–T071 tem `[P]`. Não executar suítes PostgreSQL ou editar `manage-configuration.use-cases.ts`, schema, módulo ou fixtures compartilhadas em paralelo.
- O incremento v2 é a menor entrega técnica pendente: não pode ser considerado concluído com apenas o INSERT de evento, sem consulta interna autorizada, testes e release.

## Rastreabilidade

| Escopo | Tarefas principais |
|---|---|
| FR-001, FR-002 | T039, T041, T042, T047 |
| FR-003, FR-004 | T043, T044, T040 |
| FR-005, FR-006, FR-007 | T028, T029, T030, T031 |
| FR-008, FR-009, FR-010 | T026, T031, T033, T024 |
| FR-011, FR-012 | T011, T016, T054, T058 |
| FR-013, FR-019 | T053–T058, T051 |
| FR-014 | T018, T037, T040 |
| FR-015, FR-016 | T027, T030, T033, T046 |
| FR-017, FR-018 | T011, T021, T031, T059 |
| FR-020, FR-021, FR-022 | T009, T028, T031, T045 |
| FR-023 | T066–T085, T086–T089 |
| SC-009 | T067–T071, T082–T085, T087–T089 |
| SC-001, SC-002 | T022, T024 |
| SC-003, SC-004 | T065 |
| SC-005 | T016, T037, T051, T059 |
| SC-006, SC-007, SC-008 | T052, T037, T049 |

## Estratégia de Implementação

### MVP primeiro

Concluir Preparação e Fundação, depois US1. Demonstrar consulta e reserva segura com fixtures, parâmetros 15/30, opção configurada de zero, timezone e teste de 100 disputas. Este MVP técnico ainda exige catálogo/jornadas pré-configurados. Para uma barbearia administrar sua agenda sem fixtures, incluir US2; US3 completa a operação diária com cancelamento, reagendamento e resultados.

### Entrega incremental

Concluir e verificar uma história por vez; a próxima não deve quebrar os testes anteriores. Revalidar contratos e schema apenas quando alterados. Não incluir pagamento, notificações externas, cadeiras físicas independentes, conta de convidado ou frontend neste incremento. A entrega só é declarada validada quando os critérios aplicáveis, inclusive ensaio de usabilidade quando disponível, tiverem evidências reais.


### Próximo incremento executável

O MVP original é US1 com catálogo/jornadas fixture; a operação autônoma inclui US2 e a gestão diária inclui US3. A base mantém suas marcações de conclusão. T066–T089 foram executadas como incremento da US2, sem recriar projeto, reimplementar histórias concluídas ou publicar novo endpoint. A auditoria foi demonstrada com fixtures, PostgreSQL real e HTTP; CI e ensaio SQL v2 passaram em ambientes descartáveis, sem deploy ou alteração de banco de produção. T065 segue como validação humana separada.


## Phase 8: Convergence

Avaliação do estado atual contra especificação, plano e tarefas em 2026-10-19. Resultado: três achados HIGH (F1–F3), sem violação constitucional CRITICAL confirmada. Os testes existentes aprovados não cobrem integralmente os casos abaixo. Esta seção somente acrescenta trabalho; não reabre nem substitui as marcações anteriores. T065 permanece independente, aguardando consumidor/participantes.

- [X] T090 [US2] Corrigir a proteção de campos livres em `src/modules/scheduling/application/services/configuration-audit.service.ts` por FR-023, SC-009 e T066/T077/T088 (partial; F1; HIGH): a reprodução com uma credencial sintética `ghp_` seguida de 36 letras demonstrou persistência literal em `changes.description` sem indicador de redação. Adotar uma política explícita e conservadora de projeção/redação que não dependa apenas das palavras password/secret/token e de poucos prefixos; preservar identificação do campo alterado e comparação antes da redação sem guardar o original sensível. Acrescentar regressões em `test/unit/scheduling/configuration-audit.spec.ts` e `test/integration/security-redaction.spec.ts` para credenciais sintéticas sem rótulo, inclusive formatos de token e chave privada, nos valores anteriores/novos de nome, descrição e motivo; provar ausência dos originais na trilha, erros e telemetria. Ajustar a evidência de validação em `specs/002-appointment-scheduling/quickstart.md` após os checks pertinentes, sem usar segredos reais.

- [X] T091 [US2] Corrigir `src/modules/scheduling/infrastructure/persistence/configuration-conflict.repository.ts` por FR-014, SC-007 e T037/T040 (contradicts; F2; HIGH): as seis consultas usam `starts_at > clock_timestamp()` e excluem compromissos ainda confirmados cujo início já ocorreu. Remover essa exclusão não prevista na especificação e verificar todos os confirmados afetados por bloqueio, jornada, fuso, desativação e remoção de elegibilidade, mantendo snapshots e a transação/lock do tenant. Adicionar testes PostgreSQL em `test/integration/scheduling/configuration-concurrency.spec.ts` para compromissos iniciados e ainda em andamento, limites exatos e confirmados anteriores ainda não finalizados: conflito retorna 409 com IDs autorizados, preserva configuração/agendamento e não grava evento de mudança concluída; comprovar nova tentativa após resolução conforme a especificação. Atualizar os resultados pertinentes em `specs/002-appointment-scheduling/quickstart.md`.

- [X] T092 [US1] Corrigir `src/modules/scheduling/domain/availability.ts` e, se necessário, `src/modules/scheduling/infrastructure/time/iana-time-zone.adapter.ts` por FR-005, FR-015, SC-001 e T022/T027/T028 (partial; F3; HIGH): `periodEndCandidates` vazio descarta a jornada inteira quando seu fechamento é um horário civil inexistente. A reprodução em `America/New_York`, data 2024-03-10, jornada 01:00–02:30 e serviço de 30 minutos retornou zero opções apesar de 01:00–01:30 ser válido. Preservar candidatos cujos intervalos completos sejam válidos e caibam na jornada antes da lacuna, sem oferecer instantes inexistentes ou atravessar o fechamento; manter grade ancorada, minutos decorridos e offsets explícitos. Acrescentar regressões com relógio controlado em `test/unit/scheduling/availability.spec.ts`, `test/unit/scheduling/time-zone.spec.ts` e `test/integration/scheduling/booking-concurrency.spec.ts`, provando consistência entre consulta e confirmação nas bordas de transição civil. Executar os checks afetados e registrar os resultados em `specs/002-appointment-scheduling/quickstart.md`.

**Ordem de execução**: T090 → T091 → T092, com teste falhando antes da correção e registro de resultados após aprovação. Nenhuma destas tarefas depende do ensaio humano T065; a entrega completa mantém SC-003/SC-004 pendentes até esse ensaio.
