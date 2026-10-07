# Especificação da Funcionalidade: Autenticação de Tenant sem Senha

**Branch da Funcionalidade**: `001-tenant-authentication`
**Criado em**: 2026-09-28
**Última Atualização**: 2026-10-07
**Status**: Rascunho
**Entrada**: Descrição do usuário: "Quero que o login seja feito exclusivamente por OTP enviado por e-mail e que a expiração das sessões seja configurável no ambiente da aplicação, com padrão de 24 horas."

## Clarifications

### Session 2026-10-07

- Q: Em que momento a conta e o tenant devem ser criados durante o cadastro por OTP? → A: Criar uma tentativa provisória e somente criar conta, tenant e vínculo após validar o OTP.
- Q: O login também deve aceitar OTP por celular? → A: Não; manter somente OTP por e-mail para evitar custos de SMS.
- Q: Qual deve ser a duração padrão das sessões autenticadas? → A: 24 horas, permitindo substituição por configuração do ambiente da aplicação.
- Q: Qual deve ser a duração máxima permitida para uma sessão configurada? → A: 7 dias.
- Q: Quais limites adicionais devem controlar a solicitação de OTP, além do intervalo de reenvio de 60 segundos? → A: Até 5 solicitações por e-mail e 20 por IP a cada 15 minutos.
- Q: Qual deve ser a duração mínima permitida para uma sessão configurada? → A: 15 minutos.
- Q: O que deve acontecer com sessões anteriores quando o mesmo usuário realiza um novo login? → A: Manter todas as sessões válidas até suas próprias expirações.
- Q: Quais limites devem acumular falhas de verificação de OTP entre diferentes desafios e reemissões? → A: Até 10 falhas por e-mail e 50 por IP em uma hora.

## Cenários de Usuário e Testes *(obrigatório)*

### História de Usuário 1 - Estabelecer e Verificar o Primeiro Administrador (Prioridade: P1)

Um proprietário informa os dados da barbearia e um endereço de e-mail, sem escolher senha. O sistema cria apenas uma tentativa provisória de cadastro e envia um código de uso único para esse endereço. Ao informar o código válido, o sistema comprova o controle do e-mail, cria atomicamente o tenant, a conta ativa e o primeiro vínculo de administrador e inicia uma sessão restrita ao novo tenant.

**Motivo da prioridade**: Este é o caminho completo mais curto para integração e estabelece a fronteira do tenant e o primeiro administrador confiável.

**Teste independente**: Iniciar um cadastro com dados únicos, confirmar que ainda não existem tenant, conta ou vínculo definitivos, obter e verificar o código e então confirmar a criação atômica dos registros e o acesso apenas ao novo tenant.

**Cenários de aceite**:

1. **Dado que** nenhum tenant ou conta usa os identificadores informados, **Quando** dados válidos de cadastro são enviados, **Então** somente uma tentativa provisória, um desafio OTP e uma solicitação de entrega são criados, sem criar tenant, conta ou vínculo definitivos.
2. **Dado que** o OTP de cadastro é válido e não foi usado, **Quando** ele é verificado antes de expirar, **Então** o desafio é consumido e tenant, conta ativa, vínculo de administrador e evento de segurança são criados atomicamente antes do retorno de um token restrito ao tenant.
3. **Dado que** o e-mail ou o identificador do tenant se torna indisponível antes da verificação, **Quando** a conclusão do cadastro é tentada, **Então** nenhum registro definitivo parcial permanece e a tentativa provisória não concede acesso.

### História de Usuário 2 - Retornar com um OTP por E-mail (Prioridade: P2)

Um membro cadastrado solicita um código para um endereço de e-mail e tenant, recebe a mesma confirmação pública independentemente da existência da conta e usa o código entregue para retomar uma sessão restrita ao tenant sem senha.

**Motivo da prioridade**: Usuários recorrentes precisam da jornada simplificada sem senha, enquanto o vínculo com o tenant continua sendo a fonte da autorização.

**Teste independente**: Solicitar e verificar um código para um membro ativo, confirmar o acesso ao tenant solicitado e que o token não acessa um tenant não relacionado.

**Cenários de aceite**:

1. **Dado que** existe uma conta ativa com vínculo ativo em um tenant ativo, **Quando** um OTP é solicitado, **Então** um novo desafio é criado, desafios pendentes anteriores são substituídos e a entrega entra na fila.
2. **Dado que** o e-mail, a conta, o vínculo ou o tenant é desconhecido ou inativo, **Quando** um OTP é solicitado, **Então** a resposta é indistinguível de uma solicitação válida e nenhum código utilizável é criado.
3. **Dado que** há um código válido e não utilizado, **Quando** ele é verificado antes de expirar, **Então** o desafio é consumido atomicamente e uma sessão com a duração configurada e apenas a autoridade do vínculo verificado é retornada.
4. **Dado que** o código está expirado, substituído, consumido, malformado ou incorreto, **Quando** a verificação é tentada, **Então** nenhum token é emitido e a resposta não revela a condição que falhou.
5. **Dado que** nenhuma duração de sessão foi configurada no ambiente, **Quando** um OTP válido é verificado, **Então** a nova sessão expira 24 horas após sua emissão.

### História de Usuário 3 - Reemitir com Segurança (Prioridade: P3)

Uma pessoa que não recebeu um código pode solicitar outro após um curto intervalo. O novo código substitui o anterior, e tentativas repetidas de emissão ou verificação sofrem limitação de frequência.

**Motivo da prioridade**: O reenvio confiável é essencial para a usabilidade sem senha e não deve permitir inundação de mensagens ou força bruta.

**Teste independente**: Solicitar um segundo código após o intervalo, confirmar que o primeiro é rejeitado, que o segundo funciona uma vez e que os limites entram em vigor de forma previsível.

**Cenários de aceite**:

1. **Dado que** há um desafio pendente dentro do intervalo de reenvio, **Quando** outro código é solicitado, **Então** nenhuma mensagem adicional é enviada e a resposta pública permanece segura.
2. **Dado que** um novo código é emitido após o intervalo, **Quando** qualquer código é enviado, **Então** apenas o mais recente pode funcionar.
3. **Dado que** ocorreram cinco tentativas incorretas, **Quando** outra tentativa é feita, **Então** o desafio fica bloqueado.
4. **Dado que** um e-mail atingiu cinco solicitações ou um IP atingiu vinte solicitações em uma janela de 15 minutos, **Quando** outra solicitação é feita no mesmo escopo, **Então** uma resposta consistente de limitação, com orientação para nova tentativa, é retornada e nenhum e-mail adicional é enviado.
5. **Dado que** um e-mail acumulou dez falhas ou um IP acumulou cinquenta falhas de verificação em uma hora, mesmo entre desafios diferentes, **Quando** outra verificação é tentada, **Então** ela é limitada sem revelar qual escopo foi atingido.

### Casos Limite

- Conclusões concorrentes de cadastro para o mesmo e-mail normalizado ou tenant resultam em, no máximo, um cadastro definitivo e não deixam registros parciais.
- Uma tentativa provisória expirada nunca cria tenant, conta ou vínculo e pode ser removida conforme a política operacional de retenção.
- E-mails que diferem apenas em maiúsculas, minúsculas ou espaços externos representam a mesma identidade.
- Códigos são criptograficamente seguros, têm seis dígitos, expiram em 10 minutos e são aceitos uma única vez.
- Um novo desafio substitui todos os anteriores pendentes para a mesma conta, tenant e finalidade.
- Falhas persistem entre reemissões durante a janela de limitação; solicitar novo código não reinicia a proteção contra força bruta.
- Os limites de emissão são avaliados independentemente por e-mail normalizado e por IP; atingir qualquer um deles bloqueia nova emissão até o fim da janela aplicável.
- Falhas de verificação acumuladas por e-mail normalizado e IP sobrevivem à substituição ou reemissão de desafios; identidade desconhecida ainda é limitada pela origem.
- A verificação concorrente do mesmo código produz exatamente uma resposta bem-sucedida com token.
- Suspensão de conta ou tenant e desativação do vínculo impedem entrega de código utilizável e emissão de token.
- Falhas de entrega são registradas sem expor e-mail ou OTP em logs ou respostas públicas.
- O OTP nunca é persistido, retornado pela API ou registrado de forma legível; somente o adaptador local de e-mail pode exibir a mensagem enviada em ambiente de desenvolvimento.
- Uma duração de sessão configurada abaixo de 15 minutos, superior a 7 dias ou malformada impede a inicialização da aplicação com essa configuração.
- Alterar a duração configurada afeta somente sessões emitidas depois que a nova configuração entra em vigor; sessões existentes preservam sua expiração original.
- Um novo login não invalida sessões anteriores da mesma conta; cada sessão continua sujeita à própria expiração e à revalidação de conta, tenant e vínculo ativos.

## Requisitos *(obrigatório)*

### Requisitos Funcionais

- **FR-001**: O sistema DEVE permitir iniciar o cadastro de um novo tenant de barbearia e seu primeiro administrador sem criar senha.
- **FR-002**: A solicitação inicial de cadastro DEVE criar apenas uma tentativa provisória, um desafio OTP, uma solicitação de entrega e um evento de segurança, sem criar tenant, conta ou vínculo definitivos.
- **FR-003**: A verificação válida do OTP de cadastro DEVE consumir o desafio e criar tenant, conta ativa e vínculo de administrador em uma única transação, garantindo a unicidade do e-mail normalizado e do identificador do tenant no momento da confirmação.
- **FR-004**: O sistema DEVE validar toda entrada antes que alcance operações de negócio do tenant.
- **FR-005**: O sistema DEVE permitir solicitar OTP por e-mail normalizado e tenant, retornando a mesma confirmação para identidades conhecidas e desconhecidas.
- **FR-006**: O OTP DEVE ter seis dígitos, ser criptograficamente seguro, expirar em 10 minutos e ser aceito uma única vez.
- **FR-007**: O sistema DEVE persistir apenas um resumo com chave do OTP e NUNCA DEVE reter, retornar ou registrar o código legível fora da carga de entrega.
- **FR-008**: Um novo OTP DEVE substituir desafios pendentes no mesmo escopo.
- **FR-009**: A verificação DEVE limitar cinco falhas por desafio, dez falhas por e-mail normalizado e cinquenta falhas por IP em cada janela de uma hora, sem reiniciar os contadores acumulados na reemissão ou substituição do desafio.
- **FR-010**: A verificação bem-sucedida DEVE consumir atomicamente o desafio e confirmar todas as alterações associadas antes de retornar uma sessão com expiração definida.
- **FR-011**: Toda solicitação autenticada DEVE derivar acesso de conta, tenant e vínculo ativos verificados pelo servidor, não apenas do tenant informado pelo cliente.
- **FR-012**: Falhas DEVEM usar respostas e tempos que não revelem a existência de e-mail, conta, tenant ou vínculo, salvo conflito genérico de cadastro.
- **FR-013**: A entrega DEVE usar caixa de saída transacional para não perder desafios confirmados em falhas transitórias.
- **FR-014**: O sistema DEVE impor intervalo mínimo de reenvio de 60 segundos, limite de cinco solicitações por e-mail normalizado e vinte por IP em cada janela de 15 minutos, retornando orientação consistente de nova tentativa sem enviar mensagem adicional.
- **FR-015**: Contas e tenants suspensos e vínculos inativos DEVEM ter acesso negado mesmo com OTP válido.
- **FR-016**: Eventos de segurança DEVEM registrar tipo, resultado, instante, correlação, tenant e ator quando conhecidos, sem OTP, token ou dados pessoais desnecessários.
- **FR-017**: Cadastro, solicitação e verificação DEVEM expor semânticas consistentes de sucesso e erro para contratos públicos.
- **FR-018**: Gerador de OTP, entrega, emissor de token e persistência DEVEM ser acessados por portas da aplicação.
- **FR-019**: Quando a entrega assíncrona exigir retenção transitória do OTP legível, destinatário e mensagem DEVEM permanecer cifrados, acessíveis somente ao entregador e ser expurgados após entrega, falha terminal ou expiração.
- **FR-020**: O sistema NÃO DEVE oferecer solicitação, entrega ou verificação de OTP por SMS nesta funcionalidade.
- **FR-021**: O sistema DEVE permitir configurar externamente uma duração entre 15 minutos e 7 dias para novas sessões e DEVE usar 24 horas quando essa configuração estiver ausente.
- **FR-022**: Cada sessão DEVE registrar uma expiração igual ao instante de emissão acrescido da duração vigente naquele momento.
- **FR-023**: Uma alteração da duração configurada NÃO DEVE modificar a expiração de sessões previamente emitidas.
- **FR-024**: O sistema DEVE rejeitar configurações de duração malformadas, inferiores a 15 minutos ou superiores a 7 dias antes de aceitar solicitações de autenticação.
- **FR-025**: O sistema DEVE permitir sessões simultâneas da mesma conta e NÃO DEVE invalidar uma sessão existente apenas porque outra sessão foi emitida.

### Entidades Principais

- **Tentativa de Cadastro**: Registro provisório e expirável que contém os dados necessários para concluir o cadastro, sem representar conta, tenant, vínculo ou autorização definitivos.
- **Tenant**: A barbearia como fronteira primária de propriedade e autorização, com identificador único e status ativo ou suspenso.
- **Conta de Usuário**: Identidade criada somente após a verificação bem-sucedida do OTP de cadastro, com e-mail normalizado único e status ativo ou suspenso, sem credencial de senha.
- **Vínculo com Tenant**: Relação que concede à conta um papel em exatamente um tenant; o vínculo inaugural é administrador.
- **Desafio OTP**: Desafio confidencial, de uso único e com expiração, restrito a conta, tenant e finalidade.
- **Sessão Autenticada**: Autorização temporária vinculada à conta, tenant e vínculo verificados, com instantes imutáveis de emissão e expiração.
- **Evento de Segurança**: Tentativa ou transição auditável com referências seguras e sem material de OTP ou token.

## Critérios de Sucesso *(obrigatório)*

### Resultados Mensuráveis

- **SC-001**: Pelo menos 90% dos novos proprietários concluem cadastro, recebimento do código e entrada em até três minutos sem assistência.
- **SC-002**: Pelo menos 95% das decisões de OTP terminam em até dois segundos, excluindo e-mail assíncrono, sob 100 tentativas simultâneas.
- **SC-003**: Em 100 conclusões concorrentes de cadastro para o mesmo e-mail ou identificador de tenant, exatamente uma cria os registros definitivos e nenhum estado parcial permanece.
- **SC-004**: Em todos os testes, um membro obtém zero registros protegidos de outro tenant.
- **SC-005**: Pelo menos 90% dos usuários com OTP válido concluem o login em até dois minutos.
- **SC-006**: OTPs inválidos, expirados, consumidos, substituídos, bloqueados ou malformados produzem zero tokens.
- **SC-007**: Respostas públicas não permitem inferir existência de conta ou vínculo com precisão superior ao acaso.
- **SC-008**: Na verificação concorrente de um desafio válido, exatamente uma solicitação funciona.
- **SC-009**: Todo resultado testado produz evento rastreável sem expor OTP ou token.
- **SC-010**: Em 100% dos testes, novas sessões expiram na duração configurada, usam 24 horas na ausência de configuração, rejeitam durações fora do intervalo de 15 minutos a 7 dias e deixam de autorizar acesso após o instante de expiração.
- **SC-011**: Em 100% dos testes de limite, a sexta solicitação do mesmo e-mail ou a vigésima primeira do mesmo IP dentro de 15 minutos produz zero novos e-mails e informa quando uma nova tentativa pode ocorrer.
- **SC-012**: Em 100% dos testes com logins sucessivos, cada sessão permanece utilizável até sua própria expiração, salvo quando conta, tenant ou vínculo deixa de ser elegível.
- **SC-013**: Em 100% dos testes entre desafios, a décima primeira falha do mesmo e-mail ou a quinquagésima primeira do mesmo IP dentro de uma hora é limitada e produz zero sessões.

## Premissas

- A funcionalidade atende proprietários e membros; autenticação de clientes está fora do escopo inicial.
- Não há senha, alteração de senha ou recuperação de senha como alternativa.
- E-mail é o único canal de entrega de OTP no escopo inicial; autenticação por telefone e SMS está fora do escopo.
- OTP por e-mail é uma escolha de MVP de baixa garantia e não é apresentado como MFA, resistente a phishing ou suficiente para operações de alto risco.
- A solicitação de cadastro cria somente uma tentativa provisória; tenant, conta ativa e vínculo são criados apenas após a verificação bem-sucedida do OTP.
- A carga inicial é de até 100 tentativas simultâneas.
- A verificação retorna bearer token restrito ao tenant com duração configurável por variável de ambiente, inclusive via arquivo `.env` no desenvolvimento; na ausência da configuração, a duração é de 24 horas e o intervalo permitido vai de 15 minutos a 7 dias.
- Refresh, renovação automática e revogação ampla ficam para a gestão de sessões futura.
- Uma conta pode manter sessões simultâneas em diferentes dispositivos e tenants para os quais possua vínculo ativo.
