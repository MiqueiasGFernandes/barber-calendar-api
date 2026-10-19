# Documentação geral da API

Esta é a entrada única para consumir a Barber Calendar API: autenticação por OTP, catálogo público, disponibilidade, reservas de convidados, configuração da barbearia, gestão de agendamentos e verificações operacionais.

## Arquivos e visualização

| Arquivo                      | Finalidade                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.html](index.html)     | Referência navegável local, com busca das 27 operações e detalhes dos contratos. Abrir diretamente no navegador; não depende de CDN ou serviços externos. |
| [openapi.yaml](openapi.yaml) | Contrato consolidado OpenAPI 3.1 para importação em ferramentas compatíveis.                                                                              |
| [openapi.json](openapi.json) | O mesmo contrato em JSON, com todas as referências internas resolvíveis no próprio documento.                                                             |

A referência HTML permite consultar e filtrar; para executar chamadas, importe YAML/JSON em uma ferramenta cliente. O serviço HTTP não publica uma rota `/docs` nem Swagger UI no runtime.

## Endereços e versões

Use como base o host da implantação, por exemplo `http://localhost:3000` durante desenvolvimento. As rotas de negócio recebem `/v1`; `/health` e `/ready` ficam diretamente na raiz.

```sh
BASE_URL=http://localhost:3000
curl "$BASE_URL/health"
curl "$BASE_URL/ready"
```

O `servers` principal do contrato é `/v1`, relativo ao host da API. Os dois paths operacionais sobrescrevem esse servidor com `/`. Ao importar em ferramentas, configure o host real e preserve essa diferença; o endereço onde a documentação está aberta não é necessariamente o host da API.

`openapi: 3.1.0` é a versão do formato. `info.version: 1.0.0` é a versão inicial do documento consolidado, independente das versões dos contratos dos módulos e da revisão do banco. O contrato descreve o código deste repositório; uma implantação ainda não atualizada pode oferecer somente parte das operações.

## Autenticação e isolamento

Cadastro, solicitação/verificação de OTP, catálogo, consulta de disponibilidade e reserva de convidado são públicos. As rotas `/v1/management/*` exigem JWT Bearer, sessão ativa e papel `administrator`.

```text
Authorization: Bearer <access_token>
```

O servidor obtém a barbearia da sessão e revalida a autorização. Informar um tenant no corpo, query ou header não concede acesso a outra barbearia. As rotas públicas identificam a barbearia por `tenant_slug` no caminho.

### Cadastro do primeiro administrador

Os exemplos usam dados fictícios. Em um ambiente real, escolha um slug disponível e um e-mail no qual consiga receber o OTP; durante desenvolvimento, consulte as mensagens no Mailpit.

```sh
curl -i "$BASE_URL/v1/tenants/register" \
  -H 'Content-Type: application/json' \
  --data @docs/openapi/examples/registration.json
```

O corpo usa `tenant_name`, `tenant_slug` e `administrator_email`. A resposta `201` contém `registration_attempt_id`, `challenge_id`, `status: verification_required`, `expires_in: 600` e `resend_after: 60`. Tenant, conta e vínculo definitivos só são criados após confirmação do OTP.

O header `Location` identifica a tentativa; não há endpoint GET de consulta dessa tentativa implementado nesta versão.

### Login e confirmação

```sh
curl -i "$BASE_URL/v1/auth/otp-requests" \
  -H 'Content-Type: application/json' \
  --data @docs/openapi/examples/login.json
```

A resposta `202` é uniforme e não comprova existência de conta ou entrega de e-mail. Para confirmar cadastro ou login, envie o `challenge_id` recebido e o código de seis dígitos entregue por e-mail para `POST /v1/auth/otp-verifications`:

```json
{
  "challenge_id": "10000000-0000-4000-8000-000000000001",
  "code": "123456"
}
```

Esses valores são fictícios: use o desafio e código da sua operação. OTP tem validade de dez minutos e uso único. A resposta `200` contém `access_token`, `token_type: Bearer` e `expires_in`; a sessão usa 24 horas por padrão, conforme configuração de emissão. Não há fluxo de refresh token neste contrato.

## Consulta e reserva pública

1. Consulte `GET /v1/public/tenants/{tenant_slug}/services` e escolha um serviço ativo e, opcionalmente, um profissional elegível.
2. Consulte `GET /v1/public/tenants/{tenant_slug}/availability` com `service_id`, `date` e, opcionalmente, `professional_id`.
3. Escolha `starts_at` de uma opção retornada e confirme por `POST /v1/public/tenants/{tenant_slug}/appointments`, com `Idempotency-Key` e os dados obrigatórios do convidado.

```sh
# Defina TENANT_SLUG, SERVICE_ID e DATE com valores válidos do seu ambiente.
curl --get "$BASE_URL/v1/public/tenants/$TENANT_SLUG/availability" \
  --data-urlencode "service_id=$SERVICE_ID" \
  --data-urlencode "date=$DATE"
```

O corpo da reserva contém `service_id`, `starts_at`, `guest_name`, `guest_phone` e `guest_email`; `professional_id` é opcional/anulável. Nome, telefone e e-mail são obrigatórios. Para aceitar qualquer profissional, omita `professional_id` ou envie `null`.

A consulta não bloqueia o horário. A confirmação revalida disponibilidade, duração completa, antecedência e janela de 30 dias no fuso local. Um conflito retorna `409`; consulte as opções novamente. Sem opções válidas, `slots` é um array vazio.

## Gestão da barbearia

Todas as operações abaixo usam `/v1/management`, com Bearer de administrador. As mutações exigem `Idempotency-Key`.

| Recurso                    | Métodos e caminho após `/v1/management`                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Intervalo e antecedência   | `GET`, `PUT /scheduling-settings`                                                                                              |
| Fuso IANA                  | `GET`, `PUT /time-zone`                                                                                                        |
| Serviços                   | `GET`, `POST /services`; `PATCH /services/{service_id}`                                                                        |
| Profissionais              | `GET`, `POST /professionals`; `PATCH /professionals/{professional_id}`                                                         |
| Jornada semanal            | `GET`, `PUT /professionals/{professional_id}/weekly-periods`                                                                   |
| Pausas, folgas e bloqueios | `GET`, `POST /professionals/{professional_id}/exceptions`; `DELETE /professionals/{professional_id}/exceptions/{exception_id}` |
| Agenda                     | `GET /appointments`                                                                                                            |
| Cancelamento               | `POST /appointments/{appointment_id}/cancellation`                                                                             |
| Reagendamento              | `POST /appointments/{appointment_id}/rescheduling`                                                                             |
| Resultado do atendimento   | `POST /appointments/{appointment_id}/outcome`                                                                                  |

Configure profissionais, serviços e elegibilidade, jornadas e exceções antes de oferecer reservas. O `PUT` da jornada substitui o conjunto completo de períodos; envie `periods: []` para remover a jornada quando não houver conflitos.

A consulta da agenda usa `starts_from` e `ends_before` obrigatórios, mais filtros opcionais `professional_id` e `status`. As exceções também são consultadas por `starts_from` e `ends_before`. Não há paginação ou parâmetros `page`/`limit` nesses endpoints; as respostas usam arrays `appointments`, `services`, `professionals`, `periods` ou `exceptions`, conforme o recurso.

Um agendamento começa em `confirmed`. Pode passar para `cancelled`, `attended` ou `no_show`, que são estados finais. `no_show` é permitido a partir do início; `attended`, após o término. Reagendamento aceita somente confirmados e preserva o intervalo original em caso de falha.

Mudanças de configuração que conflitem com confirmados retornam `409` e preservam os dados. O responsável deve cancelar ou reagendar os conflitos e tentar novamente. A lista `conflicting_appointment_ids`, quando retornada, contém somente compromissos do tenant autorizado. A auditoria administrativa tem consulta interna autorizada, sem endpoint público neste contrato.

## Idempotência e repetição

Use uma chave opaca entre 16 e 128 caracteres no header `Idempotency-Key` para cada nova mutação de agendamento. Cadastros/OTP não usam esse header como mecanismo de replay.

- Após timeout, repita o mesmo comando com a mesma chave e conteúdo. Durante 24 horas, o resultado original é reproduzido sem duplicar efeitos.
- Mesma chave com conteúdo diferente retorna `409`; uma nova intenção exige nova chave.
- O escopo inclui barbearia, ator/contexto público, operação e recurso. Replay administrativo exige autorização vigente.
- Após 24 horas, a chamada pode ser tratada como nova operação, sujeita às regras atuais.
- `IDEMPOTENCY_ENCRYPTION_KEY` é configuração secreta do servidor para proteger respostas armazenadas; nunca deve ser enviada pelo cliente.

## Formatos e convenções

- Corpos de requisição: `Content-Type: application/json`.
- IDs: UUIDs; não confundir com o slug público da barbearia.
- `date`: `YYYY-MM-DD` no fuso da barbearia. Instantes: RFC 3339 com offset explícito; reutilize os instantes retornados pela disponibilidade.
- Fuso: identificador IANA, como `America/Sao_Paulo`.
- Jornada: `iso_weekday` de 1 (segunda) a 7 (domingo), com `starts_local_time`/`ends_local_time` em `HH:mm:ss`.
- Dinheiro: `price_minor` inteiro na unidade mínima e `currency_code` com três letras maiúsculas; por exemplo, `5000` e `BRL` representam R$ 50,00.
- Intervalo padrão entre inícios: 15 minutos; antecedência mínima padrão: 30 minutos. Configurar antecedência zero ainda exige início futuro.

## Erros e correlação

Respostas de erro usam `application/problem+json`. Ambos os módulos retornam `type`, `title`, `status` e `correlation_id`; autenticação/erros globais também usam `code`, enquanto o filtro de agendamento usa `detail`. Não assuma um campo `code` em todas as respostas da API.

| Status | Tratamento pelo consumidor                                                          |
| ------ | ----------------------------------------------------------------------------------- |
| `401`  | Sessão ou OTP ausente, inválido, expirado ou inelegível.                            |
| `403`  | Sessão sem papel/permissão suficiente.                                              |
| `404`  | Recurso indisponível no escopo consultado.                                          |
| `409`  | Conflito de reserva/configuração, estado final ou reutilização divergente de chave. |
| `422`  | Corrigir os dados conforme o schema da operação.                                    |
| `429`  | Respeitar `Retry-After` antes de tentar novamente.                                  |
| `500`  | Falha inesperada ou de dependência; informar correlação ao suporte.                 |

Os contratos dos módulos detalham os status por operação. Erros inesperados `500` são tratados pelos filtros da aplicação mesmo quando não enumerados individualmente no contrato legado de uma operação.

Envie opcionalmente `X-Correlation-Id` com UUID válido. A API gera um novo UUID para entradas inválidas/ausentes e devolve `x-correlation-id`. O identificador do erro também aparece no corpo; use-o para localizar o diagnóstico nos logs. Tokens, dados pessoais, stack trace e SQL não devem aparecer nas respostas de erro. Consulte [diagnóstico de erros](../error-diagnostics.md) para operação interna.

## Fontes e manutenção

Os contratos canônicos permanecem separados:

- [Autenticação](../../specs/001-tenant-authentication/contracts/openapi.yaml).
- [Agendamento](../../specs/002-appointment-scheduling/contracts/openapi.yaml).
- [Operação](operations.yaml), para os endpoints já existentes `/health` e `/ready`.

O [gerador](../../scripts/build-openapi.ts) combina as fontes sem alterar caminhos, `operationId` ou modelos de cada módulo. Componentes recebem prefixos `Authentication`, `Scheduling` e `Operations` para preservar diferenças reais, inclusive entre schemas de erro; o esquema Bearer idêntico é compartilhado. Não edite os três artefatos gerados manualmente.

```sh
yarn docs:openapi
yarn contract:check
yarn test:contract
```

`contract:check`, também executado pela CI, rejeita artefatos desatualizados e confere os tipos gerados dos módulos. Não introduz dependências, endpoints de negócio, alterações de banco ou chamadas a produção.
