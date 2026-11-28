# Pergunta aberta não trava as outras

A pergunta que espera o operador numa task para só aquela task. As outras seguem.

## Quais perguntas

`conferencia-do-operador`, `pergunta-da-filha` e `task-sensivel`. As outras perguntas (a vigia, o plano, a publicação) seguem como no SKILL §3.

## O campo da entrada

Ao levar ao operador uma dessas perguntas, a condutora acrescenta um item em `perguntasAbertas` na entrada do `proximo`:

```json
{ "task": "T45", "tentativa": 2, "motivo": "conferencia-do-operador", "abertaEm": "<ISO de quando o bloco saiu>" }
```

- `task`, `tentativa` e `motivo` são os da ação. A `task-sensivel` da estação condutora sai com tentativa 0, e 0 vale. Na `task-sensivel`, um item basta, e um item por task listada também vale.
- Quando o operador responde, o item ganha `respondidaEm` (ISO da resposta) e fica na lista até a tentativa fechar: o tempo entre `abertaEm` e `respondidaEm` não conta no prazo da tentativa.
- A lista é da condutora, nunca derivada da saída. Campo ausente, motivo fora da lista ou instante ilegível dão `perguntar entrada-invalida`.

## O que o `proximo` faz

- A task da pergunta para: nada dela é trazido, conferido, vigiado nem aberto. Quem depende dela também não abre. A vaga e os Outputs dela seguem ocupados, inclusive os da trazida que espera a conferência, porque um não do operador tira o trabalho dela.
- As outras seguem na ordem de sempre: trazer, conferir, abrir. A ação sai com `perguntasAbertas`, as perguntas que seguraram a task.
- Sem mais nada a fazer, volta a mesma pergunta: mesma `task`, `tentativa` e `motivo`. O nonce segue o HEAD e pode ter mudado. **Não perguntar de novo ao operador:** esperar o turno dele.
- `perguntasSemEco` na saída: item aberto que o `proximo` não pergunta mais, porque já foi respondido sem `respondidaEm` ou porque foi superado. Ele não congela nem pausa nada. Consertar a lista: gravar `respondidaEm` ou tirar o item.

## O que não muda

- A resposta vale só no turno do operador e entra pelo verbo que o motivo pede (SKILL §3, `perguntar`).
- **Conferência do operador:** a parte da máquina fecha antes de levar a pergunta (`trazer`, `conferir` e a Verificação). Se o HEAD andou até a resposta, a Verificação roda de novo antes do `registrar-conferencia`. Assim a espera fica entre conferências, e trazer outra task nesse tempo não é o commit concorrente do SKILL §5.
- A ordem é do `proximo`: nenhuma task é pulada nem reordenada à mão.
