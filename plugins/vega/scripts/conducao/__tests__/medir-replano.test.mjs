/**
 * medir-replano.test.mjs — a observação do re-plano sozinho e da dívida de ambiente sai medida
 * (VEGA-19 T44, D-VEGA19-53, AC-VEGA19-13). Repo temporário (hooks desligados) e registro de
 * fixture: nenhuma biblioteca da Sistoli, o `ler` das perguntas chega por parâmetro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatar, medir, parsear, principal } from "../medir-replano.mjs";

const CICLO = "TESTE-1-medida";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function repoTemp() {
  const dir = mkdtempSync(path.join(tmpdir(), "medir-replano-"));
  const g = (...a) => execFileSync("git", ["-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "ciclo");
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  const canonico = (tasks) => writeFileSync(path.join(dir, CAMINHO), tasks.map(([id, texto]) => `#### ${id} — x\n\n- **Steps:** ${texto}\n`).join("\n"));
  const commit = (subject, corpo = "") => {
    g("add", "-A");
    g("commit", "-q", "--allow-empty", "-m", corpo ? `${subject}\n\n${corpo}` : subject);
    return g("rev-parse", "HEAD");
  };
  /** Um re-plano (commit do canonico) e a marca que o faz seguir sozinho. */
  const replanoSozinho = (tasks, motivo) => {
    canonico(tasks);
    const sha = commit(`${CICLO}-F1/D-TESTE1-1 — re-plano: ${motivo}`, `Replano-Motivo: ${motivo}`);
    const marca = commit("Conducao: F1 autorizada", `Conducao-Origem: sozinho\nConducao-Replano-Motivo: ${motivo}\nConducao-Replano: ${sha}`);
    return { sha, marca };
  };
  return { dir, g, canonico, commit, replanoSozinho, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

const semPerguntas = async () => ({ perguntas: [] });

test("0 re-planos sozinhos ⇒ sem-amostra", async () => {
  const r = repoTemp();
  try {
    r.canonico([["T1", "faz"]]);
    r.commit("inicio");
    const m = await medir({ repo: r.dir, ciclo: CICLO, ler: semPerguntas });
    assert.equal(m.replanos_sozinhos, 0);
    assert.equal(m.erros, 0);
    assert.equal(m.veredito, "sem-amostra");
  } finally {
    r.limpar();
  }
});

test("controle positivo: 1 sozinho sem erro ⇒ segue", async () => {
  const r = repoTemp();
  try {
    r.canonico([["T1", "faz"]]);
    r.commit("inicio");
    r.replanoSozinho([["T1", "faz"], ["T2", "novo"]], "ci:vermelho-x");
    r.commit(`${CICLO}-F1/T2 — executa a nova`);
    const m = await medir({ repo: r.dir, ciclo: CICLO, ler: semPerguntas });
    assert.equal(m.replanos_sozinhos, 1);
    assert.equal(m.erros, 0);
    assert.equal(m.veredito, "segue");
  } finally {
    r.limpar();
  }
});

test("2 sozinhos e 1 revertido ⇒ volta-ao-operador", async () => {
  const r = repoTemp();
  try {
    r.canonico([["T1", "faz"]]);
    r.commit("inicio");
    r.replanoSozinho([["T1", "faz"], ["T2", "novo"]], "ci:um");
    r.commit(`${CICLO}-F1/T2 — executa`);
    const b = r.replanoSozinho([["T1", "faz"], ["T2", "novo"], ["T3", "outra"]], "revisao:dois");
    r.g("revert", "--no-edit", b.sha);
    const m = await medir({ repo: r.dir, ciclo: CICLO, ler: semPerguntas });
    assert.equal(m.replanos_sozinhos, 2);
    assert.ok(m.erros >= 1);
    assert.ok(m.detalhe_dos_erros.some((e) => e.tipo === "revert"));
    assert.equal(m.veredito, "volta-ao-operador");
  } finally {
    r.limpar();
  }
});

test("re-plano seguinte que remove task nascida num sozinho antes de executar é erro; depois de executar, não", async () => {
  const r = repoTemp();
  try {
    r.canonico([["T1", "faz"]]);
    r.commit("inicio");
    r.replanoSozinho([["T1", "faz"], ["T2", "novo"]], "ci:um");
    r.canonico([["T1", "faz"]]);
    r.commit(`${CICLO}-F1/D-TESTE1-2 — re-plano: tirou a T2`);
    const m = await medir({ repo: r.dir, ciclo: CICLO, ler: semPerguntas });
    assert.ok(m.detalhe_dos_erros.some((e) => e.tipo === "replano-mexeu-em-task-sozinha" && e.task === "T2"));
    assert.equal(m.veredito, "volta-ao-operador");
  } finally {
    r.limpar();
  }
  const s = repoTemp();
  try {
    s.canonico([["T1", "faz"]]);
    s.commit("inicio");
    s.replanoSozinho([["T1", "faz"], ["T2", "novo"]], "ci:um");
    s.commit(`${CICLO}-F1/T2 — executada`);
    s.canonico([["T1", "faz"], ["T2", "reescrita depois de executar"]]);
    s.commit(`${CICLO}-F1/D-TESTE1-2 — re-plano: ajuste`);
    const m = await medir({ repo: s.dir, ciclo: CICLO, ler: semPerguntas });
    assert.equal(m.erros, 0);
    assert.equal(m.veredito, "segue");
  } finally {
    s.limpar();
  }
});

test("pergunta replano:<sha8> de um sozinho, respondida por pessoa contra ele ⇒ erro; 'manter' não conta", async () => {
  const r = repoTemp();
  try {
    r.canonico([["T1", "faz"]]);
    r.commit("inicio");
    const a = r.replanoSozinho([["T1", "faz"], ["T2", "novo"]], "ci:um");
    const base = { ciclo: CICLO, ponteiro: `replano:${a.sha.slice(0, 8)}`, estado: "respondida", origem: "pessoa" };
    const itens = [{ numero: 1, opcoes: [{ letra: "a", texto: "manter o re-plano" }, { letra: "b", texto: "desfazer o re-plano" }] }];
    const contra = async () => ({ perguntas: [{ ...base, pergunta_id: "p-1", itens, escolhas: [{ numero: 1, letra: "b" }] }] });
    const manter = async () => ({ perguntas: [{ ...base, pergunta_id: "p-2", itens, escolhas: [{ numero: 1, letra: "a" }] }] });
    const c = await medir({ repo: r.dir, ciclo: CICLO, ler: contra });
    assert.equal(c.erros, 1);
    assert.equal(c.veredito, "volta-ao-operador");
    const m = await medir({ repo: r.dir, ciclo: CICLO, ler: manter });
    assert.equal(m.erros, 0);
    assert.equal(m.veredito, "segue");
  } finally {
    r.limpar();
  }
});

test("pergunta replano-repetido (ponteiro de re-plano que não seguiu sozinho) conta em repetidos", async () => {
  const r = repoTemp();
  try {
    r.canonico([["T1", "faz"]]);
    r.commit("inicio");
    r.replanoSozinho([["T1", "faz"], ["T2", "novo"]], "ci:um");
    const ler = async () => ({ perguntas: [{ pergunta_id: "p-3", ciclo: CICLO, ponteiro: "replano:deadbeef", estado: "aberta" }] });
    const m = await medir({ repo: r.dir, ciclo: CICLO, ler });
    assert.equal(m.repetidos, 1);
    assert.equal(m.erros, 0);
  } finally {
    r.limpar();
  }
});

test("--divida: autoria de elder em societario (em_nome_de socio) ⇒ divida_de_ambiente 1, por mandato", async () => {
  const r = repoTemp();
  try {
    r.canonico([["T1", "faz"]]);
    r.commit("inicio");
    const ler = async () => ({
      perguntas: [
        { pergunta_id: "p-4", ciclo: CICLO, estado: "respondida", origem: "pessoa", quem: "elder", mandato: "societario", em_nome_de: "socio" },
        { pergunta_id: "p-5", ciclo: CICLO, estado: "respondida", origem: "pessoa", quem: "leo", mandato: "engenharia", em_nome_de: null },
      ],
    });
    const m = await medir({ repo: r.dir, ciclo: CICLO, divida: true, ler });
    assert.equal(m.divida_de_ambiente, 1);
    assert.deepEqual(m.divida_por_mandato, { societario: 1 });
    assert.match(formatar(m), /^divida_de_ambiente: 1$/m);
    const sem = await medir({ repo: r.dir, ciclo: CICLO, divida: true, ler: null });
    assert.equal(sem.divida_de_ambiente, "sem-leitura");
    const falha = await medir({ repo: r.dir, ciclo: CICLO, divida: true, ler: async () => { throw new Error("registro fora"); } });
    assert.equal(falha.divida_de_ambiente, "sem-leitura");
    // Registro fora: o `ler` real não lança, devolve a fila local com `sem_registro` — é sem leitura.
    const fora = await medir({ repo: r.dir, ciclo: CICLO, divida: true, ler: async () => ({ perguntas: [], sem_registro: true }) });
    assert.equal(fora.divida_de_ambiente, "sem-leitura");
    assert.match(fora.perguntas, /^sem-leitura \(registro fora do ar/);
  } finally {
    r.limpar();
  }
});

test("CLI: argumento sem --ciclo recusa (exit 2) e a saída tem as linhas medidas", async () => {
  assert.ok(parsear([]).erro);
  assert.ok(parsear(["--ciclo", "X", "--solto"]).erro);
  const r = repoTemp();
  try {
    r.canonico([["T1", "faz"]]);
    r.commit("inicio");
    let saida = "";
    const stdout = { write: (t) => (saida += t) };
    const codigo = await principal(["--ciclo", CICLO, "--repo", r.dir, "--divida"], { stdout, stderr: { write() {} }, ler: semPerguntas });
    assert.equal(codigo, 0);
    for (const re of [/^replanos_sozinhos: 0$/m, /^erros: 0$/m, /^repetidos: 0$/m, /^divida_de_ambiente: 0$/m, /^veredito: sem-amostra$/m]) assert.match(saida, re);
    assert.equal(await principal([], { stdout, stderr: { write() {} } }), 2);
  } finally {
    r.limpar();
  }
});
