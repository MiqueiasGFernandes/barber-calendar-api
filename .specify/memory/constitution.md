<!--
Sync Impact Report
- Version change: scaffold (unversioned) -> 1.0.0
- Modified principles:
  - Template placeholder -> I. Isolamento Multi-Tenant
  - Template placeholder -> II. Integridade da Agenda
  - Template placeholder -> III. Contratos de API Explícitos
  - Template placeholder -> IV. Segurança e Privacidade por Padrão
  - Template placeholder -> V. Qualidade Verificável e Observabilidade
- Added sections:
  - Restrições de Domínio
  - Fluxo de Desenvolvimento e Qualidade
- Removed sections: none
- Follow-up TODOs: none
-->
# Barber Calendar API Constitution

## Core Principles

### I. Isolamento Multi-Tenant
Toda informação pertencente a uma barbearia DEVE carregar uma identificação inequívoca do
tenant e toda operação DEVE aplicar esse escopo no servidor. Usuários só podem consultar ou
alterar dados de tenants para os quais possuam vínculo e autorização válidos. Restrições de
persistência, consultas e testes de integração DEVEM impedir vazamento ou colisão entre tenants;
confiar apenas em filtros enviados pelo cliente é proibido. Esse isolamento protege a autonomia
e a confidencialidade de cada barbearia.

### II. Integridade da Agenda
O sistema DEVE preservar uma única fonte de verdade para disponibilidade, bloqueios e
agendamentos. A criação ou alteração de um compromisso DEVE validar tenant, profissional,
serviço, duração, janela de atendimento e conflitos de horário de forma atômica. Horários não
podem ser reservados duas vezes para o mesmo profissional, inclusive sob concorrência. Datas e
instantes DEVEM ter fuso horário explícito e regras de cancelamento ou reagendamento DEVEM ser
determinísticas e auditáveis. Essas garantias tornam a agenda confiável para profissionais e
clientes.

### III. Contratos de API Explícitos
Cada capacidade pública DEVE possuir contrato HTTP documentado, com esquemas tipados, códigos de
status, autenticação, regras de autorização e respostas de erro consistentes. Alterações
incompatíveis DEVEM usar uma nova versão ou incluir um plano de migração aprovado. A lógica de
negócio DEVE permanecer independente do transporte e da persistência, permitindo que as regras
de agenda sejam testadas sem infraestrutura. Contratos explícitos reduzem ambiguidades entre a
API e seus consumidores.

### IV. Segurança e Privacidade por Padrão
Autenticação e autorização DEVEM ser verificadas no servidor em toda operação protegida, seguindo
o menor privilégio para clientes, profissionais e administradores da barbearia. Credenciais e
segredos nunca podem ser armazenados no código ou registrados em logs. Dados pessoais DEVEM ser
coletados apenas quando necessários, protegidos em trânsito e omitidos de mensagens de erro e
telemetria. Entradas externas DEVEM ser validadas antes de alcançar o domínio. A proteção dos
dados é requisito funcional, não uma etapa posterior.

### V. Qualidade Verificável e Observabilidade
Toda mudança de comportamento DEVE ser acompanhada por testes automatizados proporcionais ao
risco. Regras de domínio exigem testes unitários; persistência, autenticação, isolamento de tenant
e concorrência de agenda exigem testes de integração; contratos críticos exigem testes de API.
Falhas relevantes DEVEM produzir logs estruturados com contexto de correlação e tenant, sem dados
sensíveis. Uma mudança só pode ser considerada concluída quando seus testes, validações estáticas
e critérios de aceite passam de forma reproduzível.

## Restrições de Domínio

- A barbearia é o tenant e constitui a fronteira primária de propriedade e autorização dos dados.
- Profissionais, serviços, jornadas, exceções de disponibilidade e agendamentos DEVEM pertencer a
  exatamente uma barbearia.
- Um horário disponível DEVE ser derivado da interseção entre jornada do profissional, duração do
  serviço, bloqueios, compromissos existentes e políticas da barbearia.
- O cliente só pode agendar serviços e profissionais válidos para a barbearia selecionada.
- Operações que alteram a agenda DEVEM ser idempotentes quando puderem ser repetidas por clientes,
  filas ou falhas de rede.
- Alterações de estado relevantes DEVEM registrar autor, instante, tenant e transição realizada em
  trilha de auditoria apropriada.

## Fluxo de Desenvolvimento e Qualidade

Toda funcionalidade DEVE começar com critérios de aceite e cenários de falha observáveis. O fluxo
de implementação DEVE seguir teste falhando, implementação mínima e refatoração, preservando as
fronteiras entre domínio, aplicação e infraestrutura. Revisões DEVEM confirmar isolamento de
tenant, autorização, integridade transacional, compatibilidade do contrato e cobertura dos casos
concorrentes aplicáveis. Exceções a estes princípios exigem justificativa escrita, avaliação de
risco, responsável e prazo de correção; conveniência ou urgência isoladamente não constituem
justificativa.

## Governance

Esta constituição prevalece sobre práticas, convenções e documentos conflitantes do projeto. Toda
emenda DEVE ser proposta por escrito, explicar motivação e impacto, identificar eventual migração
e receber aprovação dos mantenedores antes da adoção. A versão segue SemVer: MAJOR para remoções
ou redefinições incompatíveis de princípios, MINOR para novos princípios ou expansão material de
governança e PATCH para esclarecimentos sem mudança normativa. A data de última alteração DEVE ser
atualizada em toda emenda aprovada.

Planos, especificações, tarefas e revisões de código DEVEM demonstrar conformidade com os
princípios aplicáveis. Revisores DEVEM bloquear mudanças que violem regras obrigatórias sem uma
exceção formal. A constituição DEVE ser revisada sempre que o modelo de tenancy, autorização ou
agendamento mudar e, no mínimo, antes de cada entrega relevante.

**Version**: 1.0.0 | **Ratified**: 2026-09-28 | **Last Amended**: 2026-09-28
