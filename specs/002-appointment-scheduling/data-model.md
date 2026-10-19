# Modelo de Dados: Agendamento de Serviços

Todos os identificadores são UUIDs gerados pela aplicação. Instantes são `timestamptz` e representam instantes UTC. Todo dado de agenda pertence a exatamente um `tenancy.tenants.id`; esse tenant é a barbearia. Estados de domínio são texto limitado por `CHECK`. Dados pessoais do cliente ficam no agendamento e, temporariamente, na resposta idempotente criptografada; não aparecem em eventos técnicos ou logs.

## Materialização do Schema

- O schema canônico continua sendo `database/schema/*.sql`, incluído explicitamente por `database/init/00-bootstrap.sql`.
- O release para bancos já existentes fica em `database/releases/002-appointment-scheduling/{up,verify,rollback}.sql`; não existe DDL no startup, ORM ou migração automática.
- O release existente leva `001-tenant-authentication-v3` a `002-appointment-scheduling-v1`. O incremento em `database/releases/002-appointment-scheduling-audit/{up,verify,rollback}.sql` exige v1 e produz `002-appointment-scheduling-v2`; bootstrap limpo, readiness, assertions e testes convergem para v2. O SQL v1 permanece preservado.
- `database/verify/assertions.sql`, teste de bootstrap, grants, manifesto e `database/schema/schema.sha256` são atualizados junto ao schema.
- O runtime recebe DML mínimo nos objetos de `scheduling`, sem permissão de criar schema, extensão ou tabelas.

Nomes de campos expostos no HTTP podem diferir das colunas existentes: `display_name` corresponde a `professionals.name`, `currency_code` a `services.currency`, `guest_*` a `appointments.customer_*`, `starts_local_time`/`ends_local_time` a `weekly_periods.starts_at`/`ends_at`. O incremento de auditoria não renomeia essas colunas.

## Fuso horário da barbearia (`tenancy.tenants`)

Adicionar `time_zone text NOT NULL DEFAULT 'America/Sao_Paulo'` ao tenant. O valor é nome IANA e é validado na camada de entrada contra zonas reconhecidas pelo runtime. A mudança de fuso vale para jornadas locais futuras; não recalcula os instantes UTC de agendamentos existentes. Sob lock de configurações, rejeitar com 409 se a nova interpretação invalidar compromissos confirmados.

## Configuração de disponibilidade (`scheduling.tenant_settings`)

Uma linha por tenant: `tenant_id` PK/FK, `slot_interval_minutes integer NOT NULL DEFAULT 15 CHECK (> 0)`, `minimum_advance_minutes integer NOT NULL DEFAULT 30 CHECK (>= 0)`, `updated_at`. Inserir no provisionamento de tenant e preencher tenants existentes no release. Essa linha também é o lock transacional comum a todas as mutações de scheduling. Configurações são lidas no servidor, nunca confiadas ao cliente. Alterá-las não reescreve compromissos existentes.

## Serviço (`scheduling.services`)

| Campo | Regra |
|---|---|
| id | UUID PK |
| tenant_id | UUID FK para `tenancy.tenants`; sempre usado em consultas |
| name | Obrigatório, 1–120 caracteres após trim |
| description | Opcional, texto simples limitado |
| duration_minutes | Inteiro positivo, máximo de 480 minutos |
| price_minor | Inteiro não negativo em unidade monetária menor |
| currency_code | ISO 4217; padrão inicial `BRL` |
| status | `active` ou `inactive`; serviço inativo não aceita novas reservas |
| created_at / updated_at | Instantes UTC |

Único por `(tenant_id, id)` para suportar FKs compostas que provam escopo do tenant.

## Profissional (`scheduling.professionals`)

| Campo | Regra |
|---|---|
| id | UUID PK |
| tenant_id | UUID FK para `tenancy.tenants` |
| display_name | Obrigatório, 1–120 caracteres após trim |
| status | `active` ou `inactive` |
| created_at / updated_at | Instantes UTC |

Único por `(tenant_id, id)`. Não é uma conta; autenticação individual de profissional está fora do MVP.

## Serviço realizado por profissional (`scheduling.professional_services`)

Tabela de associação com `tenant_id`, `professional_id`, `service_id`, `created_at` e chave única `(tenant_id, professional_id, service_id)`. FKs compostas com tenant impedem associar recursos de barbearias distintas. Só associações ativas determinam elegibilidade para novas reservas.

## Jornada semanal (`scheduling.weekly_periods`)

Cada linha define um intervalo de trabalho local recorrente: `id`, `tenant_id`, `professional_id`, `iso_weekday` (1–7), `starts_local_time`, `ends_local_time`, `created_at`. Exigir início menor que fim; cruzar meia-noite é representado por duas jornadas/dias. Pausas recorrentes são intervalos não trabalhados, representados por separar a jornada em períodos antes e depois da pausa. FKs incluem `tenant_id`.

## Exceção de disponibilidade (`scheduling.availability_exceptions`)

Cada registro bloqueia um intervalo pontual UTC: `id`, `tenant_id`, `professional_id`, `kind` (`break`, `time_off`, `holiday` ou `blocked`), `starts_at`, `ends_at`, `reason` opcional, `created_by_membership_id` e `created_at`. Validar `ends_at > starts_at`, vínculo do profissional ao tenant e acesso do ator. A exceção pode sobrepor uma jornada, mas não cria disponibilidade fora dela.

## Agendamento (`scheduling.appointments`)

| Campo | Regra |
|---|---|
| id | UUID PK e identificador público da reserva |
| tenant_id | UUID FK para a barbearia |
| service_id / professional_id | FKs compostas `(tenant_id, id)` |
| starts_at / ends_at | Instantes UTC; `ends_at > starts_at`; intervalo lógico `[starts_at, ends_at)` |
| status | `confirmed`, `cancelled`, `attended`, `no_show` |
| guest_name | Obrigatório, 1–160 caracteres após trim |
| guest_phone | Obrigatório, formato E.164 após normalização |
| guest_email | Obrigatório, normalizado para comparação e validação de formato |
| service_name_snapshot | Nome apresentado no instante da reserva |
| duration_minutes_snapshot | Duração do serviço no instante da reserva |
| price_minor_snapshot / currency_code_snapshot | Preço informativo acordado ao reservar |
| created_at / updated_at | Instantes UTC |

Constraint de exclusão GiST impede interseção de intervalos para a mesma combinação de tenant e profissional enquanto `status = 'confirmed'`. O valor de fim é persistido (ou representado por `tstzrange`) e sempre derivado da duração snapshot. Cancelamento libera a vaga após commit. `cancelled`, `attended` e `no_show` são terminais. Registrar `no_show` exige instante atual igual ou posterior a `starts_at`; registrar `attended` exige instante atual igual ou posterior a `ends_at`. Apenas `confirmed` permite reagendamento ou transição. Repetição com mesma chave de idempotência devolve a resposta anterior sem evento adicional.

## Chave de idempotência (`scheduling.idempotency_records`)

Tabela técnica compartilhada por mutações de agenda: `id`, `tenant_id`, `actor_scope` (membership UUID ou literal público), `operation`, `resource_scope`, `key_hash`, `request_hash`, `response_status`, `response_headers`, `response_ciphertext`, `created_at`, `expires_at`; `appointment_id` opcional com FK composta. Índice único `(tenant_id, actor_scope, operation, resource_scope, key_hash)`. A resposta original é criptografada quando contém dados pessoais; chave bruta nunca é persistida. Canonicalizar JSON antes do hash. Expiração de 24 horas; limpeza ocorre sob o mesmo protocolo de lock e não remove operação em andamento. Alteração de negócio, evento e resultado idempotente são confirmados juntos. Falhas sem commit não deixam resposta de sucesso. Mesmo escopo/chave com conteúdo diferente retorna 409.

## Evento de agenda (`scheduling.appointment_events`)

Registro append-only: `id`, `tenant_id`, `appointment_id`, `event_type` (`created`, `rescheduled`, `cancelled`, `attended`, `no_show`), `actor_membership_id` nulo somente para criação pública, `occurred_at`, início/fim anterior e novo quando houver reagendamento, `previous_status`, `new_status` e `correlation_id`. Não duplicar nome, telefone ou e-mail. Cada alteração de estado inclui o ator, instante, tenant e transição.

## Evento de configuração (`scheduling.configuration_events`)

Trilha append-only de FR-023, independente de `appointment_events` e do prazo de retenção da idempotência. Não será preenchida retroativamente a partir do estado atual.

| Campo | Regra |
|---|---|
| id | UUID PK gerado pela aplicação |
| tenant_id | UUID obrigatório, FK para `tenancy.tenants` |
| actor_membership_id | Obrigatório; FK composta `(tenant_id, actor_membership_id)` para membership do mesmo tenant; preservar autoria histórica mesmo após desativação |
| operation_id | UUID gerado uma vez dentro do callback de nova mutação; não é chave idempotente bruta |
| operation | Uma das nove mutações administrativas definidas no contrato interno |
| resource_type | `service`, `professional`, `weekly_periods`, `availability_exception`, `time_zone` ou `tenant_settings` |
| resource_id | UUID do agregado: serviço/profissional/exceção ou tenant para fuso/settings; não criar FK polimórfica que impeça preservar remoção de exceção |
| occurred_at | Instante UTC recebido do relógio transacional após o lock |
| correlation_id | Correlação técnica validada/gerada no servidor; sem dados de contato |
| changes | JSONB objeto não vazio: cada campo alterado tem `before`, `after` e indicador de redação quando aplicável; valores normalizados e tipados |

Unicidade `(tenant_id, operation_id, resource_type, resource_id)`; índice de consulta `(tenant_id, occurred_at, id)` e índice por `(tenant_id, resource_type, resource_id, occurred_at, id)`. Validar tipos, nomes de operação/recurso e conteúdo JSON na porta de aplicação; CHECKs asseguram formato básico e enums no banco. FKs de tenant/ator não usam exclusão em cascata. O UUID do recurso removido permanece no evento.

Um comando de configuração altera um agregado e gera no máximo um evento com todos os campos efetivamente alterados. Criação registra `before: null`; remoção registra `after: null`. Jornada é um array canônico ordenado por dia/início/fim, sem IDs internos de linhas; `professional_ids` é conjunto UUID ordenado e sem repetição no evento do serviço. Ausência e nulo são normalizados conforme o contrato HTTP; uma atualização idêntica ou exclusão de exceção inexistente não produz evento de mudança. Replay válido não executa novamente o diff nem o INSERT; após expiração da chave, a requisição é um novo comando e somente produz evento se houver nova mudança efetiva.

Copiar apenas campos de domínio permitidos no contrato interno, nunca corpos HTTP/respostas completos, tokens, chave idempotente ou dados de convidados. Os textos livres de nome/descrição/motivo são sempre integralmente redigidos antes da persistência na trilha, independentemente do formato: valores não nulos usam `[REDACTED]` e indicador de redação, sem guardar cópia original. Valores estruturados e nulos permanecem explícitos. O diff identifica mudanças antes da redação, para não apagar a existência de mudanças entre dois valores sensíveis. A trilha não deve ser exportada para logs ou OTLP.

O runtime recebe somente INSERT na tabela, sem SELECT/UPDATE/DELETE/TRUNCATE. Revogar privilégios amplos após os GRANTs genéricos existentes; adicionar proteção append-only para UPDATE/DELETE seguindo o padrão atual. Falha ao inserir o evento cancela a transação inteira, incluindo dados de configuração e resposta idempotente. Retenção/expurgo da trilha exige política futura aprovada; limpeza de idempotência não remove eventos.

## Autorização de consulta interna (`scheduling.configuration_audit_access`)

Tabela operacional de concessões: `principal_name` (nome do login PostgreSQL), `tenant_id` (FK), `granted_at`, `expires_at`, `granted_by` (identidade operacional) e `reason_code` controlado, sem justificativa livre ou segredo. PK `(principal_name, tenant_id)`; expiração posterior à concessão. Só o responsável operacional pelo banco pode conceder, renovar ou revogar; runtime e suporte não alteram essa tabela. Remover concessões ao desativar um login, antes de reutilizar seu nome.

O grupo `barber_audit_reader` é NOLOGIN. Seus membros usam logins individuais sem SUPERUSER/BYPASSRLS/CREATEROLE, sem papel de owner/runtime e sem capacidade de assumir esses papéis. Recebem USAGE do schema e SELECT na trilha/ACL; RLS na ACL mostra apenas concessões cujo `principal_name = session_user`. RLS SELECT da trilha exige concessão do mesmo `session_user`, para o tenant da linha, ainda vigente no instante da instrução. Runtime possui política apenas de INSERT; público não recebe política nem privilégio. Negar acesso por padrão; não autorizar por variável de sessão definida pelo cliente. Não usar funções SECURITY DEFINER para esta consulta.

A consulta usa tenant obrigatório, período UTC semiaberto e paginação limitada, conforme `contracts/configuration-audit.md`. Mesmo sem filtro, RLS impede ler tenants não autorizados. Testar login real de suporte; SET ROLE em sessão superusuária não reproduz o `session_user` necessário. Concessão revogada ou expirada afeta novas instruções de consulta; uma instrução já em execução usa seu snapshot. Operação pode encerrar sessões para revogação imediata. Nenhum endpoint HTTP é acrescentado.

## Relacionamentos

- Um tenant possui serviços, profissionais, jornadas, exceções, agendamentos e eventos administrativos; concessões internas são vinculadas a login e tenant.
- Profissionais e serviços relacionam-se muitos-para-muitos dentro de um único tenant.
- Cada agendamento referencia exatamente um serviço e um profissional elegível do mesmo tenant e contém dados de contato de convidado sem conta global.
- Um agendamento possui muitos eventos append-only; eventos registram alterações sem substituir o estado atual.

## Transações e concorrência

1. Autorizar tenant/ator; abrir transação; bloquear `scheduling.tenant_settings` do tenant; consultar idempotência e retornar replay válido antes de qualquer nova mutação.
2. Carregar dados após o lock; capturar relógio; validar configurações vigentes e recurso. Bloquear agendamentos afetados por UUID em ordem crescente. Não efetuar chamadas externas mantendo locks.
3. Aplicar mutação, evento de agendamento ou de configuração e resposta idempotente na mesma transação. Para configuração, carregar o estado anterior após o lock, calcular o diff tipado e inserir via `ConfigurationAuditWriter` usando a conexão recebida; não usar conexão independente nem publicação após commit. Em erro, rollback completo; conflito de domínio ou exclusão retorna 409. Não retentar uma mutação parcialmente fora da transação.

- **Consultar disponibilidade**: snapshot consistente de leitura; inícios locais separados por `slot_interval_minutes`, ancorados no início de cada período; remover candidatos que violem antecedência, janela hoje..hoje+30, duração completa, exceções ou ocupação. Na ausência de resultados, retornar `slots: []`. Instantes na resposta levam offset da zona da barbearia.
- **Reservar**: derivar fim e snapshots do serviço no servidor; revalidar candidato, antecedência e elegibilidade sob lock; criar `confirmed`. Cliente não controla fim, duração, preço ou tenant administrativo. Quando profissional é omitido, reavaliar todos elegíveis e escolher por minutos confirmados no dia, desempate por UUID.
- **Reagendar**: somente `confirmed`; preservar serviço, profissional e snapshots; validar novo início pelas políticas atuais; ignorar o próprio intervalo na busca de colisão; atualizar intervalo e evento atomicamente. Falha preserva intervalo antigo.
- **Cancelar/registrar resultado**: compare-and-set de `confirmed` para estado final, com evento. Duas transições concorrentes distintas não podem ambas vencer. Novo comando contra estado final retorna 409; replay não cria evento.
- **Alterar configuração/jornada/catálogo/bloqueio**: validar todos os compromissos confirmados afetados usando os snapshots existentes; se houver conflito, 409 com IDs dos afetados para o administrador e nenhuma alteração. Depois de cancelar/reagendar conflitos, nova tentativa usa nova chave. Mudanças apenas de preço/nome/duração futura preservam snapshots; intervalo e antecedência não invalidam reservas existentes. Mudança efetiva gera evento administrativo na mesma transação; rollback não deixa evento de mudança concluída e replay não gera novo evento.

## Índices e integridade

Além das PKs/FKs compostas, indexar `(tenant_id, professional_id, starts_at)` em agendamentos e exceções, `(tenant_id, status, starts_at)` na agenda, `(tenant_id, professional_id, iso_weekday)` em jornadas e `expires_at` na idempotência. Eventos referenciam agendamento e ator com escopo de tenant; criar índice por tenant/agendamento/instante. Proibir remoção física de serviço/profissional referenciado; desativação segue verificação de conflitos.

Períodos semanais não podem sobrepor-se para o mesmo profissional/dia. O contrato inicial substitui a jornada semanal inteira; vigências futuras por data ficam fora do modelo inicial. Horas locais usam `HH:mm:ss` sem offset; intervalos cruzando meia-noite são divididos por dia.

## Contador de acesso público (`scheduling.public_throttle_windows`)

Campos: `tenant_id`, `ip_hash`, `operation_group` (`read` ou `booking`), `window_start`, `count`, `expires_at`; chave composta nos quatro primeiros campos, incremento atômico independente da transação de reserva. Nunca armazenar IP bruto. Limites iniciais por minuto: 120 leituras e 10 reservas, com 429 e `Retry-After`. Limpeza e índice em `expires_at`; contador não espera pelo lock da agenda.
