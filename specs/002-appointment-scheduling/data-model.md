# Modelo de Dados: Agendamento de Serviços

Todos os identificadores são UUIDs gerados pela aplicação. Instantes são `timestamptz` e representam instantes UTC. Todo dado de agenda pertence a exatamente um `tenancy.tenants.id`; esse tenant é a barbearia. Estados de domínio são texto limitado por `CHECK`. Dados pessoais do cliente ficam no agendamento e, temporariamente, na resposta idempotente criptografada; não aparecem em eventos técnicos ou logs.

## Materialização do Schema

- O schema canônico continua sendo `database/schema/*.sql`, incluído explicitamente por `database/init/00-bootstrap.sql`.
- O release para bancos já existentes fica em `database/releases/002-appointment-scheduling/{up,verify,rollback}.sql`; não existe DDL no startup, ORM ou migração automática.
- `app_meta.schema_build.revision` avança de `001-tenant-authentication-v3` para `002-appointment-scheduling-v1`; readiness e testes aceitam somente a revisão esperada após implantação.
- `database/verify/assertions.sql`, teste de bootstrap, grants, manifesto e `database/schema/schema.sha256` são atualizados junto ao schema.
- O runtime recebe DML mínimo nos objetos de `scheduling`, sem permissão de criar schema, extensão ou tabelas.

## Fuso horário da barbearia (`tenancy.tenants`)

Adicionar `time_zone text NOT NULL DEFAULT 'America/Sao_Paulo'` ao tenant. O valor é nome IANA e é validado na camada de entrada contra zonas reconhecidas pelo runtime. A mudança de fuso vale para jornadas locais futuras; não recalcula os instantes UTC de agendamentos existentes. Sob lock de configurações, rejeitar com 409 se a nova interpretação invalidar compromissos confirmados.

## Configuração de disponibilidade (`scheduling.settings`)

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

## Jornada semanal (`scheduling.weekly_work_periods`)

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

## Chave de idempotência (`scheduling.appointment_idempotency`)

Tabela técnica compartilhada por mutações de agenda: `id`, `tenant_id`, `actor_scope` (membership UUID ou literal público), `operation`, `resource_scope`, `key_hash`, `request_hash`, `response_status`, `response_headers`, `response_ciphertext`, `created_at`, `expires_at`; `appointment_id` opcional com FK composta. Índice único `(tenant_id, actor_scope, operation, resource_scope, key_hash)`. A resposta original é criptografada quando contém dados pessoais; chave bruta nunca é persistida. Canonicalizar JSON antes do hash. Expiração de 24 horas; limpeza ocorre sob o mesmo protocolo de lock e não remove operação em andamento. Alteração de negócio, evento e resultado idempotente são confirmados juntos. Falhas sem commit não deixam resposta de sucesso. Mesmo escopo/chave com conteúdo diferente retorna 409.

## Evento de agenda (`scheduling.appointment_events`)

Registro append-only: `id`, `tenant_id`, `appointment_id`, `event_type` (`created`, `rescheduled`, `cancelled`, `attended`, `no_show`), `actor_membership_id` nulo somente para criação pública, `occurred_at`, início/fim anterior e novo quando houver reagendamento, `previous_status`, `new_status` e `correlation_id`. Não duplicar nome, telefone ou e-mail. Cada alteração de estado inclui o ator, instante, tenant e transição.

## Relacionamentos

- Um tenant possui serviços, profissionais, jornadas, exceções e agendamentos.
- Profissionais e serviços relacionam-se muitos-para-muitos dentro de um único tenant.
- Cada agendamento referencia exatamente um serviço e um profissional elegível do mesmo tenant e contém dados de contato de convidado sem conta global.
- Um agendamento possui muitos eventos append-only; eventos registram alterações sem substituir o estado atual.

## Transações e concorrência

1. Autorizar tenant/ator; abrir transação; bloquear `scheduling.settings` do tenant; consultar idempotência e retornar replay válido antes de qualquer nova mutação.
2. Carregar dados após o lock; capturar relógio; validar configurações vigentes e recurso. Bloquear agendamentos afetados por UUID em ordem crescente. Não efetuar chamadas externas mantendo locks.
3. Aplicar mutação, evento e resposta idempotente na mesma transação. Em erro, rollback completo; conflito de domínio ou exclusão retorna 409. Não retentar uma mutação parcialmente fora da transação.

- **Consultar disponibilidade**: snapshot consistente de leitura; inícios locais separados por `slot_interval_minutes`, ancorados no início de cada período; remover candidatos que violem antecedência, janela hoje..hoje+30, duração completa, exceções ou ocupação. Na ausência de resultados, retornar `slots: []`. Instantes na resposta levam offset da zona da barbearia.
- **Reservar**: derivar fim e snapshots do serviço no servidor; revalidar candidato, antecedência e elegibilidade sob lock; criar `confirmed`. Cliente não controla fim, duração, preço ou tenant administrativo. Quando profissional é omitido, reavaliar todos elegíveis e escolher por minutos confirmados no dia, desempate por UUID.
- **Reagendar**: somente `confirmed`; preservar serviço, profissional e snapshots; validar novo início pelas políticas atuais; ignorar o próprio intervalo na busca de colisão; atualizar intervalo e evento atomicamente. Falha preserva intervalo antigo.
- **Cancelar/registrar resultado**: compare-and-set de `confirmed` para estado final, com evento. Duas transições concorrentes distintas não podem ambas vencer. Novo comando contra estado final retorna 409; replay não cria evento.
- **Alterar configuração/jornada/catálogo/bloqueio**: validar todos os compromissos confirmados afetados usando os snapshots existentes; se houver conflito, 409 com IDs dos afetados para o administrador e nenhuma alteração. Depois de cancelar/reagendar conflitos, nova tentativa usa nova chave. Mudanças apenas de preço/nome/duração futura preservam snapshots; intervalo e antecedência não invalidam reservas existentes.

## Índices e integridade

Além das PKs/FKs compostas, indexar `(tenant_id, professional_id, starts_at)` em agendamentos e exceções, `(tenant_id, status, starts_at)` na agenda, `(tenant_id, professional_id, iso_weekday)` em jornadas e `expires_at` na idempotência. Eventos referenciam agendamento e ator com escopo de tenant; criar índice por tenant/agendamento/instante. Proibir remoção física de serviço/profissional referenciado; desativação segue verificação de conflitos.

Períodos semanais não podem sobrepor-se para o mesmo profissional/dia. O contrato inicial substitui a jornada semanal inteira; vigências futuras por data ficam fora do modelo inicial. Horas locais usam `HH:mm:ss` sem offset; intervalos cruzando meia-noite são divididos por dia.

## Contador de acesso público (`scheduling.public_throttle`)

Campos: `tenant_id`, `ip_hash`, `operation_group` (`read` ou `booking`), `window_start`, `count`, `expires_at`; chave composta nos quatro primeiros campos, incremento atômico independente da transação de reserva. Nunca armazenar IP bruto. Limites iniciais por minuto: 120 leituras e 10 reservas, com 429 e `Retry-After`. Limpeza e índice em `expires_at`; contador não espera pelo lock da agenda.
