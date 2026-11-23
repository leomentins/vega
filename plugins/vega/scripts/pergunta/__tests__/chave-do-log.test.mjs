// chave-do-log.test.mjs — hotfix vega-chave-do-log-da-conducao (23/11/2026). Peça do corpo da
// fábrica: o teste não importa biblioteca de projeto; as peças são os dublês de `dubles.mjs`.
//
// O `abrir` completa a chave escondida pelo log da condução: a filha em HEAD solto casa pela sessão
// da árvore (`bridge-cse_<X>` ↔ `sessao:session_<X>`), a condutora com uma task aberta a recebe, com
// duas a posição sai `-`, e log ausente ou ilegível cai no que a #801 já fazia.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import { abrir, completarChave, registroGit } from "../comando.mjs";
import { chaveDoLog, chaveDoTexto, sessaoDaArvore } from "../chave-do-log.mjs";
import { tabelaPadrao } from "../destinatarios.mjs";
import { pecasDuble } from "./dubles.mjs";

const C = "L4-exames-e-laudos-por-familia";
const FILHA_T4 = "session_01AAAAAAAAAAAAAAAAAAAAT4";
const FILHA_T7 = "session_01AAAAAAAAAAAAAAAAAAAAT7";
const CONDUTORA = "session_01AAAAAAAAAAAAAAAAACOND";
const T0 = "2026-11-23T10:00:00.000Z";

const pastas = [];
const pastaTemp = () => {
  const p = mkdtempSync(path.join(tmpdir(), "chave-do-log-"));
  pastas.push(p);
  return p;
};
afterEach(() => {
  while (pastas.length) rmSync(pastas.pop(), { recursive: true, force: true });
});

let n = 0;
const ev = (procedencia, acao, { fase, tasks = [], sessao } = {}) => {
  const objetos = [{ id: `ciclo:${C}`, tipo: "ciclo", qualificador: "conduzido" }];
  if (fase) objetos.push({ id: `fase:${C}/${fase}`, tipo: "fase", qualificador: "da-fase" });
  for (const t of tasks) {
    objetos.push({ id: `task:${C}/${t}`, tipo: "task", qualificador: "alvo" });
    objetos.push({ id: `tentativa:${C}/${t}/1`, tipo: "tentativa", qualificador: "tentativa" });
  }
  if (sessao) objetos.push({ id: `sessao:${sessao}`, tipo: "sessao", qualificador: "filha" });
  const quando = new Date(Date.parse(T0) + 1000 * n++).toISOString();
  return JSON.stringify({ v: 1, linha: "evento", procedencia, acao, objetos, atributos: {}, chave: `k${n}`, quando });
};

// A forma medida no log do L4 em 23/11: a condutora da F1 nasce, a leva paralela abre T4 e T7 numa
// intenção só, cada filha é observada pela sua sessão.
const PARALELO = () => [
  ev("intencao", "criar-condutora", { fase: "F1", sessao: CONDUTORA }),
  ev("registrado", "autorizacao-herdada", { fase: "F1" }),
  ev("intencao", "abrir", { fase: "F1", tasks: ["T4", "T7"] }),
  ev("registrado", "aberta", { tasks: ["T7"] }),
  ev("observado", "abrir", { tasks: ["T7"], sessao: FILHA_T7 }),
  ev("registrado", "aberta", { tasks: ["T4"] }),
  ev("observado", "abrir", { tasks: ["T4"], sessao: FILHA_T4 }),
  ev("observado", "vida", { fase: "F1" }),
];

const logEm = (linhas, ciclo = C) => {
  const pasta = pastaTemp();
  writeFileSync(path.join(pasta, `${ciclo}.jsonl`), `${linhas.join("\n")}\n`);
  return pasta;
};

const ITEM = (numero) => ({ titulo: `decisao ${numero}`, contexto: "contexto curto", opcoes: [{ texto: "manter o fluxo" }, { texto: "trocar o fluxo" }], recomendada: "a", motivo: "motivo curto" });
const entradaDe = (numero, extra = {}) => ({ sessao: "zz-test-chave-do-log", pergunta: { numero, assunto: "assunto", papel: "operador", has_patient_data: false, itens: [ITEM(numero)] }, ...extra });
const chaveNoTexto = (texto) => /<!-- decisao D\d+ = (\S+) · origem (\S+) -->/.exec(texto)?.[1];

async function abrirCom(entrada, opcoes = {}) {
  const registro = registroGit({ arquivo: "decisoes/decisoes.jsonl", pecas: pecasDuble().pecas });
  return abrir(entrada, { registro, destinatarios: tabelaPadrao(), carimbo: T0, ...opcoes });
}

describe("a chave pelo log da condução", () => {
  test("a árvore da ponte dá a sessão da nuvem; fora dela, null", () => {
    assert.equal(sessaoDaArvore(`/h/sistoli/.claude/worktrees/bridge-cse_01AAAAAAAAAAAAAAAAAAAAT4/apps/x`), FILHA_T4);
    assert.equal(sessaoDaArvore(`/h/sistoli/.claude/worktrees/bridge-cse_01AAAAAAAAAAAAAAAAAAAAT4`), FILHA_T4);
    for (const c of ["/h/sistoli", "/h/scratch/hotfix-x", null]) assert.equal(sessaoDaArvore(c), null, String(c));
  });

  test("filha em HEAD solto: o ciclo, a fase e a task saem do casamento pela sessão", async () => {
    const pasta = logEm(PARALELO());
    writeFileSync(path.join(pasta, "OUTRO-1-x.jsonl"), `${ev("observado", "vida", { fase: "F9" })}\n`);
    assert.deepEqual(chaveDoLog({ pasta, sessao: FILHA_T7 }), { ciclo: C, fase: "F1", task: "T7" });
    const r = await abrirCom(entradaDe(5), { ramo: null, conducao: { pasta, sessao: FILHA_T4 } });
    assert.equal(chaveNoTexto(r.texto), `${C}/F1/T4/5`);
  });

  test("condutora com uma task aberta: a task é a dela", async () => {
    const linhas = [...PARALELO(), ev("registrado", "conferida", { tasks: ["T7"] })];
    const pasta = logEm(linhas);
    assert.deepEqual(chaveDoLog({ pasta, ciclo: C, sessao: CONDUTORA }), { fase: "F1", task: "T4" });
    const r = await abrirCom(entradaDe(6), { ramo: `ciclo-${C}`, conducao: { pasta, sessao: CONDUTORA } });
    assert.equal(chaveNoTexto(r.texto), `${C}/F1/T4/6`);
  });

  test("condutora com duas tasks abertas: a posição da task sai `-`", async () => {
    const pasta = logEm(PARALELO());
    assert.deepEqual(chaveDoLog({ pasta, ciclo: C, sessao: CONDUTORA }), { fase: "F1" });
    const r = await abrirCom(entradaDe(7), { ramo: `ciclo-${C}`, conducao: { pasta, sessao: CONDUTORA } });
    assert.equal(chaveNoTexto(r.texto), `${C}/F1/-/7`);
  });

  test("a task da sessão já fechada não fica; ciclo conhecido não varre outro log", () => {
    const pasta = logEm([
      ...PARALELO(),
      ev("registrado", "conferida", { tasks: ["T7"] }),
      ev("intencao", "arquivar", { tasks: ["T7"], sessao: FILHA_T7 }),
    ]);
    // A filha da T7 pergunta depois do fim dela: a T7 não volta, nem herda a T4 de outra filha.
    assert.deepEqual(chaveDoLog({ pasta, sessao: FILHA_T7 }), { ciclo: C, fase: "F1" });
    // A condutora que fez uma task e a fechou segue recebendo a única aberta.
    const feita = logEm([
      ...PARALELO(),
      ev("intencao", "fazer-condutora", { fase: "F1", tasks: ["T9"], sessao: CONDUTORA }),
      ev("registrado", "conferida", { tasks: ["T9"] }),
      ev("registrado", "conferida", { tasks: ["T7"] }),
    ]);
    assert.deepEqual(chaveDoLog({ pasta: feita, ciclo: C, sessao: CONDUTORA }), { fase: "F1", task: "T4" });
    writeFileSync(path.join(pasta, "OUTRO-1-x.jsonl"), `${ev("observado", "vida", { fase: "F9", sessao: "session_01AAAAAAAAAAAAAAAAAAAOUTR" })}\n`);
    assert.deepEqual(chaveDoLog({ pasta, ciclo: C, sessao: "session_01AAAAAAAAAAAAAAAAAAAOUTR" }), { fase: "F1", task: "T4" });
  });

  test("a chave dada vence o log, e o log vence o ramo", () => {
    const log = { ciclo: C, fase: "F1", task: "T4" };
    assert.deepEqual(completarChave({ task: "T9" }, { log }), { ciclo: C, fase: "F1", task: "T9" });
    assert.deepEqual(completarChave(null, { ramo: "hotfix/y-20261123", log }), { ciclo: C, fase: "F1", task: "T4", origem: "hotfix" });
    // A chave dada diz outro ciclo: fase e task do log (de outro ciclo) não entram.
    assert.deepEqual(completarChave({ ciclo: "Z9-dado" }, { log }), { ciclo: "Z9-dado" });
  });

  test("sem log: cai no que a #801 já fazia", async () => {
    const pasta = pastaTemp();
    assert.deepEqual(chaveDoLog({ pasta, sessao: FILHA_T4 }), {});
    assert.deepEqual(chaveDoLog({ pasta: path.join(pasta, "nao-existe"), ciclo: C, sessao: FILHA_T4 }), {});
    const solta = await abrirCom(entradaDe(8), { ramo: null, conducao: { pasta, sessao: FILHA_T4 } });
    assert.equal(chaveNoTexto(solta.texto), "-/-/-/8");
    const noRamo = await abrirCom(entradaDe(9), { ramo: `ciclo-${C}`, conducao: { pasta: null, sessao: null } });
    assert.equal(chaveNoTexto(noRamo.texto), `${C}/-/-/9`);
  });

  test("log ilegível: linha torta é pulada, arquivo que não se lê não quebra o abrir", async () => {
    assert.deepEqual(chaveDoTexto(`{torto\n${PARALELO().join("\n")}\n\u0000\n`, C, FILHA_T4), { casou: true, fase: "F1", task: "T4" });
    const pasta = logEm(["isto não é json", "{\"linha\":\"evento\""]);
    assert.deepEqual(chaveDoLog({ pasta, ciclo: C, sessao: FILHA_T4 }), {});
    const explode = () => {
      throw new Error("EACCES");
    };
    assert.deepEqual(chaveDoLog({ pasta, ciclo: C, sessao: FILHA_T4, ler: explode, listar: explode }), {});
    const r = await abrirCom(entradaDe(10), { ramo: `ciclo-${C}`, conducao: { pasta, sessao: FILHA_T4 } });
    assert.equal(chaveNoTexto(r.texto), `${C}/-/-/10`);
  });
});
