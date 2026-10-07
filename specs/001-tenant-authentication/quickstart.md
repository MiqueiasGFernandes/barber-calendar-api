# Início Rápido: Validação da Autenticação sem Senha

Este guia define cenários executáveis para validar cadastro e login por OTP enviado exclusivamente por e-mail. A semântica HTTP está em [contracts/openapi.yaml](contracts/openapi.yaml), as entidades em [data-model.md](data-model.md) e a política SQL em [plan.md](plan.md#política-de-schema-sql).

## Pré-requisitos

- Node.js 24.21.x LTS
- Yarn 4.18.x
- Docker com Compose
- portas locais de API, PostgreSQL E2E e Mailpit disponíveis

Confirme as versões e instale exatamente o lockfile:

```bash
node --version
yarn --version
yarn install --immutable
```

## Preparar configuração local

Copie o arquivo de ambiente de exemplo e use apenas chaves não produtivas. A configuração inclui:

```text
AUTH_SESSION_TTL=PT24H
EMAIL_PROVIDER=mailpit
```

Peppers HMAC, chave AES da outbox e chave privada JWT são segredos distintos. Não os versione, exiba ou reutilize em produção.

## Executar portões rápidos

```bash
yarn lint
yarn typecheck
yarn test:unit
yarn contract:check
yarn schema:check
```

Resultado esperado: lint, TypeScript estrito, testes unitários, regras de fronteira entre módulos e contrato OpenAPI passam sem acessar infraestrutura.

## Criar o PostgreSQL E2E exclusivamente por SQL

Use um project name dedicado. O teardown inicial garante que nenhum volume anterior esconda falhas do bootstrap:

```bash
docker compose -p barber-e2e -f compose.e2e.yaml down -v --remove-orphans
docker compose -p barber-e2e -f compose.e2e.yaml up -d --build --wait
docker compose -p barber-e2e -f compose.e2e.yaml ps
```

Resultado esperado:

- PostgreSQL inicia com armazenamento descartável;
- `database/init/00-bootstrap.sql` cria o banco e inclui os scripts canônicos;
- o healthcheck só fica saudável depois do marcador em `app_meta.schema_build`;
- Mailpit, API e worker ficam saudáveis;
- nenhuma migration, ORM sync ou DDL do NestJS é executado.

Valide explicitamente o schema:

```bash
docker compose -p barber-e2e -f compose.e2e.yaml exec -T db-e2e \
  psql -v ON_ERROR_STOP=1 -U postgres -d barber_calendar_e2e \
  -f /opt/app-sql/verify/assertions.sql
```

## Executar integração e E2E

```bash
yarn test:integration
yarn test:e2e
```

Resultado esperado: adapters SQL, locks, constraints, rollback, API e worker usam o PostgreSQL real do Compose. A suíte não usa SQLite, banco em memória, Testcontainers ou mocks de PostgreSQL.

Se os E2E compartilham um banco, execute-os serialmente. Testes de corrida usam conexões independentes e dados confirmados; não devem ser envolvidos por uma transação externa da suíte.

## Validar cadastro provisório

1. Envie `POST /v1/tenants/register` com nome, slug e e-mail únicos; espere `201`, `registration_attempt_id`, `status: verification_required` e `challenge_id`.
2. Confirme que existem apenas Tentativa, Desafio, Outbox e Evento; Tenant, Conta e Vínculo ainda não existem.
3. Consulte a API do Mailpit, obtenha o OTP e envie-o a `POST /v1/auth/otp-verifications`; espere `200` e bearer token.
4. Confirme que Tenant, Conta ativa, Vínculo administrador e Sessão foram criados atomicamente e que a repetição recebe `401` genérico.
5. Execute 100 conclusões concorrentes para o mesmo e-mail ou slug; exatamente uma cria registros definitivos e nenhuma deixa estado parcial.

## Validar login e isolamento

1. Envie tenant e e-mail a `POST /v1/auth/otp-requests`; espere `202`.
2. Obtenha o OTP no Mailpit, verifique-o e confirme as claims `sub`, `tenant_id`, `membership_id`, `role`, `sid`, `jti`, `iat` e `exp`, sem e-mail ou outra PII.
3. Confirme que uma operação protegida recarrega Sessão, Conta, Tenant e Vínculo e não acessa outro tenant.
4. Repita com e-mail desconhecido, conta suspensa, tenant suspenso e vínculo inativo; respostas públicas permanecem indistinguíveis e nenhum código utilizável é entregue.

## Validar duração e sessões simultâneas

1. Sem `AUTH_SESSION_TTL`, emita uma sessão e confirme `expires_in = 86400`, `expires_at - issued_at = 24h` e `exp = expires_at`.
2. Inicie com `AUTH_SESSION_TTL=PT15M` e depois com `P7D`; novas sessões usam 900 e 604800 segundos.
3. Confirme que `PT14M59S`, `P7DT1S` e texto malformado impedem o bootstrap NestJS.
4. Emita sessão A, altere a configuração e emita sessão B; A conserva sua expiração e B usa a nova.
5. Faça dois logins para a mesma conta; ambas as sessões permanecem válidas até suas próprias expirações.
6. Suspenda Conta ou Tenant, ou inative o Vínculo; ambas deixam de autorizar imediatamente, sem depender apenas do `exp`.

## Validar limites e concorrência

1. Solicite novo OTP antes de 60 segundos; nenhum novo e-mail é enviado.
2. Após 60 segundos, solicite outro; o anterior falha e somente o novo funciona.
3. Avance o relógio além de 10 minutos; nenhum token é emitido.
4. Envie cinco OTPs incorretos; a tentativa seguinte encontra o desafio bloqueado.
5. Verifique o mesmo desafio em paralelo; exatamente uma resposta recebe token.
6. Atinja 5 solicitações por e-mail ou 20 por IP em 15 minutos; a próxima recebe `429` e `Retry-After`, sem e-mail.
7. Atinja 10 falhas por e-mail ou 50 por IP em uma hora, inclusive entre reemissões; a próxima é limitada.
8. Teste a fronteira da janela móvel; reemissão e virada de intervalo não permitem burst acima do limite.

## Validar outbox e privacidade

- Inicie API e worker como processos NestJS separados da mesma imagem.
- Interrompa Mailpit e confirme retry com backoff sem bloquear a transação de autenticação.
- Execute dois workers e confirme que o lease com `SKIP LOCKED` não entrega normalmente o mesmo item duas vezes.
- Confirme que desafio expirado ou substituído não é enviado.
- Confirme `Idempotency-Key` igual ao ID da outbox e expurgo do envelope em estado terminal.
- Confirme que banco, logs, traces e respostas não contêm OTP legível, JWT, chaves, envelope decriptado, e-mail ou IP bruto desnecessário.

## Validar drift do schema

```bash
docker compose -p barber-e2e -f compose.e2e.yaml exec -T db-e2e \
  pg_dump --schema-only --no-owner --no-privileges \
  -U postgres barber_calendar_e2e
```

Normalize a saída com a ferramenta versionada pelo projeto e compare-a ao snapshot esperado. A comparação deve usar cliente e servidor PostgreSQL da mesma versão para reduzir ruído.

## Encerrar o ambiente E2E

```bash
docker compose -p barber-e2e -f compose.e2e.yaml down -v --remove-orphans
```

Este comando remove somente os recursos descartáveis do projeto Compose `barber-e2e`. O teardown deve ocorrer também quando a suíte falhar.
