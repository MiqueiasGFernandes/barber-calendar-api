# Diagnóstico de erros em produção

O objetivo é identificar a etapa, o local da falha e sua causa técnica nos logs da API e do worker, sem registrar credenciais ou dados pessoais. O diagnóstico é interno: respostas HTTP continuam usando o contrato de erro público, sem stack trace.

## Comportamento verificável

- Falhas de inicialização emitem `application_start_failed`, identificam `component` (`api` ou `worker`) e `stage`, e mantêm saída com código 1. A inicialização do Nest propaga a exceção ao tratamento sanitizado, sem abortar antes do registro.
- Configuração inválida informa `INVALID_CONFIGURATION`, os nomes das variáveis conhecidas, os códigos de validação e requisitos fixos quando disponíveis. Valores recebidos e mensagens livres do validador não são registrados.
- Erros HTTP com status 500 ou maior emitem `http_request_failed` com o mesmo `correlation_id` da resposta. Rejeições esperadas de negócio com status 4xx não geram stacks de erro.
- O diagnóstico inclui tipo, resumo técnico, código conhecido, frames da stack e encadeamento de `Error.cause`. Agregações incluem suas causas individuais, com limites de tamanho e proteção contra ciclos.
- Incompatibilidade de schema informa `UNSUPPORTED_SCHEMA`, revisão esperada e revisão encontrada quando reconhecida. Uma revisão desconhecida aparece como `unknown`, sem copiar texto arbitrário do banco.
- Falhas propagadas no ciclo do worker preservam a causa original de despacho/retenção e emitem `worker_iteration_failed`. Isso não altera as regras de retry do outbox.
- O container, `yarn start:prod` e `yarn worker` usam `--enable-source-maps`: os frames apontam para o TypeScript original quando há mapas disponíveis.

## Como interpretar

Cada evento ocupa uma linha JSON em stdout. A apresentação abaixo está expandida apenas para leitura; o timestamp e a stack foram omitidos:

```json
{
  "level": "error",
  "message": "application_start_failed",
  "component": "api",
  "stage": "configuration",
  "error": {
    "type": "ZodError",
    "code": "INVALID_CONFIGURATION",
    "message": "Environment configuration is invalid",
    "validation_issues": [
      {
        "field": "IDEMPOTENCY_ENCRYPTION_KEY",
        "code": "invalid_type",
        "requirement": "Base64 encoding of exactly 32 bytes"
      }
    ]
  }
}
```

| Campo             | Uso no diagnóstico                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`           | `configuration`, `initialization`, `http_setup`, `listening`, `request` ou `worker_iteration`.                                                                                                 |
| `correlation_id`  | Relaciona o erro HTTP à resposta e ao evento de conclusão da operação, que contém os IDs de trace/span.                                                                                        |
| `error.stack`     | Frames em ordem de chamada, com arquivo, linha e coluna; caminhos do ambiente anteriores a `src/`, `dist/`, `node_modules/` ou `test/` são removidos. Frames internos `node:` são preservados. |
| `error.cause`     | Próxima causa; seguir a cadeia até a origem técnica.                                                                                                                                           |
| `error.errors`    | Causas individuais de um `AggregateError`.                                                                                                                                                     |
| `error.truncated` | A cadeia excedeu os limites ou contém um ciclo.                                                                                                                                                |

Exemplos de códigos técnicos reconhecidos:

| Código                    | Interpretação                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `ECONNREFUSED`            | A conexão foi recusada. Conferir destino e disponibilidade do serviço.                   |
| `ENOTFOUND` / `EAI_AGAIN` | Falha de resolução de nome.                                                              |
| `EADDRINUSE`              | A porta/endereço de escuta já está ocupado.                                              |
| `28P01`                   | Falha de autenticação PostgreSQL.                                                        |
| `42501`                   | Privilégios insuficientes no banco.                                                      |
| `42P01` / `42703`         | Relação/coluna inexistente; conferir revisão e releases aplicados.                       |
| `UNSUPPORTED_SCHEMA`      | Conferir revisões esperada/encontrada e aplicar os releases necessários antes do deploy. |

No Render, pesquisar por `application_start_failed`, `http_request_failed` ou pelo UUID de correlação. Uma nova versão com estas alterações precisa ser publicada para produzir os novos diagnósticos; os logs antigos não são enriquecidos retroativamente.

## Proteção e limites

Mensagens livres de exceções, SQL, `detail`, objetos de requisição, headers, valores de configuração e metadados arbitrários não são serializados. Resumos de códigos conhecidos vêm de um catálogo fixo. Erros sem classificação usam `Unexpected error; inspect stack and cause`, preservando tipo e locais da stack; ampliar o catálogo exige uma mensagem fixa e um teste de privacidade.

Até cinco níveis, cinco erros por agregação, dezesseis nós inspecionados e vinte frames por erro são registrados. A leitura de cada stack é limitada a 32 KiB; cada localização aceita no máximo 240 caracteres. Texto livre, código de `eval`, URLs de stack com query e frames não reconhecidos são descartados. Objetos lançados que não sejam `Error` são identificados sem copiar seu conteúdo. Accessors que lançam exceções geram um diagnóstico mínimo.

Falhas de carregamento de módulos que ocorram antes da execução dos entrypoints continuam sob responsabilidade do Node. O diagnóstico novo cobre os tratamentos de inicialização, HTTP e ciclo do worker; não é um capturador global de todas as falhas do processo.

Não há alteração de tabelas, permissões de produção, autenticação ou contrato HTTP nesta melhoria.

## Validação

Os testes exercitam configuração ausente/inválida, stack/cause e erros agregados, privacidade, ciclos, accessors, schema incompatível, respostas HTTP e porta ocupada. Os executáveis compilados da API e do worker são iniciados em subprocessos com ambiente controlado, sem conexão de produção.

```sh
yarn build
yarn vitest run test/unit/shared/observability/error-diagnostics.spec.ts test/unit/shared/http/error-diagnostics.spec.ts test/architecture/startup-diagnostics.spec.ts
yarn ci:check
```

Validação em 2026-10-19: `yarn ci:check` aprovado, incluindo lint, tipos, build, 77 testes unitários/arquiteturais, 16 testes de contrato, OpenAPI, schema sem drift, 53 testes de integração PostgreSQL e 40 testes E2E HTTP — 186 testes aprovados. Prettier dos arquivos alterados, links locais e `git diff --check` também passaram. Nenhuma alteração foi aplicada em produção.
