# Plano de Implementação: Agendamento de Serviços

**Branch**: `002-appointment-scheduling` | **Data**: 2026-10-19 | **Especificação**: [spec.md](spec.md)

**Entrada**: Especificação em `/specs/002-appointment-scheduling/spec.md`

## Resumo

Adicionar um módulo de agendamento ao monólito modular existente. A agenda pública consulta serviços e horários até 30 dias à frente e permite reservas de convidados com nome, telefone e e-mail. O responsável autenticado configura catálogo, profissionais e jornadas, acompanha a agenda e registra cancelamentos, atendimentos e não comparecimentos. A disponibilidade é calculada pela jornada local recorrente, duração do serviço, exceções e reservas existentes; o banco impede sobreposição concorrente por profissional. O intervalo entre inícios é configurável (padrão 15 minutos) e a antecedência mínima também (padrão 30, permitindo zero). Estados finais não podem ser reabertos. FR-023 acrescenta auditoria administrativa de serviços, profissionais e configurações, com valores anteriores/novos, persistência atômica e consulta interna autorizada por barbearia, sem novo endpoint.

A implementação usa NestJS/Fastify, contratos OpenAPI, TypeScript e PostgreSQL. O schema continua controlado exclusivamente por SQL versionado. Cada tenant existente representa uma barbearia; novas tabelas do contexto ficam no schema PostgreSQL `scheduling`, e a zona IANA da barbearia fica em `tenancy.tenants`.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6.0.x estrito em Node.js 24.x LTS, ESM/NodeNext

**Dependências Principais**: NestJS 12.1.x, Fastify 5.12.x, Zod 4.6.x, `pg` 8.23.x, `yaml` 2.9.x e `openapi-typescript` 7.13.x; sem ORM ou serviço externo de agendamento

**Armazenamento**: PostgreSQL 18.6; snapshot canônico em `database/schema/*.sql`, release v1 preservado em `database/releases/002-appointment-scheduling/{up,verify,rollback}.sql` e incremento em `database/releases/002-appointment-scheduling-audit/{up,verify,rollback}.sql` para revisão `002-appointment-scheduling-v2`; sem DDL no startup

**Testes**: Vitest 5; testes unitários de cálculo de disponibilidade, testes de integração PostgreSQL para constraints/concorrência/isolamento e E2E Fastify + PostgreSQL real; verificação OpenAPI e de drift do schema na CI

**Plataforma Alvo**: Containers Linux OCI, Docker Compose no desenvolvimento e em E2E; serviço NestJS e PostgreSQL já existentes

**Tipo de Projeto**: Serviço web REST em monólito modular

**Metas de Desempenho**: Correção com até 100 solicitações concorrentes disputando o mesmo intervalo: exatamente uma reserva confirmada. A especificação não estabelece SLA de latência ou disponibilidade; validar também liberação após cancelamento em até cinco segundos (SC-006); medir p95 nas rotas públicas e rever limites com tráfego real, sem prometer um SLO nesta entrega.

**Restrições**: Isolamento por tenant em toda leitura e escrita; reservas de convidados sem conta; nome, telefone e e-mail obrigatórios; janela móvel de 30 dias no fuso da barbearia; estados `confirmed`, `cancelled`, `attended` e `no_show`; horários recorrentes locais convertidos para instantes UTC; nenhuma cadeira física como recurso independente; migrations/ORM proibidos; PII nunca em logs; auditoria administrativa append-only, sem contatos de clientes/segredos; suporte com acesso temporário por tenant e sem credenciais do runtime

**Escala/Escopo**: MVP multi-tenant limitado a uma barbearia por tenant, profissionais e serviços sem limite fixado pela especificação, reservas públicas para os próximos 30 dias e histórico de compromissos sem política de expurgo definida. Não criar partições ou caches antes de medir volume real.

## Verificação da Constituição

*PORTÃO: aprovado antes da Fase 0 e reavaliado após o projeto da Fase 1.*

| Princípio | Evidência prevista | Resultado |
|---|---|---|
| I. Isolamento Multi-Tenant | Todas as entidades novas carregam `tenant_id`; o tenant vem da sessão nas rotas administrativas ou do slug público validado nas rotas de reserva; queries, FKs e constraints incluem o tenant; leitura interna da auditoria usa permissões por login/tenant com expiração e RLS | Aprovado |
| II. Integridade da Agenda | Instantes explícitos; recorrência interpretada no fuso IANA do tenant; durações e intervalos validados; lock por tenant serializa mutações de configuração e reservas; constraint de exclusão PostgreSQL impede sobreposição; reagendamento é transacional e auditável | Aprovado |
| III. Contratos de API Explícitos | Contrato OpenAPI 3.1 versionado para rotas públicas e administrativas, com validação, autenticação e respostas de conflito/erro | Aprovado |
| IV. Segurança e Privacidade por Padrão | Rotas de gestão exigem sessão administrativa ativa; rotas públicas validam entrada e escopo; contato de convidado é acessível apenas à barbearia proprietária e não aparece em logs nem erros | Aprovado |
| V. Qualidade Verificável e Observabilidade | Unitários para disponibilidade; PostgreSQL real para integridade, concorrência e tenant; E2E HTTP e contrato; transições de agendamentos e mudanças administrativas registram ator, instante, tenant e correlação; testes de auditoria provam atomicidade, replay, privilégios e isolamento | Aprovado |
| Fluxo e idioma | Artefatos SDD em português; implementação seguirá TDD e fronteiras de domínio/aplicação/infraestrutura | Aprovado |
| Schema por SQL | Schema e release por SQL revisado, versão de manifesto, grants mínimos e detecção de drift; aplicação sem DDL | Aprovado |

### Reavaliação após o projeto

O modelo e o contrato mantêm o tenant como escopo obrigatório e separam operações públicas de convidado das operações protegidas de gestão. A constraint de intervalo, o lock transacional por tenant compartilhado entre reservas e mudanças de configuração, a transação de reagendamento e os testes PostgreSQL cobrem concorrência. Todas as mutações exigem chave de idempotência; somente `confirmed` admite transição e reagendamento; `no_show` é permitido desde o início agendado e `attended` desde o término. FR-014 rejeita integralmente mudanças conflitantes. O fuso local está separado dos instantes UTC. O projeto atualizado atende à exigência constitucional de auditoria por meio de `scheduling.configuration_events`, com escrita na mesma transação de configuração e idempotência. A consulta interna usa papel de leitura sem privilégios elevados, autorização temporária por tenant e RLS; o runtime recebe somente INSERT nessa nova trilha. O portão de projeto está aprovado. T066–T089 foram implementadas; CI e ensaio SQL v2 passaram em banco descartável, conforme `quickstart.md`. O aceite técnico da auditoria não aprova SC-003/SC-004, ainda dependentes de T065. Não há exceção constitucional proposta.

## Estrutura do Projeto

### Documentação desta funcionalidade

```text
specs/002-appointment-scheduling/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   └── configuration-audit.md
├── tasks.md
└── checklists/requirements.md
```

### Código-fonte

```text
src/modules/scheduling/
├── domain/
├── application/
│   ├── ports/
│   ├── services/
│   └── use-cases/
├── infrastructure/
│   ├── http/
│   └── persistence/
└── scheduling.module.ts

database/
├── schema/
│   ├── 001_extensions.sql
│   ├── 010_schemas.sql
│   ├── 020_tables.sql
│   ├── 030_constraints.sql
│   ├── 040_indexes.sql
│   ├── 050_configuration_audit_policies.sql
│   └── 090_schema_manifest.sql
├── releases/002-appointment-scheduling/{up,verify,rollback}.sql
└── releases/002-appointment-scheduling-audit/{up,verify,rollback}.sql

test/
├── unit/scheduling/
├── integration/scheduling/
├── contract/scheduling.contract.spec.ts
└── e2e/appointments.e2e-spec.ts
```

**Decisão de Estrutura**: Um único módulo `scheduling` possui catálogo, profissionais, jornadas, exceções e agendamentos. Entidades de negócio e regras de disponibilidade não dependem de NestJS ou `pg`; adapters HTTP e PostgreSQL implementam portas da aplicação. A barbearia reutiliza `tenancy.tenants`; não será introduzido um segundo conceito de tenant ou um schema separado para cada contexto de agendamento.

## Acompanhamento de Complexidade

Não há exceções à constituição. A trilha administrativa é separada dos eventos de agendamento e dos eventos de segurança de autenticação. A autorização de suporte adiciona uma tabela operacional de concessões e políticas RLS apenas para a nova auditoria; não altera o modelo de autenticação dos consumidores HTTP. O custo adicional evita conceder leitura irrestrita ou depender de filtros manuais de tenant.

## Execução das fases

- **Base existente**: `tasks.md` declara T001–T064 concluídas; `quickstart.md` preserva resultados observados para a revisão v1. A base já contém autorização `administrator`, verificadores dos dois contratos, telemetria e release SQL. Este planejamento não executou novamente essas verificações e não certifica a implementação existente.
- **Fase 0 atualizada**: `research.md` documenta a escolha da trilha administrativa, integração ao callback transacional, acesso interno e evolução v1 → v2. Fontes locais: `ManageConfigurationUseCases`, `IdempotentMutationService`, writer de segurança existente, schema/grants e ensaio SQL. Não há desconhecidos técnicos bloqueantes.
- **Fase 1 atualizada**: `data-model.md`, `contracts/configuration-audit.md` e `quickstart.md` cobrem FR-023/SC-009. O contrato HTTP existente permanece compatível, com as mesmas operações, schemas e respostas; não será criada rota de auditoria.
- **Tarefas atualizadas**: `tasks.md` acrescenta T066–T089 para auditoria, preserva as marcações T001–T065 e corrige o exemplo sequencial T041–T046 e a contagem US1 de T025 (dez cenários). T066–T089 foram concluídas e validadas; o incremento não foi implantado em produção. T065 continua pendente de consumidor/participantes e não bloqueia o incremento técnico.
- **Integração implementada**: `ConfigurationAuditWriter` em `application/ports/configuration-audit-writer.ts`, projeção/diff tipados em `application/services/configuration-audit.service.ts` e adapter em `infrastructure/persistence/configuration-event.repository.ts`. `ManageConfigurationUseCases` lê o estado anterior após o lock e escreve o evento somente no callback de nova mutação, usando `TransactionContext` e o relógio recebido de `IdempotentMutationService`. As dependências estão registradas em `scheduling.module.ts`; a escrita não usa conexão independente.
- **Sequência técnica do incremento**: testes falhando → schema/ACL/RLS/privilégios → projeção e writer transacional → integração das nove mutações de configuração → contrato interno e testes E2E → verificação do release incremental/rollback/reaplicação → CI e registro de resultados. Alterações de `manage-configuration.use-cases.ts`, módulo e schema exigem execução sequencial.
- **Release implementado**: SQL v1 preservado e release incremental com pré-condição v1 e destino v2. Bootstrap canônico, manifesto/hash, assertions, grants, readiness e ambos os Compose atualizados. O ensaio SQL executa autenticação → v1 → v2, upgrade com dados v1 e equivalência ao bootstrap v2. Eventos passados não são reconstruídos; cobertura administrativa começa na ativação v2.
- **Validação concluída**: unitários de projeção/redação/diff; integração PostgreSQL de auditoria atômica, falha do INSERT, falha ao salvar idempotência, replay concorrente e após expiração, RLS e concessões expiradas/revogadas; E2E das nove mutações e ausência de endpoint; validações estáticas/contratos/schema e ensaio SQL v2. Essas provas foram executadas e aprovadas na implementação de T066–T089; resultados estão no quickstart.

- **Convergência implementada**: T090–T092 concluídas com redação integral dos campos livres na auditoria, proteção de todos os compromissos confirmados nas mudanças de configuração e preservação de opções válidas quando o fechamento cai em lacuna civil. Regressões reproduziram os desvios antes das correções; CI final com 174 testes aprovada, conforme `quickstart.md`. T065 permanece pendente.

## Rastreabilidade da validação

| Requisitos | Evidência prevista |
|---|---|
| FR-001 a FR-004, FR-014 | Catálogo, elegibilidade, jornadas, bloqueios e rejeição atômica de conflitos |
| FR-005 a FR-010, FR-016 a FR-018 | Disponibilidade, convidado, atribuição, concorrência e privacidade |
| FR-011 a FR-013 | Isolamento, agenda administrativa, cancelamento e reagendamento |
| FR-015, FR-020 a FR-022 | Fuso, limite de 30 dias, intervalo configurável e antecedência revalidada |
| FR-019 | Transições finais imutáveis e replay sem duplicar eventos |
| FR-023, SC-009 | Trilha administrativa por recurso, autorização interna, atomicidade, replay, redação, release incremental e testes descritos no contrato interno; T066–T089 concluídas; resultados no quickstart |
| SC-001 a SC-008 | Casos do quickstart; SC-003/004 exigem ensaio com consumidor da API, pois não há frontend neste escopo |
