# Passagem: plano de implementação

> **Para agentes:** use superpowers:subagent-driven-development ou superpowers:executing-plans para executar este plano tarefa por tarefa.

**Objetivo:** o projeto ganha uma despedida na primeira fase e um aceno na segunda, com uma troca de condutora entre elas.

**Largura do ciclo:** 1

## Restrições globais

- Sem dependência npm.

## Fase F1 — a despedida

**Modelo:** sonnet

### Tarefa 1: a despedida

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Verificação:** `grep -q 'export function despedida' src/despedida.mjs`
**Commit:** EXEMPLO-2-passagem-F1/T1 — despedida

**Arquivos:**
- Criar: `src/despedida.mjs`

- [ ] **Passo 1: escrever `despedida(nome)` em `src/despedida.mjs`**
- [ ] **Passo 2: commit**

### Tarefa 2: fechamento da F1

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Marcas:** fechamento-de-fase
**Verificação:** `grep -q 'despedida' README.md`
**Commit:** EXEMPLO-2-passagem-F1/T2 — fechamento de F1

**Arquivos:**
- Modificar: `README.md`

- [ ] **Passo 1: citar a despedida no README**
- [ ] **Passo 2: commit**

## Fase F2 — o aceno

**Modelo:** sonnet

### Tarefa 3: o aceno

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Verificação:** `grep -q 'export function aceno' src/aceno.mjs`
**Commit:** EXEMPLO-2-passagem-F2/T3 — aceno

**Arquivos:**
- Criar: `src/aceno.mjs`

- [ ] **Passo 1: escrever `aceno(nome)` em `src/aceno.mjs`**
- [ ] **Passo 2: commit**

### Tarefa 4: fechamento da F2

**Estação:** servidor
**Publicação:** não
**Sensível:** não
**Marcas:** fechamento-de-fase
**Verificação:** `grep -q 'aceno' README.md`
**Commit:** EXEMPLO-2-passagem-F2/T4 — fechamento de F2

**Arquivos:**
- Modificar: `README.md`

- [ ] **Passo 1: citar o aceno no README**
- [ ] **Passo 2: commit**
