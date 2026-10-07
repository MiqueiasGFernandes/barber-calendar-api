---
description: "Template de tarefas para implementação da funcionalidade"
---

# Tarefas: [NOME DA FUNCIONALIDADE]

**Entrada**: Documentos em `/specs/[###-nome-da-funcionalidade]/`

**Pré-requisitos**: `plan.md` e `spec.md`; quando existirem, `research.md`, `data-model.md` e `contracts/`

**Testes**: Inclua tarefas de teste quando exigidas pela especificação e sempre que necessárias pelos portões de qualidade.

**Organização**: Agrupe tarefas por história para permitir implementação e teste independentes.

## Formato: `[ID] [P?] [História] Descrição`

- **[P]**: Pode executar em paralelo, em arquivos diferentes e sem dependências.
- **[História]**: História à qual a tarefa pertence, por exemplo US1.
- Inclua caminhos exatos de arquivos.

## Fase 1: Preparação

**Objetivo**: Inicialização e estrutura básica.

- [ ] T001 Criar a estrutura do projeto conforme o plano
- [ ] T002 Inicializar linguagem e dependências
- [ ] T003 [P] Configurar lint e formatação

---

## Fase 2: Fundação

**Objetivo**: Infraestrutura obrigatória antes das histórias.

**CRÍTICO**: Nenhuma história começa antes desta fase terminar.

- [ ] T004 Configurar schema e migrações
- [ ] T005 [P] Implementar autenticação e autorização básicas
- [ ] T006 [P] Configurar roteamento e middleware
- [ ] T007 Criar entidades fundamentais
- [ ] T008 Configurar tratamento de erros e logs
- [ ] T009 Configurar ambiente

**Ponto de verificação**: Fundação pronta; histórias podem avançar em paralelo.

---

## Fase 3: História de Usuário 1 - [Título] (Prioridade: P1) 🎯 MVP

**Objetivo**: [Valor entregue]

**Teste independente**: [Como validar]

### Testes da História 1

> Escreva estes testes primeiro e confirme que falham antes da implementação.

- [ ] T010 [P] [US1] Teste de contrato em tests/contract/
- [ ] T011 [P] [US1] Teste de integração em tests/integration/

### Implementação da História 1

- [ ] T012 [P] [US1] Criar modelo em src/models/
- [ ] T013 [US1] Implementar serviço em src/services/
- [ ] T014 [US1] Implementar endpoint em src/
- [ ] T015 [US1] Adicionar validação, erros e logs

**Ponto de verificação**: História 1 funcional e testável isoladamente.

---

## Fase 4: História de Usuário 2 - [Título] (Prioridade: P2)

**Objetivo**: [Valor entregue]

**Teste independente**: [Como validar]

- [ ] T016 [P] [US2] Criar testes
- [ ] T017 [P] [US2] Criar modelos necessários
- [ ] T018 [US2] Implementar serviço e endpoint
- [ ] T019 [US2] Integrar com componentes existentes quando necessário

**Ponto de verificação**: Histórias 1 e 2 funcionam independentemente.

---

## Fase 5: História de Usuário 3 - [Título] (Prioridade: P3)

**Objetivo**: [Valor entregue]

**Teste independente**: [Como validar]

- [ ] T020 [P] [US3] Criar testes
- [ ] T021 [P] [US3] Criar modelos necessários
- [ ] T022 [US3] Implementar serviço e endpoint

**Ponto de verificação**: Todas as histórias funcionam isoladamente.

---

## Fase Final: Refinamento e Aspectos Transversais

- [ ] TXXX [P] Atualizar documentação em docs/
- [ ] TXXX Refatorar e remover duplicação
- [ ] TXXX Otimizar desempenho
- [ ] TXXX [P] Ampliar testes unitários e de segurança
- [ ] TXXX Executar a validação de quickstart.md

## Dependências e Ordem

- Preparação não possui dependências.
- Fundação depende da Preparação e bloqueia todas as histórias.
- Após a Fundação, as histórias podem avançar por prioridade ou em paralelo.
- Refinamento depende das histórias desejadas.

### Dentro de cada história

- Testes devem ser escritos e falhar antes da implementação.
- Modelos precedem serviços; serviços precedem endpoints.
- A história deve estar concluída antes de avançar por ordem sequencial.

## Estratégia de Implementação

### MVP primeiro

1. Concluir Preparação e Fundação.
2. Concluir a História 1.
3. Parar e validar a História 1 isoladamente.
4. Publicar ou demonstrar o MVP quando estiver pronto.

### Entrega incremental

Adicione uma história por vez, teste-a isoladamente e mantenha cada incremento utilizável.

## Observações

- `[P]` significa arquivos diferentes e ausência de dependências.
- Toda tarefa deve ser específica o suficiente para execução sem contexto adicional.
- Evite tarefas vagas, conflitos de arquivo e dependências entre histórias que impeçam testes independentes.
