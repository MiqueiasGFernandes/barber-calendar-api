# Modelo de Dados: Agendamento de Serviços

Todos os identificadores são UUIDs gerados pela aplicação. Instantes são `timestamptz` e representam instantes UTC. Todo dado de agenda pertence a exatamente um `tenancy.tenants.id`; esse tenant é a barbearia. Estados de domínio são texto limitado por `CHECK`. PII do cliente existe somente no agendamento e não aparece em eventos técnicos ou logs.

## Materialização do Schema

- O schema canônico continua sendo `database/schema/*.sql`, incluído explicitamente por `database/init/00-bootstrap.sql`.
- O release para bancos já existentes fica em `database/releases/002-appointment-scheduling/{up,verify,rollback}.sql`; não existe DDL no startup, ORM ou migração automática.
- `app_meta.schema_build.revision` avança de `001-tenant-authentication-v3` para `002-appointment-scheduling-v1`; readiness e testes aceitam somente a revisão esperada após implantação.
- `database/verify/assertions.sql`, teste de bootstrap, grants, manifesto e `database/schema/schema.sha256` são atualizados junto ao schema.
- O runtime recebe DML mínimo nos objetos de `scheduling`, sem permissão de criar schema, extensão ou tabelas.

## Fuso horário da barbearia (`tenancy.tenants`)

Adicionar `time_zone text NOT NULL DEFAULT 'America/Sao_Paulo'` ao tenant. O valor é nome IANA e é validado na camada de entrada contra zonas reconhecidas pelo runtime. A mudança de fuso vale para jornadas locais futuras; não recalcula os instantes UTC de agendamentos existentes.

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

## Jornada semanal (`scheduling.weekly_work_periods`)

Cada linha define um intervalo de trabalho local recorrente: `id`, `tenant_id`, `professional_id`, `iso_weekday` (1–7), `starts_local_time`, `ends_local_time`, `valid_from`, `valid_until` opcional e `created_at`. Exigir início menor que fim; cruzar meia-noite é representado por duas jornadas/dias. Pausas recorrentes são intervalos não trabalhados, representados por separar a jornada em períodos antes e depois da pausa. FKs incluem `tenant_id`.

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

Constraint de exclusão GiST impede interseção de intervalos para a mesma combinação de tenant e profissional enquanto `status = 'confirmed'`. O valor de fim é persistido (ou representado por `tstzrange`) e sempre derivado da duração snapshot. Cancelamento libera a vaga após commit. `attended` e `no_show` são estados históricos terminais e não liberam uma vaga futura porque o intervalo já ocorreu.

## Chave de idempotência (`scheduling.appointment_idempotency`)

Tabela técnica com `id`, `tenant_id`, `key_hash`, `request_hash`, `appointment_id`, `created_at` e `expires_at`. Índice único `(tenant_id, key_hash)` evita duplicatas concorrentes. A mesma chave e hash de requisição retornam o agendamento original; a mesma chave com corpo diferente resulta em conflito. Registros expirados após 24 horas são removidos de forma segura; o telefone, e-mail e a chave original não são armazenados nesta tabela.

## Evento de agenda (`scheduling.appointment_events`)

Registro append-only: `id`, `tenant_id`, `appointment_id`, `event_type` (`created`, `rescheduled`, `cancelled`, `attended`, `no_show`), `actor_membership_id` nulo somente para criação pública, `occurred_at`, início/fim anterior e novo quando houver reagendamento, e `correlation_id`. Não duplicar nome, telefone ou e-mail. Cada alteração de estado inclui o ator, instante, tenant e transição.

## Relacionamentos

- Um tenant possui serviços, profissionais, jornadas, exceções e agendamentos.
- Profissionais e serviços relacionam-se muitos-para-muitos dentro de um único tenant.
- Cada agendamento referencia exatamente um serviço e um profissional elegível do mesmo tenant e contém dados de contato de convidado sem conta global.
- Um agendamento possui muitos eventos append-only; eventos registram alterações sem substituir o estado atual.

## Transações e concorrência

- **Consultar disponibilidade**: carregar serviço e tenant; gerar inícios em passos de 15 minutos sobre períodos locais de trabalho convertidos para UTC; remover exceções e intervalos ocupados; limitar a data a hoje..hoje+30 dias local.
- **Reservar**: validar idempotência e elegibilidade; derivar fim de duração do serviço; revalidar jornada/exceções; inserir agendamento `confirmed` e evento `created` na mesma transação. A constraint GiST é a autoridade final. Em conflito, rollback completo e resposta 409 sem detalhes de PII.
- **Reagendar**: validar novo intervalo e atualizar instantes, adicionar evento com valores anteriores/novos e commit como operação atômica; constraint continua protegendo o novo intervalo.
- **Cancelar/atender/não compareceu**: checar tenant e ator; transicionar estado uma única vez e adicionar evento na mesma transação.
