#!/usr/bin/env node
// sombra.test.mjs — VEGA-19 T21 (AC-VEGA19-6; D-VEGA19-11, D-VEGA19-12, D-VEGA19-65, D-VEGA19-67).
//
// A sombra do Sistema 1 contra um servidor falso (node:http em loopback, porta efêmera): previsão
// com as variantes da mesma letra somadas e o template sem raciocínio; resposta em 6 s ⇒ `sem
// previsão` motivo `lento` (teto de 5 s); servidor fora ⇒ `fora`; fora da GPU ⇒ nenhuma chamada e
// `fora-da-gpu`; marca de paciente ⇒ nenhuma chamada; reabertura de pergunta que já tem `previsao`
// ⇒ nenhuma segunda chamada; o texto do bloco não contém a previsão; gravação que falha vai a
// stderr e ao contador; e o processo que sai logo depois de `abrir` deixa a linha gravada.
// Peças e registro dublês (`dubles.mjs`): o corpo da fábrica, sem biblioteca de projeto.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { abrir } from "../comando.mjs";
import { carregar as carregarDestinatarios } from "../destinatarios.mjs";
import { chaveDaApi, letraDoToken, prever, sombrear, TETO_MS, vetorDoItem } from "../sombra.mjs";
import { pecasDuble, registroBancoDuble } from "./dubles.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const destinatarios = carregarDestinatarios();
const pastas = [];
const pastaTemp = () => {
  const p = pastaTemporaria("zz-test-sombra-");
  pastas.push(p);
  return p;
};
after(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});
const silencio = { write: () => true };

/** O topo da T20: a letra `c` dividida entre caixa e forma, mais `b`. */
const TOPO_DA_T20 = [
  { id: 1, token: "C", logprob: -0.91 },
  { id: 2, token: "c", logprob: -1.05 },
  { id: 3, token: "(c", logprob: -1.89 },
  { id: 4, token: "b", logprob: -3.0 },
  { id: 5, token: "Thinking", logprob: -6.0 },
];

/** Servidor falso: `/apply-template` e `/completion`, com atraso e status configuráveis. */
async function servidorFalso({ atrasoMs = 0, status = 200, topo = TOPO_DA_T20, timings = { prompt_n: 300, prompt_ms: 2300 } } = {}) {
  const pedidos = [];
  const timers = new Set();
  const conta = { respondidos: 0 };
  const srv = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      pedidos.push({ url: req.url, corpo: corpo ? JSON.parse(corpo) : null, auth: req.headers.authorization ?? null });
      const responder = () => {
        if (res.destroyed) return;
        conta.respondidos++;
        if (status !== 200) {
          res.writeHead(status, { "content-type": "application/json" });
          return res.end("{}");
        }
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/apply-template") return res.end(JSON.stringify({ prompt: "<|im_start|>user\nPergunta…<|im_end|>\n<think>\n\n</think>\n\n" }));
        res.end(JSON.stringify({ content: "c", completion_probabilities: [{ id: 1, token: "c", logprob: -1.05, top_logprobs: topo }], timings }));
      };
      if (atrasoMs > 0) {
        const t = setTimeout(() => {
          timers.delete(t);
          responder();
        }, atrasoMs);
        timers.add(t);
      } else responder();
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const endereco = `http://127.0.0.1:${srv.address().port}`;
  return {
    pedidos,
    conta,
    endereco,
    config: { endereco, modelo: "modelo-falso.gguf", versao: "rev0-t1" },
    fechar: () =>
      new Promise((r) => {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        srv.closeAllConnections();
        srv.close(r);
      }),
  };
}

/** A entrada de `abrir`: um item com três opções; `paciente` liga a marca. */
function entrada({ sessao = "zz-test-sombra", numero = 7, paciente = false } = {}) {
  return {
    sessao,
    ciclo: "VEGA-19-pergunta-tipada",
    pergunta: {
      numero,
      assunto: "teto da sombra",
      papel: "operador",
      has_patient_data: paciente,
      ...(paciente ? { ponteiro: "sensivel/caso-21" } : {}),
      itens: [
        {
          titulo: "qual teto de espera da previsao",
          contexto: "a medida da maquina deu 2,4 s no p95 com 350 tokens",
          opcoes: [{ texto: "2 s" }, { texto: "manter o prompt curto" }, { texto: "5 s, esperando" }],
          recomendada: "c",
          motivo: "cabe o bloco real",
        },
      ],
    },
  };
}

const novoRegistro = () => registroBancoDuble(pecasDuble().pecas);
const gpuSim = async () => true;

/** A sombra com o servidor falso: sem chave, GPU injetada, contador numa pasta temporária. */
function sombraCom(f, { naGpu = gpuSim, stderr = silencio, contador = path.join(pastaTemp(), "falhas.log"), chamadas = [] } = {}) {
  return async (alvo, opcoes) => {
    const r = await sombrear(alvo, { ...opcoes, config: f.config, chave: null, naGpu, stderr, contador, env: {} });
    chamadas.push(r);
    return r;
  };
}

const previsoesDe = (b) => b.linhas.filter((l) => l.evento === "previsao");

describe("a previsão em sombra (AC-VEGA19-6)", () => {
  test("letras de caixa e forma somadas, normalizadas, opção fora do topo marcada ausente", () => {
    assert.equal(letraDoToken("C"), "c");
    assert.equal(letraDoToken("(c"), "c");
    assert.equal(letraDoToken(" c)"), "c");
    assert.equal(letraDoToken("Thinking"), null);
    const item = { numero: 7, opcoes: [{ letra: "a" }, { letra: "b" }, { letra: "c" }] };
    const v = vetorDoItem(TOPO_DA_T20, item);
    assert.equal(v.length, 3);
    assert.deepEqual(v[0], { numero: 7, letra: "a", ausente: true });
    const c = Math.exp(-0.91) + Math.exp(-1.05) + Math.exp(-1.89);
    const b = Math.exp(-3.0);
    assert.equal(v[2].p, Math.round((c / (b + c)) * 10_000) / 10_000);
    assert.ok(v[2].p > 0.9 && v[1].p < 0.1);
  });

  test("abrir grava a abertura e depois a previsão; o bloco não contém a previsão", async () => {
    const f = await servidorFalso();
    try {
      const b = novoRegistro();
      const r = await abrir(entrada(), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra: sombraCom(f) });
      assert.deepEqual(b.chamadas.map((c) => c[0]), ["abrir", "prever"], "a abertura antes da previsão");
      const [pv] = previsoesDe(b);
      assert.ok(pv, "linha previsao gravada");
      assert.equal(pv.pergunta_id, r.pergunta_id);
      assert.equal(pv.motivo, null);
      assert.equal(pv.onde, "gpu");
      assert.equal(pv.carga_fria, false);
      assert.ok(Number.isInteger(pv.latencia_ms));
      assert.equal(pv.modelo, "modelo-falso.gguf");
      assert.equal(pv.vetor.length, 3);
      assert.equal(pv.has_patient_data, false);
      // O pedido: template sem raciocínio, saída restrita às letras, primeiro token com o topo.
      const [tpl, comp] = f.pedidos;
      assert.equal(tpl.url, "/apply-template");
      assert.deepEqual(tpl.corpo.chat_template_kwargs, { enable_thinking: false });
      assert.match(tpl.corpo.messages.at(-1).content, /qual teto de espera da previsao/);
      assert.equal(comp.url, "/completion");
      assert.equal(comp.corpo.grammar, "root ::= [abc]");
      assert.equal(comp.corpo.n_predict, 1);
      assert.ok(comp.corpo.n_probs > 0);
      // O texto que o operador vê é o mesmo com e sem a sombra.
      const semSombra = await abrir(entrada({ sessao: "zz-test-sombra-b" }), { registro: novoRegistro().registro, destinatarios, carimbo: "2026-11-18T21:00:00Z" });
      assert.equal(r.texto.replaceAll(r.pergunta_id, "ID"), semSombra.texto.replaceAll(semSombra.pergunta_id, "ID"));
      for (const x of pv.vetor.filter((e) => e.p !== undefined)) assert.ok(!r.texto.includes(String(x.p)), "probabilidade fora do bloco");
    } finally {
      await f.fechar();
    }
  });

  test("resposta em 6 s ⇒ sem previsão com motivo lento (teto de 5 s)", async () => {
    assert.equal(TETO_MS, 5_000);
    const f = await servidorFalso({ atrasoMs: 6_000 });
    try {
      const b = novoRegistro();
      const t0 = Date.now();
      await abrir(entrada(), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra: sombraCom(f) });
      const gasto = Date.now() - t0;
      // O aborto cortou no teto: abrir voltou antes dos 6 s, e o servidor nunca respondeu.
      assert.ok(gasto < 6_000, `abrir esperou ${gasto} ms`);
      const [pv] = previsoesDe(b);
      assert.equal(pv.motivo, "lento");
      assert.deepEqual(pv.vetor, []);
      assert.ok(pv.latencia_ms >= 4_900 && pv.latencia_ms < 6_000, `latencia ${pv.latencia_ms}`);
      assert.equal(pv.onde, "gpu");
      assert.ok(f.pedidos.length > 0, "o servidor foi chamado");
      assert.equal(f.conta.respondidos, 0, "nenhuma resposta antes do corte");
    } finally {
      await f.fechar();
    }
  });

  test("servidor fora ⇒ sem previsão com motivo fora", async () => {
    const f = await servidorFalso();
    await f.fechar();
    const b = novoRegistro();
    await abrir(entrada(), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra: sombraCom(f) });
    const [pv] = previsoesDe(b);
    assert.equal(pv.motivo, "fora");
    assert.deepEqual(pv.vetor, []);
  });

  test("servidor carregando (503) ⇒ fora; recusa da chave (401) ⇒ erro", async () => {
    for (const [status, motivo] of [
      [503, "fora"],
      [401, "erro"],
    ]) {
      const f = await servidorFalso({ status });
      try {
        const r = await prever({ titulo: "t", itens: [{ numero: 1, opcoes: [{ letra: "a", texto: "x" }, { letra: "b", texto: "y" }] }] }, { endereco: f.endereco, naGpu: gpuSim });
        assert.equal(r.motivo, motivo, `status ${status}`);
        assert.deepEqual(r.vetor, []);
      } finally {
        await f.fechar();
      }
    }
  });

  test("GPU que não deu para medir ⇒ erro, sem afirmar onde rodou e sem chamar", async () => {
    const f = await servidorFalso();
    try {
      const r = await prever({ titulo: "t", itens: [{ numero: 1, opcoes: [{ letra: "a", texto: "x" }, { letra: "b", texto: "y" }] }] }, { endereco: f.endereco, naGpu: async () => null });
      assert.equal(r.motivo, "erro");
      assert.equal(r.onde, null);
      assert.equal(f.pedidos.length, 0);
    } finally {
      await f.fechar();
    }
  });

  test("letra repetida entra uma vez na gramática e no vetor", async () => {
    const f = await servidorFalso();
    try {
      const r = await prever(
        { titulo: "t", itens: [{ numero: 1, opcoes: [{ letra: "a", texto: "x" }, { letra: "a", texto: "x de novo" }, { letra: "c", texto: "z" }] }] },
        { endereco: f.endereco, naGpu: gpuSim },
      );
      assert.equal(r.motivo, null);
      assert.deepEqual(r.vetor.map((e) => e.letra), ["a", "c"]);
      assert.equal(f.pedidos.find((p) => p.url === "/completion").corpo.grammar, "root ::= [ac]");
    } finally {
      await f.fechar();
    }
  });

  test("a chave vem do ambiente ou do arquivo do operador, inclusive com export", () => {
    const pasta = pastaTemp();
    const arquivo = path.join(pasta, "api.env");
    assert.equal(chaveDaApi({ VEGA_SISTEMA1_API_KEY: "k-amb", VEGA_SISTEMA1_CHAVE_ARQUIVO: arquivo }), "k-amb");
    assert.equal(chaveDaApi({ VEGA_SISTEMA1_CHAVE_ARQUIVO: arquivo }), null);
    writeFileSync(arquivo, "export LLAMA_API_KEY=k-arq\n");
    assert.equal(chaveDaApi({ VEGA_SISTEMA1_CHAVE_ARQUIVO: arquivo }), "k-arq");
    writeFileSync(arquivo, 'LLAMA_API_KEY="k-aspas"\n');
    assert.equal(chaveDaApi({ VEGA_SISTEMA1_CHAVE_ARQUIVO: arquivo }), "k-aspas");
  });

  test("fora da GPU ⇒ nenhuma chamada e motivo fora-da-gpu", async () => {
    const f = await servidorFalso();
    try {
      const b = novoRegistro();
      await abrir(entrada(), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra: sombraCom(f, { naGpu: async () => false }) });
      assert.equal(f.pedidos.length, 0);
      const [pv] = previsoesDe(b);
      assert.equal(pv.motivo, "fora-da-gpu");
      assert.equal(pv.onde, "cpu");
    } finally {
      await f.fechar();
    }
  });

  test("carga fria: a avaliação do prompt bem acima da taxa quente marca carga_fria", async () => {
    const f = await servidorFalso({ timings: { prompt_n: 23, prompt_ms: 21_700 } });
    try {
      const b = novoRegistro();
      await abrir(entrada(), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra: sombraCom(f) });
      assert.equal(previsoesDe(b)[0].carga_fria, true);
    } finally {
      await f.fechar();
    }
  });

  test("marca de paciente ⇒ nenhuma chamada e nenhuma linha", async () => {
    const f = await servidorFalso();
    try {
      const b = novoRegistro();
      const chamadas = [];
      await abrir(entrada({ paciente: true }), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra: sombraCom(f, { chamadas }) });
      assert.equal(f.pedidos.length, 0);
      assert.equal(previsoesDe(b).length, 0);
      assert.equal(chamadas.length, 0, "o comando nem chama a sombra");
      // A sombra direto também recusa chamar, pela marca da abertura relida.
      const id = b.linhas.find((l) => l.evento === "abertura").pergunta_id;
      const r = await sombraCom(f)({ pergunta_id: id }, { registro: b.registro });
      assert.equal(r.pulou, "paciente");
      assert.equal(f.pedidos.length, 0);
    } finally {
      await f.fechar();
    }
  });

  test("reabertura de pergunta que já tem previsao não chama o servidor de novo", async () => {
    const f = await servidorFalso();
    try {
      const b = novoRegistro();
      const sombra = sombraCom(f);
      const um = await abrir(entrada(), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra });
      const pedidosDaPrimeira = f.pedidos.length;
      assert.ok(pedidosDaPrimeira > 0);
      const dois = await abrir(entrada(), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra });
      assert.equal(dois.pergunta_id, um.pergunta_id);
      assert.equal(f.pedidos.length, pedidosDaPrimeira, "nenhuma segunda chamada");
      assert.equal(previsoesDe(b).length, 1);
    } finally {
      await f.fechar();
    }
  });

  test("a gravação da linha que falha vai a stderr e ao contador", async () => {
    const f = await servidorFalso();
    try {
      const b = novoRegistro();
      const gravar = b.registro.gravar;
      b.registro.gravar = async (sub, evs) => {
        if (sub === "prever") throw new Error("registro recusou");
        return gravar(sub, evs);
      };
      const err = [];
      const contador = path.join(pastaTemp(), "sub", "falhas.log");
      await abrir(entrada(), { registro: b.registro, destinatarios, carimbo: "2026-11-18T21:00:00Z", sombra: sombraCom(f, { stderr: { write: (s) => err.push(s) }, contador }) });
      assert.ok(err.some((s) => /a linha da previsao nao gravou/.test(s)));
      assert.equal(readFileSync(contador, "utf8").trim().split("\n").length, 1);
    } finally {
      await f.fechar();
    }
  });
});

test("o processo que sai logo depois de abrir deixa a linha gravada", async () => {
  const f = await servidorFalso();
  try {
    const pasta = pastaTemp();
    const arquivo = path.join(pasta, "eventos.jsonl");
    const filho = path.join(pasta, "filho.mjs");
    const url = (p) => pathToFileURL(path.join(AQUI, p)).href;
    writeFileSync(
      filho,
      [
        `import { appendFileSync, existsSync, readFileSync } from "node:fs";`,
        `import { abrir } from ${JSON.stringify(url("../comando.mjs"))};`,
        `import { sombrear } from ${JSON.stringify(url("../sombra.mjs"))};`,
        `import { pecasDuble } from ${JSON.stringify(url("./dubles.mjs"))};`,
        `const arquivo = ${JSON.stringify(arquivo)};`,
        `const ler = () => (existsSync(arquivo) ? readFileSync(arquivo, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l)) : []);`,
        `const registro = { destino: "banco", pecas: pecasDuble().pecas,`,
        `  async gravar(_s, evs) { for (const e of evs) appendFileSync(arquivo, JSON.stringify(e) + "\\n"); return { gravados: evs.length, ja_existiam: 0, enfileirados: 0, sem_registro: false, motivo: null, fila: null }; },`,
        `  async ler({ pergunta_id }) { return { eventos: ler().filter((e) => e.pergunta_id === pergunta_id), sem_registro: false, motivo: null, fila: null }; } };`,
        `const config = ${JSON.stringify(f.config)};`,
        `const entrada = JSON.parse(process.argv[2]);`,
        `await abrir(entrada, { registro, carimbo: "2026-11-18T21:00:00Z", sombra: (a, o) => sombrear(a, { ...o, config, chave: null, naGpu: async () => true, env: {}, contador: ${JSON.stringify(path.join(pasta, "falhas.log"))} }) });`,
        `process.exit(0);`,
      ].join("\n"),
    );
    // O filho fala com o servidor falso deste processo: assíncrono (síncrono bloquearia o servidor).
    const code = await new Promise((resolver) => {
      const c = spawn(process.execPath, [filho, JSON.stringify(entrada())], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      c.stderr.on("data", (d) => (err += d));
      c.on("exit", (n) => resolver({ n, err }));
    });
    assert.equal(code.n, 0, code.err);
    const linhas = readFileSync(arquivo, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(linhas.map((l) => l.evento), ["abertura", "previsao"]);
    assert.equal(linhas[1].motivo, null);
    assert.ok(f.pedidos.length > 0);
  } finally {
    await f.fechar();
  }
});

