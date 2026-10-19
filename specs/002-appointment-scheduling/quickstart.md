# Guia de Validação: Agendamento de Serviços

Este guia descreve como validar a feature quando implementada. O contrato detalhado está em [contracts/openapi.yaml](contracts/openapi.yaml); entidades, invariantes e transações estão em [data-model.md](data-model.md).

## Pré-requisitos

- Node.js 24.x, Yarn 4.18.x e Docker com Docker Compose. Na raiz do projeto, executar `yarn install --immutable` antes das verificações.
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
5. Cancelar libera o intervalo após commit; reagendar mantém atomicidade; `attended` só é aceito a partir do término e `no_show` a partir do início; ambos permanecem no histórico.
6. Responsável de tenant diferente não consulta nem modifica o agendamento; membro sem papel administrativo não altera configuração.
7. Nome, telefone, e-mail e identificadores de booking não aparecem em logs de aplicação ou telemetria; conflitos administrativos podem informar IDs das reservas afetadas, sem nome, telefone ou e-mail nas respostas de erro.

## Gates de release

```sh
yarn ci:check
```

Esperado: lint, tipos, testes unitários, contratos, OpenAPI, drift do schema e E2E passam em sequência. Em ambiente persistente, aplicar `database/releases/002-appointment-scheduling/up.sql` com procedimento operacional aprovado, validar `verify.sql` e só então executar a versão que exige o novo `schema_build.revision`.

## Cenários adicionais das clarificações

Executar com relógio controlado nos testes; não usar esperas reais para atravessar fronteiras de tempo.

| Preparação / operação | Resultado esperado |
|---|---|
| Configuração nova | GET `/v1/management/scheduling-settings` retorna 15/30 |
| PUT configuração com intervalo 20 e antecedência 30; expediente 09:00–12:00 | Inícios 09:00, 09:20, 09:40 etc.; filtrar os que não atendem à antecedência ou duração |
| Intervalo 0 ou antecedência negativa | 422, configuração anterior preservada |
| Agora 10:00, antecedência 30 | Início 10:30 aceito se alinhado e livre; 10:29 rejeitado |
| Busca permite 10:30, confirmação ocorre às 10:01 | 409, nenhuma reserva criada |
| Antecedência zero | Somente instantes estritamente posteriores ao relógio da operação |
| Reserva aguarda lock e vence a antecedência | Revalidar relógio após lock e rejeitar |
| Bloqueio/jornada conflita com compromisso | 409 com IDs para administrador; configurações e reservas preservadas |
| Cancelar ou reagendar compromisso afetado, tentar configuração com nova chave | Mudança aceita quando não há outros conflitos |
| Reserva concorre com bloqueio/jornada/desativação | Testar ambos os ordenamentos; uma operação vence e a outra revalida, sem reserva incompatível |
| Reagendamento falha | Compromisso continua ocupando o intervalo original |
| Cancelamento concorre com reagendamento ou resultado | Serialização e transição válida única, sem evento duplicado |
| Novo comando para cancelled/attended/no_show | 409; histórico imutável |
| Registrar `no_show` antes do início agendado | 409; estado permanece confirmed |
| Registrar `no_show` a partir do início agendado | 200; estado final no_show |
| Registrar `attended` antes do término | 409; estado permanece confirmed |
| Registrar `attended` a partir do término | 200; estado final attended |
| Repetição da chave original após cancelamento ou passagem do tempo | Resposta original, nenhum novo agendamento ou evento |
| Mutação administrativa repetida / chave com corpo diferente | Replay sem efeito / 409, respectivamente |
| Alteração de preço/duração de serviço | Snapshots das reservas existentes preservados |
| Mudança de fuso invalida compromisso | 409 sem mudar fuso nem instante reservado |
| Horário civil inexistente / repetido | Nenhum candidato inexistente / instantes distintos com offset explícito |
| Tenant ou papel incorreto | 404 para recurso fora do escopo; 403 para membro sem papel administrativo |
| Limite público excedido | 429 com Retry-After; sem IP bruto em persistência ou logs |

No teste de concorrência, disparar 100 reservas com chaves distintas para um único intervalo e verificar exatamente um sucesso, 99 conflitos e um evento de criação. Isolar/desativar o limite de IP nessa fixture para testar a integridade; testar o throttle separadamente. Medir que cancelamento confirmado volta à consulta em até cinco segundos. Consultas de outros tenants não aguardam o lock do tenant em disputa.

## Execução da integração com banco isolado

Além do E2E, rodar `yarn test:integration` com `DATABASE_URL` apontando para banco de testes preparado com o schema da feature. O script E2E atual executa somente a configuração E2E; a implementação deve incluir a suíte de integração de scheduling no fluxo CI contra PostgreSQL descartável. Nunca apontar esses testes para produção.

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

Esperado: 200 com os dois valores; repetir o segundo comando devolve a mesma resposta sem novo efeito. Uma nova alteração precisa de outra chave. As rotas são previstas pelo contrato e ainda dependem da implementação.

SC-003 e SC-004 exigem ensaio com um consumidor da API: registrar proporção dos clientes que reservam em até três minutos (mínimo 90%) e tempo do responsável para configuração (até cinco minutos). Os testes HTTP comprovam regras e tempos de resposta, mas não substituem a validação de usabilidade.
