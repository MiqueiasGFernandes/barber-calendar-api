# Pesquisa: Autenticação de Tenant sem Senha

Pesquisa técnica revisada em 2026-10-07. Dependências são fixadas por `pnpm-lock.yaml`; imagens Docker são fixadas por patch ou digest.

## Runtime e framework

**Decisão**: Node.js 24 LTS, NestJS 12, TypeScript 6 em modo estrito, ESM e pnpm 12. Usar o adapter Fastify.

**Justificativa**: Em 2026-10-07, Node.js 24 é LTS enquanto Node.js 26 ainda está no canal Current. NestJS 12 e seus schematics suportam Node.js 24 atualizado e TypeScript 6. Fastify reduz overhead HTTP sem alterar as fronteiras da aplicação.

**Alternativas consideradas**: Node.js 26 será adotável após promoção a LTS e validação das dependências; Express é mais difundido, mas o projeto não depende de middlewares exclusivos; Node.js 22 continua suportado, porém oferece janela menor para um projeto novo.

**Fontes**: [ciclo de releases do Node.js](https://nodejs.org/en/about/previous-releases), [requisitos do NestJS 12](https://docs.nestjs.com/migration-guide), [NestJS com Fastify](https://docs.nestjs.com/techniques/performance), [pnpm 12](https://pnpm.io/blog/releases/12.8.2)

## Monólito modular

**Decisão**: Um único deploy NestJS, dividido por capacidades de negócio (`authentication`, `tenancy`, `audit` e futuras capacidades de agenda). Cada módulo contém `domain`, `application` e `infrastructure`, publica somente tokens/interfaces de sua API e não permite imports profundos de outro módulo.

**Justificativa**: Cadastro, autenticação, tenant e outbox compartilham transações locais. Fronteiras internas explícitas preservam coesão e permitem escala horizontal agora e extração futura quando uma capacidade precisar de implantação independente.

**Alternativas consideradas**: Microserviços introduziriam transações distribuídas; um diretório global de services/repositories facilitaria acoplamento; workspace com vários apps Nest é prematuro enquanto existe um único produto implantável.

## Acesso ao PostgreSQL

**Decisão**: PostgreSQL 18 no último patch com `pg` (`node-postgres`) diretamente nos adapters. Um `TransactionRunner` entrega o mesmo `PoolClient` a todas as portas participantes. Consultas são parametrizadas e usam SQL explícito para `RETURNING`, `FOR UPDATE`, `ON CONFLICT` e `SKIP LOCKED`.

**Justificativa**: As operações centrais dependem de locks, constraints e transições condicionais. `pg` mantém essas garantias visíveis e não introduz mecanismo implícito de schema. A mesma conexão é obrigatória durante uma transação.

**Alternativas consideradas**: TypeORM/Prisma/Drizzle poderiam ajudar em CRUD e tipos, mas seus recursos de schema/migrations contrariam a política e adicionam uma segunda representação; query builders continuam aceitáveis no futuro se nunca gerarem DDL, mas não são necessários no MVP.

**Fontes**: [NestJS e bancos](https://docs.nestjs.com/data/overview), [transações com node-postgres](https://node-postgres.com/features/transactions), [locks do PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html)

## Schema exclusivamente por scripts SQL

**Decisão**: SQL manual, revisado e versionado no Git é a única fonte estrutural. `database/init/00-bootstrap.sql` cria o banco vazio e inclui, em ordem explícita, os arquivos canônicos de `database/schema/`. O bootstrap é estrito e destinado a banco vazio. Nenhum migration runner, ORM sync, `db push` ou DDL no startup é permitido.

**Justificativa**: O snapshot canônico torna a criação reproduzível e auditável. `psql` com `ON_ERROR_STOP` e transação falha cedo. O usuário runtime possui somente privilégios DML. A CI prova o bootstrap a partir de zero e verifica objetos/constraints por assertions SQL e `pg_dump --schema-only` normalizado.

**Alternativas consideradas**: `IF NOT EXISTS` generalizado mascara drift; volume E2E persistente impede a reexecução do init; migrations geradas e auto-sync foram rejeitados pelo requisito. Para bancos persistentes, alterações continuam sendo DDL incremental em sentido conceitual, portanto são scripts SQL de release manuais e auditáveis, nunca migrations de framework.

**Fontes**: [imagem oficial PostgreSQL e init scripts](https://hub.docker.com/_/postgres), [`psql` e `ON_ERROR_STOP`](https://www.postgresql.org/docs/current/app-psql.html), [`pg_dump --schema-only`](https://www.postgresql.org/docs/current/app-pgdump.html)

## Banco E2E com Docker Compose

**Decisão**: `compose.e2e.yaml` inicia PostgreSQL isolado com armazenamento `tmpfs`, monta apenas o master bootstrap em `/docker-entrypoint-initdb.d` e monta schema/fixtures separadamente como read-only. O healthcheck consulta o marcador final em `app_meta.schema_build`. Cada job usa um project name único e sempre executa teardown.

**Justificativa**: A imagem oficial executa init scripts somente quando o diretório de dados está vazio. `tmpfs` garante banco novo em cada ciclo, e o marcador impede que testes iniciem antes de o schema estar completo.

**Alternativas consideradas**: Testcontainers é adequado, mas Docker Compose é requisito explícito; `pg_isready` isolado pode liberar testes antes do fim do bootstrap; volume nomeado reutilizado cria dependência invisível entre execuções.

**Fontes**: [scripts de inicialização PostgreSQL no Docker](https://docs.docker.com/guides/postgresql/immediate-setup-and-data-persistence/), [ordem e healthchecks no Compose](https://docs.docker.com/compose/how-tos/startup-order)

## Validação e configuração

**Decisão**: Zod/Standard Schema valida payloads na borda HTTP e variáveis de ambiente no bootstrap. `AUTH_SESSION_TTL` usa duração ISO-8601, padrão `PT24H`, e falha fora de `PT15M..P7D`. Tipos transformados e validados entram nos casos de uso; objetos HTTP nunca entram no domínio.

**Justificativa**: Uma única definição de runtime e TypeScript reduz discrepância de tipos. A aplicação não aceita tráfego com configuração insegura.

**Alternativas consideradas**: `class-validator` é suportado e maduro, mas decorators espalhariam metadados de framework nos DTOs; conversão ad hoc de `process.env` falha tardiamente.

**Fontes**: [validação no NestJS](https://docs.nestjs.com/application/validation), [configuração no NestJS](https://docs.nestjs.com/application/configuration)

## OTP, JWT e sessão

**Decisão**: Gerar OTP com `randomInt()` de `node:crypto`, persistir `HMAC-SHA-256(pepper, purpose || challenge_id || code)` e comparar com `timingSafeEqual`. Usar `jose` atrás de `TokenIssuer`/`TokenVerifier` para JWT RS256 com `kid`, `iss`, `aud`, `sub`, `sid`, `jti`, `tenant_id`, `membership_id`, `role`, `iat` e `exp`. Persistir cada sessão e revalidar sessão, conta, tenant e vínculo em toda requisição protegida.

**Justificativa**: HMAC com pepper protege melhor o pequeno espaço do OTP em vazamento apenas do banco. JWT assimétrico permite rotação e futura separação de validadores. A sessão persistida aplica suspensões imediatamente e preserva logins paralelos.

**Alternativas consideradas**: Digest sem chave é enumerável; JWT autossuficiente não atende à revalidação; `@nestjs/authentication` e `@nestjs/jwt` oferecem primitivas úteis, mas o fluxo customizado de tenant, OTP, outbox e limites permanece atrás de portas próprias.

**Fontes**: [`node:crypto`](https://nodejs.org/api/crypto.html), [autenticação NestJS](https://docs.nestjs.com/security/authentication), [JWT BCP](https://www.rfc-editor.org/rfc/rfc8725.html)

## Limitação, concorrência e outbox

**Decisão**: PostgreSQL coordena janelas móveis de rate limit e outbox no MVP. Sujeitos de e-mail/IP são HMACs; linhas são bloqueadas em ordem determinística. O worker reivindica lotes da outbox com `FOR UPDATE SKIP LOCKED`, envia fora da transação e registra retry/backoff ou estado terminal.

**Justificativa**: O banco já é a fonte transacional compartilhada entre réplicas. A outbox confirma desafio e intenção de entrega na mesma transação. Não há escala medida que justifique Redis ou broker.

**Alternativas consideradas**: Memória local falha com escala horizontal; Redis e RabbitMQ/Kafka ficam reservados para contenção ou throughput observados; entrega externa exatamente uma vez não é garantível, portanto a semântica é pelo menos uma vez com idempotência.

**Fontes**: [`SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html), [`INSERT ... ON CONFLICT`](https://www.postgresql.org/docs/current/sql-insert.html)

## E-mail transacional

**Decisão**: Brevo por REST/`fetch` atrás de `EmailSender`; Mailpit local. Destinatário e mensagem na outbox usam AES-256-GCM com chave separada/versionada e são expurgados em entrega, falha terminal ou expiração.

**Justificativa**: O adapter mantém fornecedor fora do núcleo. Brevo oferece API transacional e webhooks; Mailpit evita e-mail real em testes.

**Alternativas consideradas**: Resend oferece boa ergonomia e SES favorece escala/custo; envio síncrono e payload legível foram rejeitados.

**Fontes**: [API Brevo](https://developers.brevo.com/reference/send-transac-email), [webhooks Brevo](https://developers.brevo.com/docs/transactional-webhooks)

## Contrato, testes e observabilidade

**Decisão**: OpenAPI 3.1 contract-first; Vitest para unitários, integração, contrato e E2E; `@nestjs/testing` e Fastify `inject`; ESLint com regras de fronteira; OpenTelemetry e logger JSON nativo do NestJS. E2E executa contra o PostgreSQL Compose real e Mailpit ou adapter controlado.

**Justificativa**: Vitest é padrão em novos projetos NestJS ESM. O banco real prova locks, constraints, scripts e rollback. Logs incluem correlation/trace IDs e IDs opacos, nunca OTP, JWT, e-mail, IP bruto ou envelope decriptado.

**Alternativas consideradas**: Mocks não provam concorrência; SQLite não reproduz PostgreSQL; documentação gerada apenas por decorators pode divergir do contrato versionado.

**Fontes**: [testes no NestJS](https://docs.nestjs.com/fundamentals/testing), [OpenTelemetry para Node.js](https://opentelemetry.io/docs/languages/js/)

## Implantação

**Decisão**: Dockerfile multiestágio baseado em Node.js 24, usuário não-root, dependências produtivas congeladas e health/readiness separados. API e worker usam a mesma imagem com comandos distintos. O schema é preparado antes do deploy por `psql`, nunca pelo processo NestJS.

**Justificativa**: Um artefato conserva o monólito modular; processos separados isolam latência de e-mail. Usuário DML-only impede DDL acidental em runtime.

**Alternativas consideradas**: Executar worker no processo HTTP simplifica desenvolvimento, mas mistura disponibilidade; Kubernetes e microserviços são prematuros.

**Fonte**: [deploy NestJS com Docker](https://docs.nestjs.com/deployment)
