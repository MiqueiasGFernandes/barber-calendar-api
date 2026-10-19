# Pesquisa: Agendamento de Serviços

## Decisões

### A reserva é um intervalo, não uma linha de horário pré-criada

**Decisão**: Persistir instantes de início e fim por agendamento; calcular horários candidatos sob demanda a partir da jornada local, duração do serviço, exceções e reservas existentes. Gerar candidatos pelo `slot_interval_minutes` da barbearia (inteiro positivo, padrão 15), ancorados no início de cada período local de expediente, mas nunca permitir que o serviço ultrapasse a jornada ou conflite com outra reserva.

**Motivo**: A duração varia por serviço. Uma grade persistida uniforme não representa adequadamente serviços de durações diferentes, pausas ou exceções. O intervalo semiaberto `[início, fim)` permite que um atendimento comece exatamente quando outro termina.

**Alternativas consideradas**: Criar slots fixos persistidos para cada dia; rejeitada porque multiplica registros e exige reconstrução após alterações de duração/jornada. Usar precisão de um minuto para todos os inícios; rejeitada para reduzir opções pouco úteis e custo de busca no MVP.

Quando o cliente aceita qualquer profissional, escolher entre os elegíveis pelo menor total de minutos confirmados naquele dia local; desempatar por UUID para resultado determinístico. Uma escolha explícita do cliente sempre prevalece.

### PostgreSQL é a autoridade final contra sobreposição

**Decisão**: Instalar `btree_gist` e definir constraint de exclusão GiST sobre `(tenant_id =, professional_id =, interval &&)`, aplicada a agendamentos com estado `confirmed`. Converter violações de constraint em resposta de conflito recuperável e sugerir nova consulta de horários. Cancelados, atendidos e não comparecimentos não ocupam disponibilidade futura.

**Motivo**: Uma leitura de disponibilidade seguida de inserção não basta: solicitações concorrentes podem observar o mesmo espaço livre. A constraint protege o invariante no banco mesmo quando há mais de um processo da API. A aplicação ainda valida jornada, pausas, capacidade e estado, que a constraint de sobreposição não representa.

**Alternativas consideradas**: Usar apenas locks de aplicação; rejeitada como única proteção porque a constraint também deve impedir sobreposição em escritas diretas. Usar `SERIALIZABLE` para todas as transações; rejeitada por impor retentativas e custo a operações sem necessidade. A constraint é complementar à transação normal já existente.

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

**Decisão**: Exigir `Idempotency-Key` em todas as mutações do contrato de scheduling, públicas e administrativas. O escopo é tenant + ator (membership ou público) + operação + recurso + hash da chave; persistir hash canônico da requisição, status HTTP e resposta original por 24 horas, atomicamente com a alteração. Repetição idêntica retorna a resposta original, mesmo após mudança de estado; corpo diferente retorna 409. A autenticação administrativa é revalidada antes do replay. Não registrar chave bruta ou contatos em logs. Respostas administrativas persistidas com PII exigem criptografia autenticada e retenção limitada; criar porta própria para o resultado idempotente e seguir o padrão AES-GCM do adapter de outbox, com chave e finalidade separadas (a porta de outbox é específica para e-mail).

**Motivo**: A constituição exige idempotência também em reagendamentos e alterações de configuração, não apenas na criação pública. Retornar o estado corrente não reproduziria a resposta original e poderia duplicar eventos.

**Alternativas consideradas**: Deduplicar somente reservas; rejeitada por permitir replay de comandos administrativos obsoletos. Guardar somente o ID do agendamento; rejeitada porque o recurso pode ter sido alterado entre tentativas.

**Decisão de proteção pública**: Usar contador PostgreSQL por tenant + hash HMAC do IP, com janela de 60 segundos: 120 leituras públicas e 10 tentativas de reserva, incluindo replay. Responder 429 com `Retry-After`; contadores expiram após duas janelas. Confiar em cabeçalhos de proxy somente nos CIDRs configurados. Os valores são parâmetros operacionais iniciais, não requisitos de produto. Evitar dependência de um gateway ainda inexistente.

### Configuração e reservas compartilham a mesma fronteira transacional

**Decisão**: Criar uma linha `scheduling.settings` por tenant, inclusive para tenants existentes no release. Toda mutação de agenda adquire `SELECT ... FOR UPDATE` nessa linha antes de ler configurações, catálogo, jornadas ou compromissos; depois bloqueia os agendamentos afetados em ordem de UUID. Em `READ COMMITTED`, carregar os dados relevantes após adquirir o lock. Todas as operações usam a mesma conexão/transação. GiST continua como proteção adicional.

**Motivo**: A constraint de intervalos não protege uma reserva de uma pausa criada simultaneamente. Serializar escritas por barbearia torna a validação de FR-014 atômica sem impedir leituras nem bloquear outras barbearias.

**Alternativas consideradas**: Locks somente por profissional exigem protocolo adicional para serviços compartilhados e mudanças de fuso; `SERIALIZABLE` exige retentativas completas. O lock por tenant reduz paralelismo de escrita da mesma barbearia, um compromisso explícito do MVP a medir antes de otimizar.

**Fonte primária**: [Locks explícitos do PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html).

Mudanças de jornada, novos bloqueios, desativação, remoção de elegibilidade ou mudança de fuso que invalidem compromissos confirmados retornam 409 com IDs dos afetados, somente ao administrador do tenant; nada é persistido. Nome, preço e duração corrente de serviço não reescrevem snapshots anteriores. Alterar intervalo/antecedência afeta novas reservas, sem invalidar compromissos existentes. Não existe confirmação que ignore conflitos.

### Antecedência e estados finais

**Decisão**: `minimum_advance_minutes` é inteiro não negativo, padrão 30. Capturar o instante atual após adquirir o lock de escrita e revalidar início >= agora + antecedência; com zero, início estritamente futuro. Reagendamento usa as mesmas políticas, o mesmo serviço/profissional e os snapshots originais. A consulta é indicativa; confirmar pode retornar 409 se o tempo decorrido tornar o horário inelegível.

**Motivo**: Implementa FR-020 a FR-022 sem aceitar um horário vencido entre busca e confirmação.

**Alternativas consideradas**: Validar apenas na busca; rejeitada por corrida temporal. Aplicar novas políticas retroativamente; rejeitada pela preservação dos compromissos.

**Decisão**: Somente `confirmed` permite cancelamento, reagendamento ou registro de resultado. `cancelled`, `attended` e `no_show` são terminais; novas alterações retornam 409. Replay da mesma chave é leitura da resposta armazenada, sem nova transição. `no_show` exige `agora >= starts_at`; `attended` exige `agora >= ends_at`. Ambos ocorrem após o intervalo ter começado, e atendimento só se conclui depois do horário. Cancelamento pode ocorrer antes do início. Eventos guardam estado anterior/novo, ator, tenant e instante.

**Motivo**: Preserva histórico e garante transições determinísticas. A restrição temporal é uma decisão de implementação conservadora para impedir marcar serviços futuros como realizados.

**Alternativas consideradas**: Reabrir estados finais; descartada pela clarificação explícita. Permitir resultado antes do fim; descartada por liberar um intervalo ainda em andamento.

### Conversão de horário civil

**Decisão**: Gerar candidatos locais e resolver a zona IANA no adapter de tempo; horários inexistentes em transições civis não são oferecidos, horários repetidos geram dois instantes distintos com offsets explícitos. Duração representa minutos decorridos. Testar lacunas, repetições, meia-noite e janela inclusiva hoje..hoje+30. Usar funcionalidades de zona do PostgreSQL/Intl atrás da porta e verificar os offsets candidatos por conversão de ida e volta, sem aceitar silenciosamente normalização de horário inexistente.

**Motivo**: O nome da zona e o offset do instante são informações distintas. A regra evita ambiguidade mesmo fora do fuso inicial brasileiro.

**Alternativas consideradas**: Fixar offset ou escolher implicitamente um dos horários repetidos; rejeitadas por perder disponibilidade ou reservar um instante diferente.

## Limites conhecidos e riscos residuais

- Não há volume real, SLO de latência ou política de retenção de histórico no requisito. Não particionar nem expurgar dados de agendamento automaticamente nesta entrega; medir e aprovar política antes de operar em escala maior.
- Constraint GiST protege intervalos por profissional, mas horários de expediente e exceções são regras de domínio e são validados após o lock compartilhado por todas as mutações do tenant.
- Alteração de timezone afeta a interpretação futura de jornadas recorrentes; compromissos já confirmados permanecem instantes UTC imutáveis.
