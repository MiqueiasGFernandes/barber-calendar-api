# Guia de Validação: Agendamento de Serviços

Este guia descreve o consumo e a validação da base v1 implementada e, em seção separada, a validação planejada do incremento v2 de auditoria administrativa. O contrato detalhado está em [contracts/openapi.yaml](contracts/openapi.yaml); entidades, invariantes e transações estão em [data-model.md](data-model.md).

## Pré-requisitos

- Node.js 24.x, Yarn 4.18.x e Docker com Docker Compose. Na raiz do projeto, executar `yarn install --immutable` antes das verificações.
- Variáveis requeridas pelos scripts E2E; `scripts/test-e2e.sh` gera senhas descartáveis quando não fornecidas.
- Um tenant de teste, um responsável autenticado, pelo menos um serviço, um profissional elegível e períodos de trabalho locais.

## Validação estática e de contrato

```sh
yarn lint
yarn typecheck
yarn build
yarn test:unit
yarn test:contract
yarn contract:check
yarn schema:check
```

Esperado: validações sem erros; OpenAPI 3.1 e tipos gerados sincronizados; bootstrap SQL satisfaz constraints, grants e hash canônico.

## Fluxo de booking E2E

```sh
yarn test:e2e
```

O script inicia PostgreSQL e Mailpit descartáveis, executa a integração PostgreSQL e depois os testes Fastify reais, em série. As senhas são geradas pelo próprio script e o ambiente é removido ao terminar, inclusive em falhas.

Os cenários E2E devem provar:

1. Responsável cria serviço, profissional elegível, jornada semanal e exceção; consultas públicas usam slug de tenant e mostram somente os próximos 30 dias e os inícios em que o serviço cabe.
2. Convidado reserva informando nome, telefone e e-mail; resposta retorna `confirmed`, profissional atribuído e apenas dados da própria reserva.
3. Duas reservas concorrentes para o mesmo profissional/intervalo resultam em uma resposta de sucesso e uma de conflito; dois intervalos que apenas compartilham uma borda podem ambos ser confirmados.
4. Repetir `Idempotency-Key` com o mesmo conteúdo retorna o resultado original; reutilizá-la com conteúdo diferente falha sem duplicar reserva.
5. Cancelar libera o intervalo após commit; reagendar mantém atomicidade; `attended` só é aceito a partir do término e `no_show` a partir do início; ambos permanecem no histórico.
6. Responsável de tenant diferente não consulta nem modifica o agendamento; membro sem papel administrativo não altera configuração.
7. Nome, telefone, e-mail e identificadores de booking não aparecem em logs de aplicação ou telemetria; conflitos administrativos podem informar IDs das reservas afetadas, sem nome, telefone ou e-mail nas respostas de erro.

## Gates de release

```sh
yarn ci:check
```

Esperado: lint, tipos, build novo, testes unitários/arquiteturais, contratos, OpenAPI, drift do schema, integração e E2E passam em sequência. Em ambiente persistente, aplicar `database/releases/002-appointment-scheduling/up.sql` com procedimento operacional aprovado, validar `verify.sql` e só então executar a versão que exige `002-appointment-scheduling-v1`.

## Cenários adicionais das clarificações

Executar com relógio controlado nos testes; não usar esperas reais para atravessar fronteiras de tempo.

| Preparação / operação                                                         | Resultado esperado                                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Configuração nova                                                             | GET `/v1/management/scheduling-settings` retorna 15/30                                        |
| PUT configuração com intervalo 20 e antecedência 30; expediente 09:00–12:00   | Inícios 09:00, 09:20, 09:40 etc.; filtrar os que não atendem à antecedência ou duração        |
| Intervalo 0 ou antecedência negativa                                          | 422, configuração anterior preservada                                                         |
| Agora 10:00, antecedência 30                                                  | Início 10:30 aceito se alinhado e livre; 10:29 rejeitado                                      |
| Busca permite 10:30, confirmação ocorre às 10:01                              | 409, nenhuma reserva criada                                                                   |
| Antecedência zero                                                             | Somente instantes estritamente posteriores ao relógio da operação                             |
| Reserva aguarda lock e vence a antecedência                                   | Revalidar relógio após lock e rejeitar                                                        |
| Bloqueio/jornada conflita com compromisso                                     | 409 com IDs para administrador; configurações e reservas preservadas                          |
| Cancelar ou reagendar compromisso afetado, tentar configuração com nova chave | Mudança aceita quando não há outros conflitos                                                 |
| Reserva concorre com bloqueio/jornada/desativação                             | Testar ambos os ordenamentos; uma operação vence e a outra revalida, sem reserva incompatível |
| Reagendamento falha                                                           | Compromisso continua ocupando o intervalo original                                            |
| Cancelamento concorre com reagendamento ou resultado                          | Serialização e transição válida única, sem evento duplicado                                   |
| Novo comando para cancelled/attended/no_show                                  | 409; histórico imutável                                                                       |
| Registrar `no_show` antes do início agendado                                  | 409; estado permanece confirmed                                                               |
| Registrar `no_show` a partir do início agendado                               | 200; estado final no_show                                                                     |
| Registrar `attended` antes do término                                         | 409; estado permanece confirmed                                                               |
| Registrar `attended` a partir do término                                      | 200; estado final attended                                                                    |
| Repetição da chave original após cancelamento ou passagem do tempo            | Resposta original, nenhum novo agendamento ou evento                                          |
| Mutação administrativa repetida / chave com corpo diferente                   | Replay sem efeito / 409, respectivamente                                                      |
| Alteração de preço/duração de serviço                                         | Snapshots das reservas existentes preservados                                                 |
| Mudança de fuso invalida compromisso                                          | 409 sem mudar fuso nem instante reservado                                                     |
| Horário civil inexistente / repetido                                          | Nenhum candidato inexistente / instantes distintos com offset explícito                       |
| Tenant ou papel incorreto                                                     | 404 para recurso fora do escopo; 403 para membro sem papel administrativo                     |
| Limite público excedido                                                       | 429 com Retry-After; sem IP bruto em persistência ou logs                                     |

No teste de concorrência, disparar 100 reservas com chaves distintas para um único intervalo e verificar exatamente um sucesso, 99 conflitos e um evento de criação. Isolar/desativar o limite de IP nessa fixture para testar a integridade; testar o throttle separadamente. Medir que cancelamento confirmado volta à consulta em até cinco segundos. Consultas de outros tenants não aguardam o lock do tenant em disputa.

## Execução da integração com banco isolado

Para integração isolada, `yarn test:integration` exige `DATABASE_URL` de testes e `POSTGRES_ADMIN_PASSWORD` compatível para o reset. O comando recomendado `yarn test:e2e` já provisiona o banco e executa ambas as suítes. Os testes limpam tabelas e não devem usar bancos de produção.

Para uma instância local já configurada segundo o README, iniciar `yarn start:dev`. Com o token administrativo de teste em `BARBER_TEST_TOKEN`:

```sh
curl --fail-with-body http://localhost:3000/v1/management/scheduling-settings \
  -H "Authorization: Bearer $BARBER_TEST_TOKEN"

curl --fail-with-body -X PUT http://localhost:3000/v1/management/scheduling-settings \
  -H "Authorization: Bearer $BARBER_TEST_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: quickstart-settings-0001' \
  --data '{"slot_interval_minutes":20,"minimum_advance_minutes":30}'
```

Esperado: 200 com os dois valores; repetir o segundo comando devolve a mesma resposta sem novo efeito. Uma nova alteração precisa de outra chave.

## Consumo manual: configuração e reserva

Usar um tenant de testes autenticado. `BARBER_TEST_TOKEN` contém seu JWT administrativo e `BARBER_TEST_SLUG` o slug da barbearia. Os exemplos usam contatos fictícios. Copiar os UUIDs retornados para as variáveis indicadas; não enviar `tenant_id` nos corpos administrativos.

```sh
curl --fail-with-body -X POST http://localhost:3000/v1/management/professionals \
  -H "Authorization: Bearer $BARBER_TEST_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: quickstart-professional-0001' \
  --data '{"display_name":"Profissional Demo"}'

# Preencher com o id retornado.
export BARBER_TEST_PROFESSIONAL_ID='uuid-do-profissional'

curl --fail-with-body -X POST http://localhost:3000/v1/management/services \
  -H "Authorization: Bearer $BARBER_TEST_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: quickstart-service-0001' \
  --data "{\"name\":\"Corte Demo\",\"duration_minutes\":30,\"price_minor\":5000,\"currency_code\":\"BRL\",\"professional_ids\":[\"$BARBER_TEST_PROFESSIONAL_ID\"]}"

export BARBER_TEST_SERVICE_ID='uuid-do-servico'

curl --fail-with-body -X PUT "http://localhost:3000/v1/management/professionals/$BARBER_TEST_PROFESSIONAL_ID/weekly-periods" \
  -H "Authorization: Bearer $BARBER_TEST_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: quickstart-periods-0001' \
  --data '{"periods":[{"iso_weekday":1,"starts_local_time":"09:00:00","ends_local_time":"12:00:00"},{"iso_weekday":1,"starts_local_time":"13:00:00","ends_local_time":"17:00:00"}]}'

# Escolher uma segunda-feira entre hoje e hoje+30 no fuso da barbearia.
export BARBER_TEST_DATE='AAAA-MM-DD'
curl --fail-with-body --get "http://localhost:3000/v1/public/tenants/$BARBER_TEST_SLUG/availability" \
  --data-urlencode "service_id=$BARBER_TEST_SERVICE_ID" \
  --data-urlencode "date=$BARBER_TEST_DATE"

# Copiar starts_at de um slot retornado, incluindo o offset explícito.
export BARBER_TEST_START_AT='inicio-com-offset-retornado'
curl --fail-with-body -X POST "http://localhost:3000/v1/public/tenants/$BARBER_TEST_SLUG/appointments" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: quickstart-booking-0001' \
  --data "{\"service_id\":\"$BARBER_TEST_SERVICE_ID\",\"starts_at\":\"$BARBER_TEST_START_AT\",\"guest_name\":\"Cliente Demo\",\"guest_phone\":\"+5511999999999\",\"guest_email\":\"cliente@example.test\"}"
```

Esperado: criações 201; jornada 200; disponibilidade com slots ou lista vazia quando não há horário elegível; reserva 201 com confirmação sem contatos de outros convidados. Preço, duração e término não são aceitos do cliente. A reserva revalida grade, antecedência, jornada e conflitos após adquirir o lock.

Para consultar a agenda e cancelar essa reserva:

```sh
export BARBER_TEST_APPOINTMENT_ID='uuid-retornado-na-reserva'
curl --fail-with-body --get http://localhost:3000/v1/management/appointments \
  -H "Authorization: Bearer $BARBER_TEST_TOKEN" \
  --data-urlencode "starts_from=${BARBER_TEST_DATE}T00:00:00-03:00" \
  --data-urlencode "ends_before=${BARBER_TEST_DATE}T23:59:59-03:00" \
  --data-urlencode 'status=confirmed'

curl --fail-with-body -X POST "http://localhost:3000/v1/management/appointments/$BARBER_TEST_APPOINTMENT_ID/cancellation" \
  -H "Authorization: Bearer $BARBER_TEST_TOKEN" \
  -H 'Idempotency-Key: quickstart-cancel-0001'
```

O offset `-03:00` desse exemplo corresponde ao padrão `America/Sao_Paulo`; ajustar os limites ao fuso configurado. A gestão aceita o identificador da confirmação pública ou o ID retornado pela agenda/conflito, com idempotência canônica para o mesmo agendamento. Esperado: cancelamento 200, estado `cancelled`, histórico preservado e intervalo elegível novamente disponível após commit.

Para testar reagendamento, usar **outra reserva confirmed** e POST em `/v1/management/appointments/{id}/rescheduling` com `{"starts_at":"novo-inicio-com-offset"}` e nova chave. Não reutilizar a reserva cancelada. Para resultados, POST em `/outcome` com `{"status":"no_show"}` desde o início, ou `{"status":"attended"}` desde o término. Uma nova mutação contra qualquer estado final retorna 409; replay da chave original devolve a resposta original sem evento adicional. Pausas/folgas são consultadas separadamente em `/v1/management/professionals/{id}/exceptions` com `starts_from`/`ends_before`.

## Telemetria e privacidade

- `IDEMPOTENCY_ENCRYPTION_KEY`: chave AES-GCM própria de 32 bytes em Base64, distinta da chave da outbox; respostas de gestão contêm contatos e são persistidas cifradas. O replay expira em 24 horas; registros expirados são removidos sob lock na próxima mutação do tenant.
- `THROTTLE_HMAC_KEY`: HMAC do IP para os limites públicos de 120 leituras/10 tentativas de reserva por minuto e tenant; replay também consome tentativa. `TRUSTED_PROXY_CIDRS` controla os proxies confiáveis.
- Endpoints OTLP opcionais em `.env.example` exportam traces e métricas; não há endpoint `/metrics` nesta API. Logs/spans usam categorias fixas, correlação e tenant; não registram contato, IP bruto, chave idempotente, URL ou corpo.
- O histograma `scheduling_request_duration_seconds`, com buckets de 0,005 a 30 segundos e bucket de overflow, permite calcular p95 no backend de métricas. O snapshot de diagnóstico local estima p95 pelo limite superior do bucket, com memória limitada e sem armazenar amostras.
- `scheduling_request`, `scheduling_conflict`, `scheduling_throttled`, `scheduling_replay` e `scheduling_transition` usam apenas `operation`/`outcome` com valores enumerados. Tenant, UUID, slug, chave, IP e contatos nunca são labels. Transições/replay são contados após commit, sem duplicar transições no replay. Não há SLA de latência definido.

## Ensaio SQL e evidências técnicas

```sh
sh scripts/check-scheduling-release.sh
```

O ensaio usa o baseline independente `4bf8c9d77583faee8859ca75e99f58ebeda1488c` (revisão `001-tenant-authentication-v3`), obtido do histórico Git, e cria um PostgreSQL 18.6 descartável com um tenant fictício anterior ao release. A porta padrão é 55434 (`RELEASE_DB_PORT` pode alterá-la). O script não lê `DATABASE_URL` e remove o ambiente ao terminar.

Resultado observado em 2026-10-19:

| Etapa                            | Evidência                                                                                                           | Resultado |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- |
| Baseline                         | Assertions da revisão anterior e tenant existente                                                                   | PASS      |
| `up.sql` + `verify.sql`          | Revisão `002-appointment-scheduling-v1`, settings 15/30 preenchidos para tenant anterior                            | PASS      |
| Equivalência com bootstrap limpo | Colunas por nome/tipo/default, constraints, índices, owners, grants de tabelas/schemas, funções, triggers e revisão | PASS      |
| `rollback.sql`                   | Catálogos equivalentes ao baseline, revisão anterior e tenant preservados                                           | PASS      |
| Reaplicação + `verify.sql`       | Equivalência novamente com bootstrap atual                                                                          | PASS      |

O rollback remove definitivamente os dados do schema `scheduling` e a configuração de fuso; `btree_gist` fica instalado. A comparação semântica ignora a ordem física das colunas e essa extensão residual, cuja necessidade no upgrade é assegurada pelas constraints GiST. O hash canônico de bootstrap continua em `database/schema/schema.sha256`; `yarn schema:check` o confere contra um banco limpo.

Validação final `yarn ci:check` executada em 2026-10-19, após os ajustes desta fase:

| Gate                    | Resultado observado                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Lint, tipos e build     | PASS                                                                                                    |
| Unitários e arquitetura | 17 arquivos, 58 testes aprovados                                                                        |
| Contratos               | 5 arquivos, 14 testes aprovados; tipos OpenAPI sincronizados                                            |
| Schema                  | Bootstrap limpo sem drift; SHA-256 `1fd064900bcdb245f6e03330563b10c9b1e3ab223c8875b439ab2a5f249774f2`   |
| Integração PostgreSQL   | 14 arquivos, 40 testes aprovados                                                                        |
| E2E HTTP                | 8 arquivos, 39 testes aprovados; inclui liberação após cancelamento em menos de cinco segundos (SC-006) |

T059–T064 estão concluídas. O ensaio SQL acima é separado da CI e requer o histórico do baseline; todos os comandos foram executados em ambientes descartáveis. Nenhum banco de produção foi usado.

## Ensaio com consumidor: SC-003/SC-004 (pendente)

Não foi disponibilizado consumidor com participantes representativos para o ensaio. Amostra: **0 participantes**; duração das tarefas: **não medida**; percentual de reservas em até três minutos: **não calculado**. SC-003 e SC-004 **não estão aprovados**. Os testes automatizados HTTP e de integridade não substituem esse ensaio.

Para concluir T065, executar com um consumidor real da API e registrar data, versão, tipo de consumidor, amostra, sucesso e duração por participante usando identificadores anônimos. Medir desde o início da busca até a confirmação da reserva e desde o início da configuração até serviço/jornada disponíveis. Aprovação exige pelo menos 90% das reservas em até três minutos e configuração do responsável em até cinco minutos. Registrar falhas e limitações observadas, sem nome, telefone, e-mail ou token dos participantes.


## Incremento v2: auditoria administrativa

FR-023/SC-009 foram implementados nas tarefas T066–T089. Os PASS anteriores pertencem exclusivamente à revisão v1; evidências do incremento v2 estão ao fim desta seção. O contrato interno está em [contracts/configuration-audit.md](contracts/configuration-audit.md); não há novo endpoint HTTP. A consulta operacional e seu teste exigem o cliente `psql` no PATH.

### Preparação e fluxo com duas barbearias

1. Em banco descartável, aplicar a base v1 e depois `database/releases/002-appointment-scheduling-audit/up.sql` e `verify.sql`; verificar a revisão `002-appointment-scheduling-v2`. Comparar com bootstrap limpo v2. Usar somente dados fictícios.
2. Criar dois tenants e administradores distintos. Preparar login PostgreSQL individual de suporte, sem owner/runtime/SUPERUSER/BYPASSRLS/CREATEROLE, membro de `barber_audit_reader`. A operação privilegiada concede temporariamente apenas o tenant A em `configuration_audit_access`; não conceder acesso pelo próprio login leitor. Credenciais e concessões não ficam versionadas.
3. Executar as nove mutações listadas no contrato interno usando as rotas administrativas existentes: serviço, profissional, jornada, exceção, fuso e settings. Confirmar um evento por mudança efetiva com tenant/ator, recurso, instante e diff esperado. Confirmar criação com anterior nulo e exclusão com novo nulo.
4. Repetir cada comando com a mesma chave; confirmar resposta original e nenhuma duplicação. Enviar atualização sem mudança ou apenas reordenação de conjuntos/jornadas; confirmar ausência de novo evento. Uma chave expirada segue a regra de novo comando, sem apagar eventos anteriores.
5. Provocar conflito de configuração, falha ao inserir evento e falha ao salvar idempotência em testes com injeção controlada; confirmar rollback integral e ausência de evento de mudança concluída. Não induzir falhas em produção.
6. Conectar como login real de suporte, consultar tenant A e depois B; somente A retorna linhas. Omitir propositalmente o filtro de tenant para provar RLS; expirar/revogar a concessão e confirmar ausência de linhas nas novas instruções. Testar usuário sem papel e tentativas de escrita/leitura com runtime.
7. Incluir e-mail/telefone/segredo fictícios em campos livres para validar redação, sem originais persistidos na auditoria ou telemetria. Não exportar resultados para logs compartilhados.

### Consulta interna de exemplo

Em uma conexão `psql` com login de suporte autorizado e variáveis `audit_tenant_id`, `audit_from` e `audit_before` definidas para o teste:

```sql
SELECT id, tenant_id, actor_membership_id, operation, resource_type,
       resource_id, occurred_at, changes
FROM scheduling.configuration_events
WHERE tenant_id = :'audit_tenant_id'::uuid
  AND occurred_at >= :'audit_from'::timestamptz
  AND occurred_at < :'audit_before'::timestamptz
ORDER BY occurred_at, id
LIMIT 100;
```

Esperado: apenas mudanças do tenant autorizado no intervalo, sem contatos de clientes ou segredos; demais filtros e cursor estão definidos no contrato interno. O filtro SQL não concede acesso: RLS exige concessão vigente para o login original da sessão. Conceder/revogar acesso é atribuição operacional, não do runtime nem do suporte leitor.

### Comandos e gates do incremento

Executar a partir da raiz:

```sh
yarn ci:check
sh scripts/check-scheduling-release.sh
```

O ensaio valida autenticação → v1 → v2 com dados de agenda/eventos existentes, grants/RLS, revisão/readiness, equivalência com bootstrap v2, rollback v2 → v1 e reaplicação. A prova v1 → autenticação é executada separadamente, preservando os SQL históricos v1. O papel coletivo de leitura permanece após rollback, sem acesso ao schema/trilha removidos.

O rollback incremental remove a nova auditoria e as concessões, preservando a agenda v1; requer interrupção de escritas e preservação protegida dos eventos quando necessária. Não existe reconstrução automática do histórico removido, nem auditoria retroativa de alterações anteriores à ativação v2. Não aplicar rollback que apague histórico necessário sem procedimento operacional aprovado.

T065/SC-003/SC-004 continuam pendentes conforme a seção de ensaio com consumidor; nenhum SQL deste trabalho foi aplicado em produção.


### Concessão e revogação operacional

A operação provisiona um login individual sem SUPERUSER/BYPASSRLS/CREATEROLE e sem membership de owner/runtime; fornece autenticação segura separadamente, com conexão em trânsito protegida no ambiente operacional. O login recebe membership de `barber_audit_reader` e CONNECT no banco conforme a política do ambiente. Não versionar credenciais nem usar a credencial de owner para consulta rotineira.

Em uma sessão operacional privilegiada, com `audit_principal` e `audit_tenant_id` definidos no `psql` para o atendimento autorizado:

```sql
INSERT INTO scheduling.configuration_audit_access
  (principal_name,tenant_id,granted_at,expires_at,granted_by,reason_code)
VALUES (:'audit_principal',:'audit_tenant_id'::uuid,statement_timestamp(),
        statement_timestamp()+interval '1 hour',session_user,'support')
ON CONFLICT (principal_name,tenant_id) DO UPDATE
SET granted_at=EXCLUDED.granted_at,expires_at=EXCLUDED.expires_at,
    granted_by=EXCLUDED.granted_by,reason_code=EXCLUDED.reason_code;
```

Conectar como o login leitor e executar a consulta de [database/operations/query-configuration-audit.sql](../../database/operations/query-configuration-audit.sql) com as variáveis de período/tenant; filtros opcionais: `audit_resource_type`, `audit_resource_id`, `audit_limit`, `audit_cursor_at` e `audit_cursor_id`. O próximo cursor é o instante/ID da última linha. A consulta não ganha autorização ao informar UUID ou variável de sessão; o login sem concessão vigente recebe zero linhas.

Ao terminar, a operação revoga a concessão na sessão privilegiada:

```sql
DELETE FROM scheduling.configuration_audit_access
WHERE principal_name=:'audit_principal' AND tenant_id=:'audit_tenant_id'::uuid;
```

A revogação/expiração é observada nas novas instruções; uma consulta em execução usa seu snapshot. Para interrupção imediata, a operação encerra as sessões desse login segundo o procedimento do ambiente. Remover concessões antes de excluir/reutilizar o nome do login. Motivos operacionais permitidos: `support`, `incident` e `verification`.

### Evidências v2 em ambiente descartável

- Testes novos foram escritos antes dos componentes; primeiras execuções unitária e contratual falharam pela ausência da implementação.
- Integração PostgreSQL completa: 17 arquivos e 48 testes aprovados, incluindo RLS com login real de suporte, paginação SQL, expiração/revogação, rollback de append/save e concorrência de configuração.
- E2E específico da auditoria: nove mutações via HTTP, replay/no-op sem duplicação, preservação do ID removido, redação de campos livres e rejeição de membro; aprovado.
- `sh scripts/check-scheduling-release.sh`: aprovado para upgrade v1 → v2, bootstrap equivalente com grants/RLS, dados v1 preservados, rollback incremental/original e reaplicação. Nenhum backfill administrativo fictício.
- `yarn ci:check` aprovado em 2026-10-19: lint, tipos e build; 18 arquivos/61 testes unitários e arquiteturais; 6 arquivos/16 testes de contrato; tipos OpenAPI sincronizados; schema sem drift; 17 arquivos/48 testes de integração PostgreSQL; 9 arquivos/40 testes E2E HTTP.
- Schema v2 SHA-256: `fac94faa515c47b90cee0d214f67ae851402730cb0420755360dc96ab7bf5b86`.
- Formatação dos arquivos TypeScript alterados verificada com Prettier; `git diff --check` e links locais dos documentos verificados. T066–T089 concluídas; T065 permanece pendente.


## Correções de convergência — T090–T092

### T090: proteção conservadora dos textos livres

A trilha agora redige integralmente `name`, `display_name`, `description` e `reason`, inclusive credenciais sem prefixo ou rótulo reconhecível. Valores não nulos usam `[REDACTED]` com `redacted: true`; valores estruturados, nulos e indicação da mudança são preservados. O diff é calculado antes da redação, sem copiar o texto original para a trilha. Isso evita depender de uma lista incompleta de formatos de segredo.

Regressão unitária reproduziu o vazamento de credencial sintética `ghp_…` antes da correção; depois, os quatro testes unitários da auditoria passaram. A integração de privacidade passou com credenciais sintéticas de token, chave privada e valor opaco nos textos anteriores/novos, sem originais na trilha, erros ou telemetria. Nenhum segredo real foi usado.

### T091: proteção de todos os agendamentos confirmados

A verificação de conflitos deixou de excluir compromissos cujo início já ocorreu. Bloqueios, jornadas, fuso, desativação e remoção de elegibilidade consideram todos os confirmados afetados, preservando snapshots e o lock/transação da barbearia.

Três regressões PostgreSQL falharam antes da correção (em andamento, limite de início e anterior ainda confirmado). Depois da correção, os cinco testes de configuração/concorrência passaram. Cada regressão cobre as seis alterações administrativas, 409 com IDs autorizados, preservação integral e ausência de auditoria de mudança rejeitada; após cancelar o compromisso na fixture, nova tentativa de bloqueio é aceita e auditada.

### T092: fechamento em lacuna de horário civil

Um fechamento inexistente não descarta mais toda a jornada. Os candidatos anteriores permanecem sujeitos à duração decorrida completa, grade ancorada e comparação do término civil com o fechamento configurado; horários inexistentes e términos após o salto que ultrapassem o fechamento continuam rejeitados. Não houve alteração de schema ou de contrato HTTP.

A regressão falhou nos testes unitário e PostgreSQL antes da correção: jornada 01:00–02:30 em `America/New_York`, 2024-03-10, retornava zero opções. Após a correção, os onze testes unitários de disponibilidade/fuso e os seis testes PostgreSQL de reserva/concorrência passaram. A consulta oferece 01:00–01:30 com offset -05:00, a confirmação aceita o mesmo intervalo e remove-o da disponibilidade; 01:30 com término além do fechamento e 02:00 inexistente não são confirmados. O teste de abertura inexistente mantém grade e duração para opções válidas posteriores ao salto.

### Validação final da convergência

`yarn ci:check` aprovado em 2026-10-19 após T090–T092: lint, tipos, build, 18 arquivos/65 testes unitários e arquiteturais, 6 arquivos/16 testes de contrato, OpenAPI sincronizado, schema sem drift, 17 arquivos/53 testes de integração PostgreSQL e 9 arquivos/40 testes E2E HTTP — 174 testes aprovados. Prettier dos arquivos TypeScript alterados, links locais e `git diff --check` também passaram.

As correções não alteraram schema nem contratos HTTP. T090–T092 concluídas; T065/SC-003/SC-004 continuam pendentes do ensaio com consumidor e participantes. Validações usaram somente ambientes descartáveis, sem deploy ou alteração de banco de produção.
