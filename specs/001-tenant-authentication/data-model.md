# Modelo de Dados: Autenticação de Tenant sem Senha

Todos os identificadores são UUIDs gerados pela aplicação. Datas e horários são `timestamptz` em UTC. Enums de domínio são strings restringidas por `CHECK`. Digests são bytes, não texto hexadecimal. As tabelas são agrupadas pelo schema do contexto delimitado.

## Materialização do Schema

- Este modelo é implementado somente pelos scripts canônicos de `database/schema/*.sql`, incluídos por `database/init/00-bootstrap.sql` em ordem explícita.
- A aplicação NestJS e o usuário runtime não criam, sincronizam nem alteram objetos do banco e não possuem privilégio de DDL.
- O bootstrap de banco vazio usa `psql` com `ON_ERROR_STOP` e transação para o schema; não usa migrations de ORM ou framework.
- `app_meta.schema_build` registra a revisão do snapshot SQL concluído. Readiness exige a revisão suportada pela aplicação.
- `database/verify/assertions.sql` verifica schemas, tabelas, constraints e índices essenciais. A CI também compara um `pg_dump --schema-only` normalizado para detectar drift.
- Scripts de release para bancos persistentes ficam em `database/releases/<release>/` e são executados externamente, com pré e pós-verificação; nenhum script estrutural roda no startup da aplicação.

## Tentativa de Cadastro (`identity.registration_attempts`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária e identificador público |
| tenant_name | text | Sem espaços externos, 1–160 caracteres |
| tenant_slug | text | Forma canônica minúscula, 3–80 caracteres |
| administrator_email | text | Endereço de entrega sem espaços externos; acesso restrito |
| normalized_email | text | Forma canônica minúscula; acesso restrito |
| status | text | `pending`, `completed` ou `expired` |
| expires_at | timestamptz | Limite para conclusão |
| completed_at | timestamptz | Definido uma vez no sucesso |
| tenant_id | UUID | Nulo até a conclusão; referência ao Tenant criado |
| user_id | UUID | Nulo até a conclusão; referência à Conta criada |
| membership_id | UUID | Nulo até a conclusão; referência ao Vínculo criado |
| created_at | timestamptz | Obrigatório e imutável |

A tentativa não é conta e não concede autoridade. E-mail e slug são revalidados pelas restrições definitivas na conclusão. Transições: `pending -> completed` ou `pending -> expired`.

## Tenant (`tenancy.tenants`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária, imutável |
| name | text | Sem espaços externos, 1–160 caracteres |
| slug | text | Forma canônica minúscula, globalmente única, 3–80 caracteres |
| status | text | `active` ou `suspended`; nasce ativo |
| created_at | timestamptz | Obrigatório, imutável |
| updated_at | timestamptz | Obrigatório |

Um Tenant possui muitos Vínculos. Transição desta feature: `active -> suspended`.

## Conta de Usuário (`identity.user_accounts`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária, imutável |
| email | text | Endereço original de entrega sem espaços externos |
| normalized_email | text | Forma canônica minúscula, globalmente única |
| email_verified_at | timestamptz | Obrigatório; a conta nasce após verificação |
| status | text | `active` ou `suspended`; nasce ativa |
| created_at | timestamptz | Obrigatório, imutável |
| updated_at | timestamptz | Obrigatório |

Não existe senha, hash de senha, conta pendente ou identidade por telefone. Transição desta feature: `active -> suspended`.

## Vínculo com Tenant (`tenancy.tenant_memberships`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária, imutável |
| tenant_id | UUID | Chave estrangeira para Tenant |
| user_id | UUID | Chave estrangeira para Conta |
| role | text | `administrator` ou `member` |
| status | text | `active` ou `inactive` |
| created_at | timestamptz | Obrigatório, imutável |
| updated_at | timestamptz | Obrigatório |

O par `(tenant_id, user_id)` é único. Acesso exige Tenant, Conta e Vínculo ativos. Transição desta feature: `active -> inactive`.

## Desafio OTP (`identity.otp_challenges`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Identificador público e chave primária |
| purpose | text | `registration` ou `login` |
| registration_attempt_id | UUID | Obrigatório somente em `registration` |
| user_id | UUID | Obrigatório somente em `login` |
| tenant_id | UUID | Obrigatório somente em `login` |
| membership_id | UUID | Obrigatório somente em `login` |
| status | text | `pending`, `consumed`, `superseded`, `locked` ou `expired` |
| code_digest | bytea | 32 bytes de HMAC-SHA-256; OTP legível nunca é persistido aqui |
| key_version | smallint | Seleciona o pepper configurado |
| issued_at | timestamptz | Obrigatório, imutável |
| expires_at | timestamptz | Exatamente 10 minutos após emissão |
| failed_attempts | smallint | Começa em 0; limitado a `0..5` |
| consumed_at | timestamptz | Definido em `consumed` |
| superseded_at | timestamptz | Definido em `superseded` |
| locked_at | timestamptz | Definido em `locked` |

Checks validam as referências exigidas por finalidade. Um índice único parcial por escopo lógico onde `status = 'pending'` impede dois desafios utilizáveis; expressões dependentes de `now()` não entram no predicado. A verificação bloqueia a linha e faz a transição dentro da transação. Transições: `pending -> consumed|superseded|locked|expired`.

## Sessão Autenticada (`identity.authenticated_sessions`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária; usado como claim `sid` |
| jti | UUID | Identificador único do JWT |
| user_id | UUID | Conta autenticada |
| tenant_id | UUID | Tenant autorizado |
| membership_id | UUID | Vínculo que concedeu autoridade |
| role | text | Papel congelado na emissão para compor o token; autorização revalida o Vínculo |
| issued_at | timestamptz | Instante imutável de emissão |
| expires_at | timestamptz | `issued_at + AUTH_SESSION_TTL` vigente na emissão |
| status | text | `active`, `expired` ou `revoked`; esta feature não revoga por novo login |
| revoked_at | timestamptz | Reservado para revogação explícita futura |
| created_at | timestamptz | Obrigatório, imutável |

`jti` é único e `expires_at > issued_at`. O TTL aceito é 15 minutos a 7 dias, com padrão de 24 horas, validado antes de a aplicação iniciar. `exp` do JWT é exatamente `expires_at`. Mudanças de configuração não alteram linhas existentes. Um novo login sempre cria uma nova linha e não modifica sessões anteriores.

Toda requisição protegida exige sessão não expirada e estados atuais de Conta, Tenant e Vínculo ativos; claims não substituem essa consulta.

## Item da Caixa de Saída de E-mail (`identity.email_outbox`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária e chave de idempotência externa |
| challenge_id | UUID | Referência única ao desafio |
| kind | text | `registration_otp` ou `login_otp` |
| provider | text | Adapter selecionado; sem credencial |
| envelope_ciphertext | bytea | Destinatário e mensagem em envelope AEAD; nulo após expurgo |
| encryption_key_version | smallint | Seleciona chave de cifra separada e versionada |
| status | text | `pending`, `leased`, `delivered`, `retryable`, `failed` ou `expired` |
| provider_message_id | text | Nulo até aceite externo; nunca usado como autoridade |
| created_at | timestamptz | Obrigatório |
| leased_until | timestamptz | Reserva temporária para worker |
| delivered_at | timestamptz | Nulo até entrega |
| failed_at | timestamptz | Nulo até falha terminal |
| attempt_count | integer | Não negativo |
| next_attempt_at | timestamptz | Obrigatório enquanto pendente ou repetível |
| payload_purged_at | timestamptz | Obrigatório após estado terminal ou expiração |

O worker reivindica lotes em transação curta com `FOR UPDATE SKIP LOCKED`, confirma o lease, envia fora da transação e registra o resultado depois. Antes do envio revalida que o desafio ainda está pendente e vigente. A semântica é pelo menos uma vez.

## Evento de Segurança (`audit.security_events`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária |
| event_type | text | Vocabulário restrito para cadastro, login, sessão e entrega |
| outcome | text | `succeeded`, `rejected` ou `failed` |
| occurred_at | timestamptz | Instante UTC obrigatório |
| correlation_id | UUID | Referência obrigatória |
| tenant_id | UUID | Nulo quando desconhecido ou inaplicável |
| actor_user_id | UUID | Nulo quando desconhecido |
| challenge_id | UUID | Correlação segura |
| session_id | UUID | Nulo quando nenhuma sessão foi emitida |
| reason_code | text | Motivo seguro e legível por máquina |
| metadata | jsonb | Lista permitida; sem OTP, JWT, e-mail ou IP bruto |

A retenção é configuração operacional fora desta feature.

## Sujeito de Limitação (`identity.throttle_subjects`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária |
| scope_type | text | `tenant_email` ou `ip` |
| scope_digest | bytea | HMAC com chave separada; 32 bytes |
| created_at | timestamptz | Obrigatório |

O par `(scope_type, scope_digest)` é único. E-mail e IP brutos não são persistidos. Sujeitos envolvidos na mesma solicitação são bloqueados em ordem determinística para evitar corrida e deadlock.

## Evento de Limitação (`identity.throttle_events`)

| Campo | Tipo | Regras |
|---|---|---|
| id | UUID | Chave primária |
| subject_id | UUID | Chave estrangeira para Sujeito de Limitação |
| action | text | `registration`, `otp_issue` ou `otp_verify_failure` |
| occurred_at | timestamptz | Indexado com `subject_id` e `action` |

Os limites usam janela móvel: 5 emissões por e-mail e 20 por IP em 15 minutos; 10 falhas por e-mail e 50 por IP em uma hora. A transação bloqueia os sujeitos, conta eventos vigentes e inclui o novo evento atomicamente. `Retry-After` deriva do evento mais antigo ainda contado. Eventos anteriores à maior janela mais uma margem podem ser expurgados.

## Relações essenciais

- Tentativa de Cadastro possui um ou mais Desafios de cadastro ao longo de reemissões e conclui em exatamente um Tenant, uma Conta e um Vínculo.
- Conta possui muitos Vínculos; cada Vínculo pertence a exatamente um Tenant.
- Desafio possui no máximo um Item de Outbox por emissão.
- Uma verificação bem-sucedida cria uma Sessão; Conta e Vínculo podem possuir muitas Sessões simultâneas.
- Eventos de Segurança referenciam entidades conhecidas sem duplicar PII.

## Fronteiras Transacionais

- **Iniciar cadastro**: limitação, Tentativa, Desafio, Outbox e Evento de Segurança são confirmados juntos; nenhum Tenant, Conta ou Vínculo existe ainda.
- **Concluir cadastro**: Desafio é bloqueado; unicidades são decididas pelas constraints; Desafio, Tentativa, Tenant, Conta, Vínculo, Sessão e Evento são alterados juntos; JWT é retornado somente após commit.
- **Solicitar OTP de login**: sujeitos de limitação são bloqueados, elegibilidade é avaliada, desafios anteriores são substituídos e Desafio, Outbox e Evento são confirmados juntos. Identidades inelegíveis preservam resposta pública equivalente.
- **Verificar OTP de login**: Desafio e sujeitos de limitação são bloqueados; estados são revalidados; falha registra contador ou sucesso consome o desafio, cria Sessão e Evento; JWT somente após commit.
- **Autorizar requisição**: consulta única escopada por sessão, conta, tenant e vínculo decide acesso; expiração usa o instante persistido.
- **Despachar e-mail**: worker reivindica em transação curta, envia fora dela e registra entrega, nova tentativa, falha ou expiração; o envelope é expurgado em estado terminal.
