# Plano de Implementação: Agendamento de Serviços

**Branch**: `002-appointment-scheduling` | **Data**: 2026-10-19 | **Especificação**: [spec.md](spec.md)

**Entrada**: Especificação em `/specs/002-appointment-scheduling/spec.md`

## Resumo

Adicionar um módulo de agendamento ao monólito modular existente. A agenda pública consulta serviços e horários até 30 dias à frente e permite reservas de convidados com nome, telefone e e-mail. O responsável autenticado configura catálogo, profissionais e jornadas, acompanha a agenda e registra cancelamentos, atendimentos e não comparecimentos. A disponibilidade é calculada pela jornada local recorrente, duração do serviço, exceções e reservas existentes; o banco impede sobreposição concorrente por profissional. O intervalo entre inícios é configurável (padrão 15 minutos) e a antecedência mínima também (padrão 30, permitindo zero). Estados finais não podem ser reabertos.

A implementação usa NestJS/Fastify, contratos OpenAPI, TypeScript e PostgreSQL. O schema continua controlado exclusivamente por SQL versionado. Cada tenant existente representa uma barbearia; novas tabelas do contexto ficam no schema PostgreSQL `scheduling`, e a zona IANA da barbearia fica em `tenancy.tenants`.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6.0.x estrito em Node.js 24.x LTS, ESM/NodeNext

**Dependências Principais**: NestJS 12.1.x, Fastify 5.12.x, Zod 4.6.x, `pg` 8.23.x, `yaml` 2.9.x e `openapi-typescript` 7.13.x; sem ORM ou serviço externo de agendamento

**Armazenamento**: PostgreSQL 18.6; snapshot canônico em `database/schema/*.sql`, release operacional em `database/releases/002-appointment-scheduling/{up,verify,rollback}.sql`; sem DDL no startup

**Testes**: Vitest 5; testes unitários de cálculo de disponibilidade, testes de integração PostgreSQL para constraints/concorrência/isolamento e E2E Fastify + PostgreSQL real; verificação OpenAPI e de drift do schema na CI

**Plataforma Alvo**: Containers Linux OCI, Docker Compose no desenvolvimento e em E2E; serviço NestJS e PostgreSQL já existentes

**Tipo de Projeto**: Serviço web REST em monólito modular

**Metas de Desempenho**: Correção com até 100 solicitações concorrentes disputando o mesmo intervalo: exatamente uma reserva confirmada. A especificação não estabelece SLA de latência ou disponibilidade; validar também liberação após cancelamento em até cinco segundos (SC-006); medir p95 nas rotas públicas e rever limites com tráfego real, sem prometer um SLO nesta entrega.

**Restrições**: Isolamento por tenant em toda leitura e escrita; reservas de convidados sem conta; nome, telefone e e-mail obrigatórios; janela móvel de 30 dias no fuso da barbearia; estados `confirmed`, `cancelled`, `attended` e `no_show`; horários recorrentes locais convertidos para instantes UTC; nenhuma cadeira física como recurso independente; migrations/ORM proibidos; PII nunca em logs

**Escala/Escopo**: MVP multi-tenant limitado a uma barbearia por tenant, profissionais e serviços sem limite fixado pela especificação, reservas públicas para os próximos 30 dias e histórico de compromissos sem política de expurgo definida. Não criar partições ou caches antes de medir volume real.

## Verificação da Constituição

*PORTÃO: aprovado antes da Fase 0 e reavaliado após o projeto da Fase 1.*

| Princípio | Evidência prevista | Resultado |
|---|---|---|
| I. Isolamento Multi-Tenant | Todas as entidades novas carregam `tenant_id`; o tenant vem da sessão nas rotas administrativas ou do slug público validado nas rotas de reserva; queries, FKs e constraints incluem o tenant | Aprovado |
| II. Integridade da Agenda | Instantes explícitos; recorrência interpretada no fuso IANA do tenant; durações e intervalos validados; lock por tenant serializa mutações de configuração e reservas; constraint de exclusão PostgreSQL impede sobreposição; reagendamento é transacional e auditável | Aprovado |
| III. Contratos de API Explícitos | Contrato OpenAPI 3.1 versionado para rotas públicas e administrativas, com validação, autenticação e respostas de conflito/erro | Aprovado |
| IV. Segurança e Privacidade por Padrão | Rotas de gestão exigem sessão administrativa ativa; rotas públicas validam entrada e escopo; contato de convidado é acessível apenas à barbearia proprietária e não aparece em logs nem erros | Aprovado |
| V. Qualidade Verificável e Observabilidade | Unitários para disponibilidade; PostgreSQL real para integridade, concorrência e tenant; E2E HTTP e contrato; transições registram ator, instante, tenant e correlação sem PII | Aprovado |
| Fluxo e idioma | Artefatos SDD em português; implementação seguirá TDD e fronteiras de domínio/aplicação/infraestrutura | Aprovado |
| Schema por SQL | Schema e release por SQL revisado, versão de manifesto, grants mínimos e detecção de drift; aplicação sem DDL | Aprovado |

### Reavaliação após o projeto

O modelo e o contrato mantêm o tenant como escopo obrigatório e separam operações públicas de convidado das operações protegidas de gestão. A constraint de intervalo, o lock transacional por tenant compartilhado entre reservas e mudanças de configuração, a transação de reagendamento e os testes PostgreSQL cobrem concorrência. Todas as mutações exigem chave de idempotência; somente `confirmed` admite transição e reagendamento; `no_show` é permitido desde o início agendado e `attended` desde o término. FR-014 rejeita integralmente mudanças conflitantes. O fuso local está separado dos instantes UTC. Não há violações constitucionais nem decisões pendentes que bloqueiem a Fase 2.

## Estrutura do Projeto

### Documentação desta funcionalidade

```text
specs/002-appointment-scheduling/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
└── checklists/requirements.md
```

### Código-fonte previsto

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
│   └── 090_schema_manifest.sql
└── releases/002-appointment-scheduling/{up,verify,rollback}.sql

test/
├── unit/scheduling/
├── integration/scheduling/
├── contract/scheduling.contract.spec.ts
└── e2e/appointments.e2e-spec.ts
```

**Decisão de Estrutura**: Um único módulo `scheduling` possui catálogo, profissionais, jornadas, exceções e agendamentos. Entidades de negócio e regras de disponibilidade não dependem de NestJS ou `pg`; adapters HTTP e PostgreSQL implementam portas da aplicação. A barbearia reutiliza `tenancy.tenants`; não será introduzido um segundo conceito de tenant ou um schema separado para cada contexto de agendamento.

## Acompanhamento de Complexidade

Não há violações da constituição. A extensão PostgreSQL `btree_gist` é adicionada ao bootstrap para que uma constraint GiST combine igualdade de tenant/profissional com sobreposição de intervalos. O histórico de atendimento permanece no banco para auditoria; retenção futura exige política aprovada.

## Execução das fases

- **Fase 0 concluída**: [research.md](research.md) resolve geração de candidatos, antecedência, concorrência com configuração, idempotência, fuso e estados finais, com alternativas e compromissos explícitos. Fontes locais: `package.json`, `src/shared/database/transaction-runner.ts`, `src/modules/authentication/infrastructure/http/tenant-session.guard.ts`, `compose.e2e.yaml` e scripts de CI.
- **Fase 1 concluída**: [data-model.md](data-model.md), [contracts/openapi.yaml](contracts/openapi.yaml) e [quickstart.md](quickstart.md) incorporam FR-001 a FR-022. Configurações de disponibilidade têm endpoint próprio; conflitos administrativos identificam reservas afetadas sem contatos pessoais.
- **Próxima fase**: implementar as tarefas atualizadas em `tasks.md` com TDD, depois verificar contratos, schema, isolamento e concorrência reais. O guard atual autentica sessão, mas não restringe papel; incluir autorização explícita de `administrator` nas rotas de gestão.
- **Integração de verificadores**: os scripts atuais de OpenAPI geram/verificam apenas autenticação. Estendê-los na implementação para ambos os contratos e tipos separados; atualizar healthchecks dos dois arquivos Compose e manifesto de schema no mesmo release. A API atual não possui prefixo global; montar rotas novas em `/v1` sem alterar as rotas de autenticação existentes.

## Rastreabilidade da validação

| Requisitos | Evidência prevista |
|---|---|
| FR-001 a FR-004, FR-014 | Catálogo, elegibilidade, jornadas, bloqueios e rejeição atômica de conflitos |
| FR-005 a FR-010, FR-016 a FR-018 | Disponibilidade, convidado, atribuição, concorrência e privacidade |
| FR-011 a FR-013 | Isolamento, agenda administrativa, cancelamento e reagendamento |
| FR-015, FR-020 a FR-022 | Fuso, limite de 30 dias, intervalo configurável e antecedência revalidada |
| FR-019 | Transições finais imutáveis e replay sem duplicar eventos |
| SC-001 a SC-008 | Casos do quickstart; SC-003/004 exigem ensaio com consumidor da API, pois não há frontend neste escopo |
