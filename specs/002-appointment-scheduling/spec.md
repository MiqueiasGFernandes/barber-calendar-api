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

### História de Usuário 2 - Configurar Serviços e Disponibilidade (Prioridade: P1)

O responsável da barbearia cadastra serviços, duração e profissionais aptos a realizá-los, define horários recorrentes de trabalho e registra pausas, folgas, feriados e exceções. A disponibilidade mostrada aos clientes acompanha essas configurações.

**Motivo da prioridade**: A agenda só é confiável quando reflete a rotina real de cada profissional e as diferenças de duração entre serviços.

**Teste independente**: Configurar dois profissionais com jornadas e serviços diferentes, adicionar uma pausa e uma folga excepcional e verificar que cada combinação produz apenas os horários válidos.

**Cenários de aceite**:

1. **Dado que** um profissional tem expediente recorrente e serviços habilitados, **Quando** o responsável salva a configuração, **Então** ela pode ser consultada para calcular disponibilidade futura.
2. **Dado que** há uma pausa ou exceção em uma data, **Quando** um cliente consulta o dia afetado, **Então** nenhum horário que atravesse esse período é oferecido.
3. **Dado que** um serviço tem duração maior que o intervalo restante do expediente, **Quando** a disponibilidade é calculada, **Então** o início não é apresentado.
4. **Dado que** um serviço foi desativado ou removido da oferta da barbearia, **Quando** o cliente inicia uma nova busca, **Então** esse serviço não pode ser selecionado nem agendado.

### História de Usuário 3 - Acompanhar e Alterar Agendamentos (Prioridade: P2)

O responsável da barbearia consulta a agenda por profissional e período, identifica compromissos e bloqueios, e pode cancelar ou reagendar um compromisso de forma clara. A agenda exibe o estado atualizado dos compromissos para os responsáveis da barbearia.

**Motivo da prioridade**: A rotina de uma barbearia muda; os profissionais precisam administrar a agenda e devolver horários cancelados à disponibilidade.

**Teste independente**: Criar um agendamento, consultá-lo na agenda, cancelá-lo e confirmar que o horário volta a ficar disponível; repetir com reagendamento e validar o novo intervalo.

**Cenários de aceite**:

1. **Dado que** um responsável autorizado consulta a agenda, **Quando** informa um período e um profissional, **Então** vê os agendamentos e bloqueios correspondentes da própria barbearia.
2. **Dado que** um agendamento é cancelado, **Quando** a alteração é concluída, **Então** seu estado muda para cancelado e o intervalo pode voltar a ser oferecido.
3. **Dado que** um agendamento é reagendado, **Quando** o novo horário é confirmado, **Então** o intervalo antigo é liberado e o novo só é reservado se ainda estiver disponível.
4. **Dado que** o atendimento foi realizado ou o cliente não compareceu, **Quando** o responsável atualiza o resultado, **Então** o agendamento passa para atendido ou não compareceu e permanece no histórico da agenda.

### Casos Limite

- Consultas de disponibilidade que coincidam com abertura, fechamento, pausas ou limites de expediente não podem oferecer um serviço que ultrapasse o período permitido.
- Mudanças no expediente ou em um serviço não alteram silenciosamente agendamentos já confirmados; o responsável deve identificar possíveis conflitos antes de concluir a mudança.
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
- **FR-005**: O sistema DEVE calcular os horários disponíveis a partir da jornada do profissional, duração do serviço, pausas, exceções, compromissos e recursos de capacidade aplicáveis; não deve depender de uma lista fixa de horários que ignore a duração do serviço.
- **FR-006**: O cliente DEVE poder consultar serviços ativos, profissionais elegíveis e horários disponíveis por data para uma barbearia selecionada.
- **FR-007**: O cliente DEVE poder escolher um profissional específico ou solicitar o primeiro profissional disponível para o serviço e horário selecionados.
- **FR-008**: O cliente DEVE poder criar um agendamento como convidado, sem criar conta, informando seu nome, telefone e e-mail, além da barbearia, serviço, profissional atribuído, início e fim.
- **FR-009**: O sistema DEVE confirmar um agendamento somente após revalidar a disponibilidade e garantir que não exista conflito de profissional ou capacidade no intervalo inteiro do serviço.
- **FR-010**: Reservas concorrentes para a mesma capacidade e intervalo DEVEM resultar em no máximo um agendamento confirmado; solicitações sem sucesso DEVEM receber uma resposta que permita escolher outra opção.
- **FR-011**: Agendamentos DEVEM pertencer a exatamente uma barbearia e todas as consultas e alterações do responsável DEVEM permanecer restritas à sua barbearia.
- **FR-012**: O responsável DEVE consultar agendamentos por período, profissional e estado, sem visualizar dados de outra barbearia.
- **FR-013**: O responsável DEVE poder cancelar e reagendar agendamentos, preservando o registro do estado anterior e liberando o horário antigo somente após a operação ser concluída.
- **FR-014**: Alterações em jornadas, serviços e capacidade que afetem compromissos existentes DEVEM informar os conflitos antes de serem aplicadas e não podem alterar ou cancelar compromissos confirmados silenciosamente.
- **FR-015**: Instantes de início e término DEVEM ser interpretados e apresentados no fuso horário da barbearia.
- **FR-016**: A resposta de disponibilidade DEVE indicar serviço, duração, data, hora local e profissional ou profissionais elegíveis para cada opção.
- **FR-017**: A confirmação da reserva DEVE informar ao cliente se o horário foi reservado ou se deixou de estar disponível, sem revelar dados de outros clientes ou agendamentos.
- **FR-018**: O sistema DEVE impedir que cada profissional tenha atendimentos sobrepostos; cadeiras físicas não limitam a capacidade de forma independente nesta versão.
- **FR-019**: Uma reserva concluída DEVE iniciar no estado confirmado; o responsável DEVE poder alterar esse estado para cancelado, atendido ou não compareceu, e estados finais DEVEM permanecer consultáveis no histórico.
- **FR-020**: O cliente DEVE poder consultar disponibilidade desde a data atual até 30 dias corridos à frente no fuso horário da barbearia; datas posteriores não DEVEM aceitar reservas.

### Entidades Principais

- **Serviço**: Atendimento oferecido pela barbearia, com nome, duração estimada, preço e estado de disponibilidade.
- **Profissional**: Pessoa que realiza serviços, vinculada a uma barbearia, com estado ativo e jornada própria.
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
- **SC-007**: Em 100% dos testes de mudança de jornada, serviço ou capacidade, compromissos já confirmados não são alterados sem ação explícita do responsável.
- **SC-008**: Em 100% dos testes de ciclo do agendamento, cancelamentos, atendimentos realizados e não comparecimentos recebem o estado correto e continuam consultáveis no histórico.

## Premissas

- A barbearia é a fronteira de propriedade dos serviços, profissionais, jornadas, bloqueios e agendamentos.
- Profissionais podem ter jornadas diferentes; horários de funcionamento da barbearia não bastam para determinar disponibilidade individual.
- A duração de cada serviço determina o tamanho do intervalo reservado; o mesmo dia pode oferecer horários diferentes conforme o serviço e o profissional.
- Por padrão, horários são confirmados imediatamente quando continuam disponíveis no momento da reserva; aprovação manual posterior não faz parte do fluxo inicial.
- Por padrão, clientes podem escolher um profissional específico ou aceitar qualquer profissional habilitado para o serviço.
- A janela máxima de reserva é de 30 dias corridos a partir da data atual no fuso horário da barbearia.
- Alterações futuras de expediente não reescrevem agendamentos existentes; conflitos devem ser resolvidos explicitamente pelo responsável.
- Clientes podem reservar sem conta, informando nome, telefone e e-mail; alterações e consultas posteriores são realizadas pelo responsável da barbearia nesta versão.
- A capacidade é controlada pela agenda individual dos profissionais; cadeiras físicas não são recursos reserváveis independentes no escopo inicial.
- Pagamento antecipado, recorrência, lista de espera, encaixes e notificações por canais externos ficam fora do escopo inicial.
- O cliente escolhe a barbearia antes de consultar disponibilidade; busca agregada entre várias barbearias fica fora do escopo inicial.
