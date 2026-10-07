# Plano de Implementação: Autenticação de Tenant sem Senha

**Branch**: `001-tenant-authentication` | **Data**: 2026-10-07 | **Especificação**: [spec.md](spec.md)

**Entrada**: Especificação em `/specs/001-tenant-authentication/spec.md`

## Resumo

Implementar cadastro do primeiro administrador e login exclusivamente por OTP enviado por e-mail, com criação definitiva somente após a verificação, sessões simultâneas restritas ao tenant e duração configurável entre 15 minutos e 7 dias, usando 24 horas por padrão. A solução será um monólito modular em Node.js e NestJS, com módulos de negócio isolados por portas e adaptadores, PostgreSQL como autoridade transacional e containers Docker. O schema jamais será criado por migrations ou pela aplicação: scripts SQL versionados são a única fonte de criação e alteração estrutural, inclusive no PostgreSQL descartável dos testes E2E iniciado por Docker Compose.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6.0.x com modo estrito sobre Node.js 24.21.x LTS

**Dependências Principais**: NestJS 12.1.x; Fastify adapter; `@nestjs/config`; Standard Schema/Zod para validação; `pg` para PostgreSQL e transações explícitas; `jose` para JWT RS256; logger JSON nativo do NestJS; OpenTelemetry; cliente HTTP nativo `fetch`; Yarn 4 com lockfile imutável

**Armazenamento**: PostgreSQL 18.6; schema materializado exclusivamente por scripts em `database/schema/*.sql`; scripts operacionais de alteração em `database/releases/<release>/*.sql`, executados explicitamente por `psql`; nenhum ORM, migration runner, `synchronize` ou DDL no startup

**Testes**: Vitest; `@nestjs/testing`; Fastify `inject`; PostgreSQL E2E real iniciado por `compose.e2e.yaml`; scripts SQL montados em `/docker-entrypoint-initdb.d`; doubles somente para portas externas nos testes unitários; testes de contrato OpenAPI e de concorrência

**Plataforma Alvo**: Containers Linux OCI; Docker Compose para desenvolvimento e E2E; a mesma imagem da aplicação executa perfis separados de API e worker de outbox

**Tipo de Projeto**: Serviço web em monólito modular

**Metas de Desempenho**: Pelo menos 95% das decisões de OTP em até 2 segundos sob 100 tentativas simultâneas; exatamente um sucesso em verificações concorrentes; nenhum acesso cruzado entre tenants

**Restrições**: OTP de seis dígitos e 10 minutos; reenvio após 60 segundos; cinco falhas por desafio; limites persistentes por e-mail e IP; nenhuma senha ou SMS; sessão entre 15 minutos e 7 dias, padrão de 24 horas; nenhuma PII, OTP ou token em logs; entrega pelo menos uma vez via outbox; configuração inválida impede startup; banco E2E sempre nasce vazio a partir dos scripts SQL

**Escala/Escopo**: MVP para proprietários e membros, até 100 tentativas simultâneas; monólito preparado para escala horizontal; sem refresh token, SMS, passkeys, autenticação de clientes ou revogação ampla nesta feature

## Verificação da Constituição

*PORTÃO: aprovado antes da Fase 0 e reavaliado após a Fase 1.*

| Princípio | Evidência no projeto | Resultado |
|---|---|---|
| I. Isolamento Multi-Tenant | Módulo de tenancy fornece a decisão de acesso; toda requisição protegida revalida sessão, conta, tenant e vínculo no PostgreSQL; consultas recebem escopo do servidor | Aprovado |
| II. Integridade da Agenda | A feature não altera agenda; transações explícitas e constraints SQL preservam a base para regras futuras | Aprovado |
| III. Contratos de API Explícitos | `contracts/openapi.yaml` permanece fonte versionada; controllers e DTOs são adapters, sem contaminar domínio ou casos de uso | Aprovado |
| IV. Segurança e Privacidade por Padrão | OTP com HMAC, envelope cifrado, JWT assimétrico, respostas anti-enumeração, configuração validada no startup e logs com lista permitida | Aprovado |
| V. Qualidade Verificável e Observabilidade | Unitários, integração/E2E com PostgreSQL real, contrato, concorrência, lint de fronteiras e telemetria redigida | Aprovado |
| Fluxo e idioma | Artefatos SDD em português; TDD e dependências entre domínio, aplicação e infraestrutura verificadas automaticamente | Aprovado |
| Schema por SQL | Scripts SQL revisados são fonte de verdade; CI cria banco vazio e prova o bootstrap; aplicação não possui permissão nem mecanismo para DDL | Aprovado |

### Reavaliação após a Fase 1

O modelo define constraints, locks e fronteiras transacionais; o contrato preserva privacidade; o guia E2E recria PostgreSQL do zero com os scripts canônicos antes de validar concorrência, isolamento e sessões. Nenhuma violação constitucional ou necessidade de esclarecimento permanece.

## Estrutura do Projeto

### Documentação desta funcionalidade

```text
specs/001-tenant-authentication/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
└── tasks.md
```

### Código-fonte

```text
src/
├── main.ts
├── app.module.ts
├── modules/
│   ├── authentication/
│   │   ├── domain/
│   │   ├── application/{ports,use-cases}/
│   │   ├── infrastructure/{http,persistence,email,token}/
│   │   └── authentication.module.ts
│   ├── tenancy/
│   └── audit/
└── shared/{config,database,observability}/

database/
├── init/
│   └── 00-bootstrap.sql
├── schema/
│   ├── 001_extensions.sql
│   ├── 010_schemas.sql
│   ├── 020_tables.sql
│   ├── 030_constraints.sql
│   ├── 040_indexes.sql
│   └── 090_schema_manifest.sql
├── releases/<release>/{up,verify,rollback}.sql
├── seeds/reference.sql
├── tests/fixtures/
└── verify/assertions.sql

test/
├── unit/
├── integration/
├── contract/
└── e2e/

Dockerfile
compose.yaml
compose.e2e.yaml
```

**Decisão de Estrutura**: Um único artefato NestJS é dividido por capacidades de negócio. Cada módulo expõe apenas sua API pública; imports profundos entre módulos são proibidos por ESLint. Domínio e aplicação não importam NestJS, Fastify, `pg` ou provedores. A separação futura em serviços preserva contratos de portas, mas só será feita com necessidade independente de implantação ou escala.

## Política de Schema SQL

- `database/init/00-bootstrap.sql` é o único arquivo executado pelo entrypoint. Ele cria o banco quando necessário e inclui explicitamente `database/schema/*.sql`, a definição canônica para bancos novos, com `ON_ERROR_STOP` e transações explícitas.
- Docker Compose monta o master em `/docker-entrypoint-initdb.d` e os demais scripts em `/opt/app-sql`, todos somente leitura; o banco E2E usa `tmpfs` e nunca reaproveita volume.
- Nenhum package de migration é instalado. Recursos de auto-sync/DDL de ORM são proibidos e o usuário da aplicação não recebe permissão de DDL.
- Mudanças em bancos existentes usam scripts SQL revisados em `database/releases/<release>/`, executados explicitamente pelo pipeline/operador com `psql`; a aplicação nunca altera schema no startup.
- `schema_manifest` registra a revisão esperada. A aplicação falha o readiness quando o banco não corresponde à revisão suportada.
- A CI sempre cria ao menos um PostgreSQL vazio com os scripts canônicos e executa os E2E, impedindo scripts quebrados ou dependências ocultas de estado anterior.

## Acompanhamento de Complexidade

Não há violações da constituição. PostgreSQL também coordena outbox e limitação no MVP para evitar Redis e broker antes de haver escala medida que os justifique.
