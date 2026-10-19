# Pesquisa: Agendamento de Serviços

## Decisões

### A reserva é um intervalo, não uma linha de horário pré-criada

**Decisão**: Persistir instantes de início e fim por agendamento; calcular horários candidatos sob demanda a partir da jornada local, duração do serviço, exceções e reservas existentes. Gerar candidatos em incrementos de 15 minutos, mas nunca permitir que o serviço ultrapasse a jornada ou conflite com outra reserva.

**Motivo**: A duração varia por serviço. Uma grade persistida uniforme não representa adequadamente serviços de durações diferentes, pausas ou exceções. O intervalo semiaberto `[início, fim)` permite que um atendimento comece exatamente quando outro termina.

**Alternativas consideradas**: Criar slots fixos persistidos para cada dia; rejeitada porque multiplica registros e exige reconstrução após alterações de duração/jornada. Usar precisão de um minuto para todos os inícios; rejeitada para reduzir opções pouco úteis e custo de busca no MVP.

Quando o cliente aceita qualquer profissional, escolher entre os elegíveis pelo menor total de minutos confirmados naquele dia local; desempatar por UUID para resultado determinístico. Uma escolha explícita do cliente sempre prevalece.

### PostgreSQL é a autoridade final contra sobreposição

**Decisão**: Instalar `btree_gist` e definir constraint de exclusão GiST sobre `(tenant_id =, professional_id =, interval &&)`, aplicada a agendamentos com estado `confirmed`. Converter violações de constraint em resposta de conflito recuperável e sugerir nova consulta de horários. Cancelados, atendidos e não comparecimentos não ocupam disponibilidade futura.

**Motivo**: Uma leitura de disponibilidade seguida de inserção não basta: solicitações concorrentes podem observar o mesmo espaço livre. A constraint protege o invariante no banco mesmo quando há mais de um processo da API. A aplicação ainda valida jornada, pausas, capacidade e estado, que a constraint de sobreposição não representa.

**Alternativas consideradas**: Serializar todas as reservas por lock de profissional e então procurar conflitos; rejeitada como única proteção porque exige que todo caminho de escrita obedeça ao mesmo protocolo. Usar `SERIALIZABLE` para todas as transações; rejeitada por impor retentativas e custo a operações sem necessidade. A constraint é complementar à transação normal já existente.

**Fontes primárias**: [Tipos de intervalo e constraints de exclusão do PostgreSQL](https://www.postgresql.org/docs/18/rangetypes.html), [constraints SQL](https://www.postgresql.org/docs/18/ddl-constraints.html), [extensão `btree_gist`](https://www.postgresql.org/docs/18/btree-gist.html).

### Instantes UTC e horário civil por barbearia

**Decisão**: Guardar compromissos e exceções pontuais como `timestamptz`/UTC; guardar a zona IANA (por exemplo, `America/Sao_Paulo`) uma vez por tenant. Jornadas recorrentes guardam dia da semana e hora local. Datas públicas são interpretadas no fuso do tenant e a janela de 30 dias é calculada nessa zona.

**Motivo**: Um instante com fuso não preserva o nome original da zona; a zona é necessária para interpretar horários recorrentes e apresentar a agenda corretamente. Isso também evita tratar uma data local como UTC.

**Alternativas consideradas**: Guardar horários locais sem zona nos agendamentos; rejeitada por tornar ambíguos instantes e intervalos concorrentes. Usar o fuso global do servidor; rejeitada em aplicação multi-tenant.

**Fonte primária**: [Tipos de data/hora do PostgreSQL](https://www.postgresql.org/docs/18/datatype-datetime.html).

### Tenant existente representa a barbearia

**Decisão**: Reutilizar `tenancy.tenants.id` como escopo de cada serviço, profissional, jornada, exceção e agendamento. Armazenar `time_zone` no tenant, com padrão inicial `America/Sao_Paulo`, e permitir configuração do fuso em gestão da barbearia.

**Motivo**: A constituição define a barbearia como tenant e fronteira de autorização. Criar uma entidade extra para uma única barbearia por tenant duplicaria escopo sem requisito de múltiplas filiais.

**Alternativas consideradas**: Introduzir `barbershops` abaixo do tenant; adiada até existir requisito de múltiplas unidades por tenant. Aplicar um fuso do servidor a todos os tenants; rejeitada por incorreção multi-tenant.

### Duração, preço e descrição são copiados para o agendamento

**Decisão**: Guardar snapshots do nome do serviço, duração e preço no momento da reserva, além da referência atual ao serviço.

**Motivo**: Alterações posteriores no catálogo não podem reescrever o histórico nem mudar a duração que já foi reservada. O preço permanece informativo; pagamento está fora do escopo.

**Alternativas consideradas**: Consultar sempre o serviço corrente; rejeitada porque alterações de catálogo fariam compromissos antigos parecer diferentes do que o cliente aceitou.

### O convidado não se torna uma conta

**Decisão**: Guardar nome, telefone e e-mail no agendamento, sem tabela global de clientes ou login. Apenas o responsável autenticado da barbearia consulta ou altera agendamentos existentes; a confirmação pública retorna só os dados da reserva recém-criada, sem PII de terceiros.

**Motivo**: É o escopo escolhido na especificação e evita adicionar autenticação de clientes, retenção cruzada de identidade e novos fluxos de conta.

### Profissional sem conta de autenticação no MVP

**Decisão**: Profissionais são registros de agenda com nome e estado, criados e administrados pelo tenant. Operações de configuração e gestão da agenda exigem usuário `administrator` do tenant; membros não ganham acesso de gestão nesta etapa.

**Motivo**: A especificação atribui gestão ao responsável da barbearia e o sistema atual já fornece sessão administrativa escopada por tenant. Não existe associação usuário-membro ↔ profissional; adicioná-la ampliaria autenticação/autorização fora do escopo.

### API REST segue o contrato OpenAPI 3.1 da feature

**Decisão**: Versionar o contrato do módulo em `specs/002-appointment-scheduling/contracts/openapi.yaml`, com rotas públicas por slug do tenant e rotas administrativas protegidas por sessão. Estender o verificador de contratos para validar os dois documentos sem sobrescrever os tipos gerados da autenticação; gerar tipos do scheduling em arquivo próprio do módulo.

**Motivo**: Mantém cada especificação como fonte de seu contrato e preserva as verificações já usadas no CI.

### Idempotência, eventos e limites

**Decisão**: Exigir `Idempotency-Key` no `POST` público de reserva, guardar hash/resultado associado ao tenant por período limitado de 24 horas e rejeitar reutilização da mesma chave com corpo diferente. Guardar a idempotência em tabela própria, com índice único por tenant e hash; um job/limpeza transacional remove chaves expiradas antes de novas operações. Registrar eventos de criação, reagendamento, cancelamento, atendimento e não comparecimento sem nome, telefone ou e-mail em logs. Aplicar rate limit de segurança ao booking público usando os controles do gateway/servidor existentes; se inexistentes, iniciar com limite por IP sem persistir IP bruto.

**Motivo**: Repetições por timeout não devem criar duas reservas. Convidados tornam a criação pública, portanto precisa de proteção básica contra abuso. O prazo de 24 horas é uma decisão técnica de deduplicação, não prazo de retenção do agendamento.

## Limites conhecidos e riscos residuais

- Não há volume real, SLO de latência ou política de retenção de histórico no requisito. Não particionar nem expurgar dados de agendamento automaticamente nesta entrega; medir e aprovar política antes de operar em escala maior.
- Constraint GiST protege intervalos por profissional, mas horários de expediente e exceções são regras de domínio e devem ser validados no mesmo fluxo de criação e reagendamento.
- Alteração de timezone afeta a interpretação futura de jornadas recorrentes; compromissos já confirmados permanecem instantes UTC imutáveis.
