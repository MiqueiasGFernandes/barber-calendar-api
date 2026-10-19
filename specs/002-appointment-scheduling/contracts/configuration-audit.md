# Contrato Interno: Auditoria Administrativa

**Requisitos**: FR-023, SC-009 e cenário 7 da História 2.
**Estado**: implementado no incremento v2; resultados de validação no quickstart.

## Fronteiras

O contrato HTTP permanece em [openapi.yaml](openapi.yaml), com as mesmas 22 operações existentes (três públicas, quinze de configuração e quatro de gestão de agendamentos). Nenhuma rota de leitura de auditoria será criada. As nove mutações de configuração passam a exigir persistência atômica do evento quando houver mudança efetiva; seus schemas, status e respostas de sucesso permanecem iguais. Falha de persistência usa o tratamento existente de erro interno sem SQL, dados sensíveis ou resposta de sucesso parcial.

Eventos de agendamentos permanecem em `appointment_events`. O modelo completo da nova trilha e das concessões está em [data-model.md](../data-model.md).

## Escrita pela aplicação

`ConfigurationAuditWriter.append` recebe contexto transacional e evento tipado; não abre transação, não efetua commit nem recebe credencial própria. Tenant e ator vêm da sessão administrativa validada; instante vem do relógio da mutação após o lock; ID/correlação vêm do servidor. A aplicação lê o estado anterior da persistência, calcula o estado efetivamente salvo e produz o diff; não confia no corpo como representação do estado anterior.

| Operação HTTP existente | Recurso auditado | Campos de domínio permitidos |
|---|---|---|
| `createService` | `service`, UUID criado | name, description, duration_minutes, price_minor, currency_code, status, professional_ids |
| `updateService` | `service`, UUID existente | Os mesmos campos, incluindo ativação/desativação e substituição de elegibilidade |
| `createProfessional` | `professional`, UUID criado | display_name, status |
| `updateProfessional` | `professional`, UUID existente | display_name, status |
| `replaceWeeklyWorkPeriods` | `weekly_periods`, UUID do profissional | periods: lista ordenada de iso_weekday, starts_local_time e ends_local_time |
| `createAvailabilityException` | `availability_exception`, UUID criado | professional_id, kind, starts_at, ends_at, reason |
| `deleteAvailabilityException` | `availability_exception`, UUID removido | Campos anteriores da exceção removida, novo valor nulo |
| `updateTenantTimeZone` | `time_zone`, UUID do tenant | time_zone |
| `updateSchedulingSettings` | `tenant_settings`, UUID do tenant | slot_interval_minutes, minimum_advance_minutes |

Campos não listados não são serializados. Os campos livres `name`, `display_name`, `description` e `reason` são integralmente redigidos na trilha, pois podem conter credenciais de qualquer formato: valores não nulos recebem `[REDACTED]` e `redacted: true`, sem cópia original. Valores estruturados continuam disponíveis; ausência/nulo é preservada. Essa política se aplica à trilha: não altera o conteúdo dos recursos de negócio nem o replay cifrado já previsto, e não duplica os originais na auditoria. Não guardar request bruto, Authorization, cookies, contatos de convidados, IP, resposta idempotente, chave bruta ou hash da chave. Normalizar conjuntos/jornadas e valores equivalentes antes de comparar; calcular a mudança antes da redação e manter sua indicação mesmo se before/after forem ambos redigidos.

Uma mudança efetiva do agregado produz um evento com operation_id único e todos os campos alterados. Comando sem efeito mantém sua resposta contratual e pode ter resultado idempotente, mas não cria evento de mudança. Replay dentro das 24 horas retorna a resposta anterior sem executar a escrita. Após a expiração, não há promessa de replay da operação antiga; tratar como novo comando conforme a política existente. Eventos já gravados não expiram com a idempotência.

Configuração, evento e resultado idempotente pertencem à mesma transação. Falha em qualquer gravação reverte as três partes; conflito de domínio não gera evento de alteração concluída. Transações concorrentes usam o lock de `scheduling.tenant_settings`, já compartilhado pelas reservas.

## Consulta operacional SQL

Entrada da consulta: tenant UUID obrigatório, `occurred_from` inclusivo, `occurred_before` exclusivo, `resource_type`/`resource_id` opcionais, limite entre 1 e 100 (padrão 100) e cursor opcional `(occurred_at, id)` do último registro. Exigir início menor que fim. Ordenar ascendentemente por instante/ID e buscar a página seguinte estritamente após o cursor. UUID/instante do cursor não substituem autorização.

A identidade é `session_user` da conexão PostgreSQL autenticada; concessão vigente por tenant é verificada por RLS, inclusive se o filtro da consulta for omitido. Um login sem papel de leitura recebe negação de privilégio; login leitor sem concessão para o tenant recebe zero linhas. O leitor não acessa agendamentos, idempotência ou contatos por meio deste contrato e não altera eventos/concessões. Owners/superusuários são credenciais operacionais de emergência, não credenciais de consulta rotineira.

Saída: campos documentados de `configuration_events`, com valores redigidos quando necessário. Não expor a consulta por HTTP, logs, dashboard público ou telemetria. A operação concede acesso identificado e com prazo, revoga-o ao fim do atendimento e não compartilha credenciais do runtime. O cadastro/expiração/revogação dos acessos é administrativo e não cria nova operação de produto.

## Aceite do incremento

- Cada uma das nove mutações com mudança efetiva grava exatamente um evento correto; testar também criação, remoção, arrays reordenados e atualização idêntica.
- Falha do INSERT de auditoria ou do armazenamento idempotente preserva configuração anterior e não deixa evento/resposta de sucesso persistidos.
- Replay concorrente/serial não duplica evento; limpeza de idempotência não apaga auditoria.
- Ator de outro tenant falha na FK; logins de suporte reais só leem tenants concedidos. Testar consulta sem filtro, concessão expirada/revogada e tentativas de assumir owner/runtime.
- Runtime não consegue SELECT/UPDATE/DELETE/TRUNCATE na trilha; suporte não consegue inserir/alterar/remover eventos ou concessões.
- Contatos e segredos em campos livres não são persistidos na trilha nem vazados em erros/logs.
- Contrato HTTP permanece compatível e não há nova rota de consulta; manter testes existentes e verificar ausência de rota de auditoria.
- Upgrade v1 → v2 preserva agenda/eventos anteriores; bootstrap v2 é equivalente; rollback/reaplicação em banco descartável têm resultados registrados antes de aprovar o incremento.
