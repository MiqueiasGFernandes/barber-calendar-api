# Guia de Validação: Agendamento de Serviços

Este guia descreve como validar a feature quando implementada. O contrato detalhado está em [contracts/openapi.yaml](contracts/openapi.yaml); entidades, invariantes e transações estão em [data-model.md](data-model.md).

## Pré-requisitos

- Node.js 24.x, Yarn 4.18.x e Docker com Docker Compose.
- Variáveis requeridas pelos scripts E2E; `scripts/test-e2e.sh` gera senhas descartáveis quando não fornecidas.
- Um tenant de teste, um responsável autenticado, pelo menos um serviço, um profissional elegível e períodos de trabalho locais.

## Validação estática e de contrato

```sh
yarn lint
yarn typecheck
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

O script inicia um PostgreSQL descartável a partir dos scripts SQL canônicos e executa os testes Fastify reais.

Os cenários E2E devem provar:

1. Responsável cria serviço, profissional elegível, jornada semanal e exceção; consultas públicas usam slug de tenant e mostram somente os próximos 30 dias e os inícios em que o serviço cabe.
2. Convidado reserva informando nome, telefone e e-mail; resposta retorna `confirmed`, profissional atribuído e apenas dados da própria reserva.
3. Duas reservas concorrentes para o mesmo profissional/intervalo resultam em uma resposta de sucesso e uma de conflito; dois intervalos que apenas compartilham uma borda podem ambos ser confirmados.
4. Repetir `Idempotency-Key` com o mesmo conteúdo retorna o resultado original; reutilizá-la com conteúdo diferente falha sem duplicar reserva.
5. Cancelar libera o intervalo após commit; reagendar mantém atomicidade; `attended` e `no_show` permanecem no histórico.
6. Responsável de tenant diferente não consulta nem modifica o agendamento; membro sem papel administrativo não altera configuração.
7. Nome, telefone, e-mail e identificadores de booking não aparecem em logs de aplicação, telemetria ou respostas de erro.

## Gates de release

```sh
yarn ci:check
```

Esperado: lint, tipos, testes unitários, contratos, OpenAPI, drift do schema e E2E passam em sequência. Em ambiente persistente, aplicar `database/releases/002-appointment-scheduling/up.sql` com procedimento operacional aprovado, validar `verify.sql` e só então executar a versão que exige o novo `schema_build.revision`.
