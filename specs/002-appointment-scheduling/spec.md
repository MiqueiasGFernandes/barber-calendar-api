# Especificação da Funcionalidade: Agendamento de Serviços

**Branch da Funcionalidade**: `002-appointment-scheduling`
**Criado em**: 2026-10-18
**Status**: Rascunho
**Entrada**: Descrição do usuário: "Preciso de ajuda para entender com base nas necessidades dos barbeiros qual seria a melhor forma de implementar o agendamento e disponibilizar cardeiras para os horários de forma que os clientes consigam agendar"

## Clarificações

### Session 2026-10-18

- Q: Qual dado de contato o cliente deve informar ao reservar como convidado? → A: Nome, telefone e e-mail.
- Q: Depois de confirmar um agendamento, quais estados a barbearia precisa registrar? → A: Confirmado, cancelado, atendido ou não compareceu.
- Q: Com quanta antecedência máxima o cliente deve poder reservar? → A: Até 30 dias.

### Session 2026-10-19

- Q: Quando uma mudança de expediente ou um novo bloqueio conflitar com agendamentos confirmados, o sistema deve impedir que a mudança seja salva? → A: Sim. Impedir a mudança até que o responsável cancele ou reagende os compromissos afetados e tente novamente.
- Q: De quanto em quanto tempo os horários de início devem ser oferecidos ao cliente? → A: Intervalo configurável por barbearia, com padrão de 15 minutos, a partir do início de cada período de expediente.
- Q: Qual deve ser a antecedência mínima para o cliente reservar um horário? → A: Antecedência configurável por barbearia, com padrão de 30 minutos e possibilidade de zero.
- Q: O responsável pode reabrir um agendamento cancelado, atendido ou marcado como “não compareceu”? → A: Não. Esses estados são finais; para reservar novamente, é necessário criar outro agendamento, preservando o histórico anterior.
- Q: O responsável deve poder marcar “não compareceu” assim que o horário começar, ou só depois que o horário terminar? → A: “Não compareceu” pode ser marcado a partir do início agendado; “atendido” somente após o término.
- Q: Quando o cliente aceita qualquer profissional, como o sistema deve escolher quem receberá o agendamento? → A: Escolher o profissional elegível com menos minutos de atendimentos confirmados naquele dia local; em caso de empate, desempatar pelo identificador do profissional. A escolha explícita do cliente sempre prevalece.
- Q: O responsável precisa consultar pela API o histórico de alterações de serviços, profissionais e configurações da agenda nesta versão? → A: Registrar o histórico para consulta interna por operação/suporte autorizado, sem novo endpoint nesta versão.


## Cenários de Usuário e Testes *(obrigatório)*

### História de Usuário 1 - Encontrar e Reservar um Horário (Prioridade: P1)

Um cliente escolhe a barbearia, o serviço desejado, um profissional específico ou qualquer profissional disponível, e uma data. O sistema apresenta somente horários nos quais o serviço completo pode ser realizado dentro do expediente e sem conflito. O cliente escolhe um horário livre e recebe confirmação do agendamento.

**Motivo da prioridade**: Permite que clientes marquem serviços sem depender de contato manual com a barbearia e transforma a disponibilidade real da equipe em opções fáceis de entender.

**Teste independente**: Cadastrar expediente, profissional e serviço; consultar um dia com disponibilidade e outro sem; concluir uma reserva e confirmar que o horário deixa de aparecer como livre.

**Cenários de aceite**:

1. **Dado que** há profissional ativo, serviço oferecido e expediente configurado, **Quando** o cliente consulta uma data, **Então** são apresentados somente inícios em que o serviço cabe integralmente na jornada e não sobrepõe bloqueios ou compromissos existentes.
2. **Dado que** dois clientes tentam reservar o mesmo profissional e intervalo, **Quando** as solicitações ocorrem ao mesmo tempo, **Então** exatamente um agendamento é confirmado e o outro recebe opções atualizadas sem criar conflito.
3. **Dado que** o cliente escolhe qualquer profissional disponível, **Quando** consulta horários, **Então** cada opção indica um horário em que pelo menos um profissional elegível consegue realizar o serviço.
4. **Dado que** um horário foi reservado, **Quando** outro cliente consulta a disponibilidade, **Então** o intervalo reservado não é oferecido para o mesmo profissional.
5. **Dado que** o cliente inicia uma reserva como convidado, **Quando** envia seus dados, **Então** nome, telefone e e-mail são obrigatórios e o agendamento só é confirmado se os três forem válidos.
6. **Dado que** o cliente consulta datas para reserva, **Quando** a data está depois dos próximos 30 dias contados no fuso da barbearia, **Então** a data não é oferecida para agendamento.
7. **Dado que** a antecedência mínima é de 30 minutos e o instante da consulta é 10:00, **Quando** o cliente busca horários, **Então** somente inícios a partir de 10:30 podem ser oferecidos, respeitando o intervalo configurado e a disponibilidade.
8. **Dado que** um horário atendia à antecedência mínima na consulta, **Quando** o tempo decorrido faz com que ele deixe de atender a essa regra na confirmação, **Então** a reserva é rejeitada sem criar agendamento.
9. **Dado que** a antecedência mínima foi configurada como zero, **Quando** o cliente consulta ou confirma uma reserva, **Então** somente horários futuros e disponíveis são aceitos.
10. **Dado que** o cliente aceita qualquer profissional, **Quando** confirma uma reserva, **Então** o sistema atribui o profissional elegível com menos minutos confirmados naquele dia local e, em caso de empate, aquele com menor identificador; se o cliente escolher um profissional, essa escolha prevalece.

### História de Usuário 2 - Configurar Serviços e Disponibilidade (Prioridade: P1)

O responsável da barbearia cadastra serviços, duração e profissionais aptos a realizá-los, define horários recorrentes de trabalho e registra pausas, folgas, feriados e exceções. A disponibilidade mostrada aos clientes acompanha essas configurações.

**Motivo da prioridade**: A agenda só é confiável quando reflete a rotina real de cada profissional e as diferenças de duração entre serviços.

**Teste independente**: Configurar dois profissionais com jornadas e serviços diferentes, adicionar uma pausa e uma folga excepcional e verificar que cada combinação produz apenas os horários válidos.

**Cenários de aceite**:

1. **Dado que** um profissional tem expediente recorrente e serviços habilitados, **Quando** o responsável salva a configuração, **Então** ela pode ser consultada para calcular disponibilidade futura.
2. **Dado que** há uma pausa ou exceção em uma data, **Quando** um cliente consulta o dia afetado, **Então** nenhum horário que atravesse esse período é oferecido.
3. **Dado que** um serviço tem duração maior que o intervalo restante do expediente, **Quando** a disponibilidade é calculada, **Então** o início não é apresentado.
4. **Dado que** um serviço foi desativado ou removido da oferta da barbearia, **Quando** o cliente inicia uma nova busca, **Então** esse serviço não pode ser selecionado nem agendado.
5. **Dado que** um período de expediente começa às 09:00 e a barbearia configura o intervalo em 20 minutos, **Quando** o cliente consulta a disponibilidade, **Então** os inícios candidatos são 09:00, 09:20, 09:40 e assim por diante, oferecendo apenas os que comportam o serviço completo sem conflitos.
6. **Dado que** a barbearia não personalizou o intervalo, **Quando** o cliente consulta a disponibilidade, **Então** os inícios candidatos são espaçados em 15 minutos a partir do início de cada período de expediente.
7. **Dado que** um responsável autorizado altera serviços, profissionais ou configurações da agenda, **Quando** a alteração é concluída, **Então** o histórico registra autor, instante, barbearia, recurso afetado e mudança realizada para consulta interna autorizada; uma alteração rejeitada não registra mudança concluída e a repetição da mesma operação não duplica o registro.

### História de Usuário 3 - Acompanhar e Alterar Agendamentos (Prioridade: P2)

O responsável da barbearia consulta a agenda por profissional e período, identifica compromissos e bloqueios, e pode cancelar ou reagendar um compromisso de forma clara. A agenda exibe o estado atualizado dos compromissos para os responsáveis da barbearia.

**Motivo da prioridade**: A rotina de uma barbearia muda; os profissionais precisam administrar a agenda e devolver horários cancelados à disponibilidade.

**Teste independente**: Criar um agendamento, consultá-lo na agenda, cancelá-lo e confirmar que o horário volta a ficar disponível; repetir com reagendamento e validar o novo intervalo.

**Cenários de aceite**:

1. **Dado que** um responsável autorizado consulta a agenda, **Quando** informa um período e um profissional, **Então** vê os agendamentos e bloqueios correspondentes da própria barbearia.
2. **Dado que** um agendamento é cancelado, **Quando** a alteração é concluída, **Então** seu estado muda para cancelado e o intervalo pode voltar a ser oferecido.
3. **Dado que** um agendamento é reagendado, **Quando** o novo horário é confirmado, **Então** o intervalo antigo é liberado e o novo só é reservado se ainda estiver disponível.
4. **Dado que** o atendimento foi realizado ou o cliente não compareceu, **Quando** o responsável atualiza o resultado, **Então** o agendamento passa para atendido ou não compareceu e permanece no histórico da agenda.
5. **Dado que** um agendamento está cancelado, atendido ou marcado como não compareceu, **Quando** o responsável tenta reabri-lo, reagendá-lo ou mudar seu estado, **Então** a operação é rejeitada e o histórico é preservado; uma nova reserva exige outro agendamento e todas as validações de disponibilidade.
6. **Dado que** um agendamento confirmado ainda não começou, **Quando** o responsável tenta marcá-lo como não compareceu, **Então** a operação é rejeitada sem alterar o estado.
7. **Dado que** o horário agendado começou, **Quando** o responsável marca o agendamento como não compareceu, **Então** o estado muda para não compareceu e o registro permanece no histórico.
8. **Dado que** o horário agendado ainda não terminou, **Quando** o responsável tenta marcá-lo como atendido, **Então** a operação é rejeitada sem alterar o estado.
9. **Dado que** o horário agendado terminou, **Quando** o responsável marca o agendamento como atendido, **Então** o estado muda para atendido e o registro permanece no histórico.

### Casos Limite

- Consultas de disponibilidade que coincidam com abertura, fechamento, pausas ou limites de expediente não podem oferecer um serviço que ultrapasse o período permitido.
- Mudanças no expediente ou em um serviço e novos bloqueios que conflitem com agendamentos confirmados devem ser rejeitados, informando os compromissos afetados ao responsável. A configuração anterior deve ser preservada até que o responsável cancele ou reagende esses compromissos e tente novamente.
- Horários são interpretados no fuso horário local da barbearia, inclusive em mudanças de horário civil.
- Solicitações repetidas do mesmo cliente não podem criar reservas duplicadas quando forem repetições da mesma operação.
- Cancelamentos concorrentes com uma nova reserva devem produzir uma disponibilidade consistente, sem dupla ocupação.
- Profissional ou serviço desativado não pode receber novos agendamentos; compromissos existentes permanecem visíveis para resolução pelo responsável.
- A disponibilidade é controlada por profissional; cadeiras físicas não são recursos de capacidade independentes nesta versão.
- Clientes podem reservar como convidados, sem criar conta, informando os dados de contato necessários.

## Requisitos *(obrigatório)*

### Requisitos Funcionais

- **FR-001**: O responsável da barbearia DEVE cadastrar e manter serviços com nome, duração, preço informado ao cliente e estado ativo ou inativo.
- **FR-002**: O responsável DEVE associar cada serviço aos profissionais habilitados para realizá-lo.
- **FR-003**: O responsável DEVE definir jornadas recorrentes por profissional, incluindo dias de trabalho e períodos de início e término.
- **FR-004**: O responsável DEVE registrar exceções à jornada, incluindo pausas, folgas, feriados, afastamentos e bloqueios pontuais.
- **FR-005**: O sistema DEVE calcular os horários disponíveis a partir da jornada do profissional, duração do serviço, pausas, exceções, compromissos e recursos de capacidade aplicáveis. Os inícios candidatos DEVEM seguir o intervalo configurado pela barbearia, contado a partir do início de cada período de expediente; somente candidatos em que o serviço completo caiba sem conflito DEVEM ser oferecidos.
- **FR-006**: O cliente DEVE poder consultar serviços ativos, profissionais elegíveis e horários disponíveis por data para uma barbearia selecionada.
- **FR-007**: O cliente DEVE poder escolher um profissional específico ou solicitar o primeiro profissional disponível para o serviço e horário selecionados. Quando aceitar qualquer profissional, o sistema DEVE atribuir aquele com menos minutos de atendimentos confirmados no dia local do início; empates DEVEM ser resolvidos pelo menor identificador do profissional. A escolha explícita do cliente sempre prevalece.
- **FR-008**: O cliente DEVE poder criar um agendamento como convidado, sem criar conta, informando seu nome, telefone e e-mail, além da barbearia, serviço, profissional atribuído, início e fim.
- **FR-009**: O sistema DEVE confirmar um agendamento somente após revalidar a disponibilidade e garantir que não exista conflito de profissional ou capacidade no intervalo inteiro do serviço.
- **FR-010**: Reservas concorrentes para a mesma capacidade e intervalo DEVEM resultar em no máximo um agendamento confirmado; solicitações sem sucesso DEVEM receber uma resposta que permita escolher outra opção.
- **FR-011**: Agendamentos DEVEM pertencer a exatamente uma barbearia e todas as consultas e alterações do responsável DEVEM permanecer restritas à sua barbearia.
- **FR-012**: O responsável DEVE consultar agendamentos por período, profissional e estado, sem visualizar dados de outra barbearia.
- **FR-013**: O responsável DEVE poder cancelar e reagendar agendamentos no estado confirmado, preservando o registro do estado anterior e liberando o horário antigo somente após a operação ser concluída.
- **FR-014**: Alterações em jornadas, serviços e capacidade e novos bloqueios que conflitem com compromissos confirmados DEVEM ser rejeitados sem aplicar a mudança, preservando a configuração anterior e informando os compromissos afetados ao responsável. A mudança só pode ser aplicada em nova tentativa após o responsável cancelar ou reagendar os compromissos conflitantes.
- **FR-015**: Instantes de início e término DEVEM ser interpretados e apresentados no fuso horário da barbearia.
- **FR-016**: A resposta de disponibilidade DEVE indicar serviço, duração, data, hora local e profissional ou profissionais elegíveis para cada opção.
- **FR-017**: A confirmação da reserva DEVE informar ao cliente se o horário foi reservado ou se deixou de estar disponível, sem revelar dados de outros clientes ou agendamentos.
- **FR-018**: O sistema DEVE impedir que cada profissional tenha atendimentos sobrepostos; cadeiras físicas não limitam a capacidade de forma independente nesta versão.
- **FR-019**: Uma reserva concluída DEVE iniciar no estado confirmado; o responsável DEVE poder alterar esse estado para cancelado, atendido ou não compareceu. Esses três estados DEVEM ser finais e permanecer consultáveis no histórico, sem permitir reabertura, reagendamento ou transição para outro estado. Para reservar novamente, DEVE ser criado outro agendamento, sujeito a todas as regras de reserva, preservando o registro anterior.
- **FR-020**: O cliente DEVE poder consultar disponibilidade desde a data atual até 30 dias corridos à frente no fuso horário da barbearia; datas posteriores não DEVEM aceitar reservas. A consulta e a confirmação DEVEM respeitar a antecedência mínima configurada pela barbearia e excluir horários passados.
- **FR-021**: O responsável DEVE poder configurar o intervalo entre horários de início oferecidos na barbearia, em minutos inteiros positivos, com padrão de 15 minutos. Essa configuração DEVE ser aplicada a todos os profissionais e serviços da barbearia, sem alterar a duração dos serviços nem os agendamentos existentes.
- **FR-022**: O responsável DEVE poder configurar a antecedência mínima para reservas na barbearia em minutos inteiros não negativos, com padrão de 30 minutos. A consulta e a confirmação DEVEM exigir início igual ou posterior ao instante da operação acrescido da antecedência configurada; com zero, somente inícios futuros DEVEM ser aceitos. Mudanças nessa configuração não DEVEM alterar agendamentos já confirmados.
- **FR-023**: Alterações concluídas de serviços, profissionais e configurações da agenda — incluindo ativação/desativação, elegibilidade, jornadas, exceções, fuso, intervalo e antecedência — DEVEM registrar autor, instante, barbearia, recurso afetado e valores anteriores e novos dos campos alterados em trilha de auditoria, sem dados de contato de clientes ou segredos. O registro DEVE ser preservado junto com a alteração, sem duplicação em repetições da mesma operação e sem registrar alterações rejeitadas como concluídas. A consulta desse histórico DEVE ser restrita à operação/suporte autorizado, respeitando o escopo da barbearia; nenhum novo endpoint de consulta será oferecido nesta versão.

### Entidades Principais

- **Serviço**: Atendimento oferecido pela barbearia, com nome, duração estimada, preço e estado de disponibilidade.
- **Profissional**: Pessoa que realiza serviços, vinculada a uma barbearia, com estado ativo e jornada própria.
- **Configuração de Disponibilidade da Barbearia**: Intervalo entre horários de início oferecidos, em minutos inteiros positivos, com padrão de 15 minutos; antecedência mínima para reservas, em minutos inteiros não negativos, com padrão de 30 minutos e possibilidade de zero.
- **Jornada de Trabalho**: Períodos recorrentes em que um profissional pode atender, com fuso horário da barbearia.
- **Exceção de Disponibilidade**: Pausa, folga, feriado, afastamento ou bloqueio que altera a jornada em uma data ou intervalo.
- **Agendamento**: Reserva de um serviço em um intervalo, para uma barbearia, um profissional e um cliente, com estado confirmado, cancelado, atendido ou não compareceu, além dos dados de contato necessários.
- **Cliente**: Pessoa que solicita um agendamento como convidada, informando nome, telefone e e-mail, sem precisar criar conta.

## Critérios de Sucesso *(obrigatório)*

### Resultados Mensuráveis

- **SC-001**: Em todos os testes de disponibilidade, nenhum horário oferecido ultrapassa o expediente, atravessa uma pausa ou sobrepõe um compromisso ou bloqueio aplicável.
- **SC-002**: Em todos os testes concorrentes para a mesma capacidade e intervalo, no máximo um cliente conclui a reserva.
- **SC-003**: Pelo menos 90% dos clientes de teste conseguem encontrar e reservar um serviço disponível em até três minutos, sem ajuda do responsável.
- **SC-004**: O responsável consegue cadastrar um serviço, configurar a jornada de um profissional e publicar horários para reserva em até cinco minutos.
- **SC-005**: Em todos os testes de isolamento, responsáveis não conseguem consultar agendamentos de outra barbearia e respostas de reserva para convidados não revelam dados de outros clientes ou agendamentos.
- **SC-006**: Após cancelamento confirmado, o horário elegível volta a aparecer na disponibilidade em até cinco segundos; após reagendamento, apenas o novo intervalo permanece reservado.
- **SC-007**: Em 100% dos testes de mudança de jornada, serviço ou capacidade ou criação de bloqueio com conflito, a operação é rejeitada, a configuração anterior e os compromissos confirmados são preservados e os conflitos são informados. Após cancelar ou reagendar os compromissos afetados, uma nova tentativa sem conflitos permite aplicar a mudança.
- **SC-008**: Em 100% dos testes de ciclo do agendamento, cancelamentos, atendimentos realizados e não comparecimentos recebem o estado correto e continuam consultáveis no histórico; tentativas de reabrir, reagendar ou alterar o estado de agendamentos finais são rejeitadas sem modificar o registro anterior; resultados informados antes do instante permitido são rejeitados.
- **SC-009**: Em todos os testes de auditoria administrativa, cada alteração concluída prevista em FR-023 possui registro com autor, instante, barbearia, recurso e valores anteriores e novos; falhas não deixam alteração sem auditoria nem registro de mudança concluída inexistente, e repetições não duplicam registros. A consulta interna respeita autorização e escopo da barbearia e não há novo endpoint de consulta desse histórico.

## Premissas

- A barbearia é a fronteira de propriedade dos serviços, profissionais, jornadas, bloqueios e agendamentos.
- Profissionais podem ter jornadas diferentes; horários de funcionamento da barbearia não bastam para determinar disponibilidade individual.
- A duração de cada serviço determina o tamanho do intervalo reservado; o mesmo dia pode oferecer horários diferentes conforme o serviço e o profissional.
- Por padrão, horários são confirmados imediatamente quando continuam disponíveis no momento da reserva; aprovação manual posterior não faz parte do fluxo inicial.
- Por padrão, clientes podem escolher um profissional específico ou aceitar qualquer profissional habilitado para o serviço.
- A janela máxima de reserva é de 30 dias corridos a partir da data atual no fuso horário da barbearia.
- Alterações futuras de expediente e novos bloqueios não reescrevem agendamentos existentes; mudanças conflitantes são impedidas até que o responsável cancele ou reagende os compromissos afetados e tente novamente.
- Clientes podem reservar sem conta, informando nome, telefone e e-mail; alterações e consultas posteriores são realizadas pelo responsável da barbearia nesta versão.
- A capacidade é controlada pela agenda individual dos profissionais; cadeiras físicas não são recursos reserváveis independentes no escopo inicial.
- Pagamento antecipado, recorrência, lista de espera, encaixes e notificações por canais externos ficam fora do escopo inicial.
- O cliente escolhe a barbearia antes de consultar disponibilidade; busca agregada entre várias barbearias fica fora do escopo inicial.
