#!/usr/bin/env node
/**
 * medir-replano.mjs — a observação do re-plano sozinho e da dívida de ambiente sai medida
 * (VEGA-19 T44, D-VEGA19-53, AC-VEGA19-13).
 *
 * `medir-replano.mjs --ciclo <id> [--desde <sha>] [--divida] [--repo <dir>] [--json]`
 *
 * Lê pelo `git log --first-parent` do ramo (HEAD) as marcas `Conducao: F<n> autorizada` que levam
 * `Conducao-Replano-Motivo` (o re-plano que seguiu sozinho, T43) e conta:
 * - `replanos_sozinhos` — as marcas com o trailer;
 * - `erros` — o re-plano sozinho que o operador desfez ou contestou: (a) `git revert` de commit do
 *   re-plano; (b) re-plano seguinte que remove ou reescreve task nascida num sozinho antes de ela
 *   executar (nenhum commit `<ciclo>-F<n>/T<k> —` ainda); (c) pergunta com `ponteiro`
 *   `replano:<sha8>` de um re-plano sozinho, respondida por `pessoa`, cuja opção escolhida não é
 *   "manter" (a pergunta é lida pelo `ler` do comando da pergunta, pelo adaptador do projeto —
 *   nunca importando biblioteca da Sistoli);
 * - `repetidos` — as perguntas `replano-repetido`: ponteiro `replano:<sha8>` de re-plano que NÃO
 *   seguiu sozinho (o motivo já tinha aparecido no ciclo).
 * Com `--divida`, as autorias de `pessoa` cujo `em_nome_de` é o papel do mandato (respondeu quem
 * não é o titular), contadas por mandato; sem registro ao alcance, `sem-leitura`.
 *
 * Veredito: `sem-amostra` (0 sozinhos) · `volta-ao-operador` (≥1 erro: manter · apertar a regra ·
 * desligar) · `segue`. Medidor, não guard: só lê, nunca grava; a nota do ciclo guarda a saída.
 *
 * ── WIRING (script-created-without-invoker) ──
 *   1. PRODUÇÃO — a condutora o roda na leitura da observação do re-plano sozinho:
 *      `node <raiz do plugin>/scripts/conducao/medir-replano.mjs --ciclo <id> --divida`
 *      (nota do ciclo: `notes/observacao-replano-sozinho-T44.md`; a observação segue depois do ciclo).
 *   2. `__tests__/medir-replano.test.mjs` — repo e registro de fixture.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tentarGit } from "./git-exec.mjs";
import { motivoDoReplano } from "./verbos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_PADRAO = path.resolve(AQUI, "..", "..", "..", "..", "..");
const TRAILER_MOTIVO = "Conducao-Replano-Motivo";
const TRAILER_REPLANOS = "Conducao-Replano";
/** O papel que responde pelo mandato (a linha da §Escalation; espelha `MANDATO_DO_PAPEL` da pergunta). */
export const PAPEL_DO_MANDATO = Object.freeze({ engenharia: "operador", societario: "socio", "clinico-regulatorio": "responsavel-clinico" });
const SEP_CAMPO = "\x1f";
const SEP_COMMIT = "\x1e";

function trailersDe(corpo) {
  const t = {};
  for (const l of String(corpo ?? "").split("\n")) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.+?)\s*$/.exec(l);
    if (m) t[m[1]] = m[2];
  }
  return t;
}

/** Os commits do ramo, do mais antigo ao mais novo: `{ sha, subject, corpo, trailers }`. */
export function commitsDoRamo(repo, { desde = null } = {}) {
  const faixa = desde ? [`${desde}..HEAD`] : ["HEAD"];
  // `spawnSync` próprio: o histórico do ramo estoura o `maxBuffer` padrão do `tentarGit`.
  const r = spawnSync("git", ["-C", repo, "log", "--first-parent", "--reverse", `--format=%H${SEP_CAMPO}%s${SEP_CAMPO}%B${SEP_COMMIT}`, ...faixa], {
    encoding: "utf8",
    maxBuffer: 1 << 29,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.status !== 0) throw new Error(`git log falhou: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout
    .split(SEP_COMMIT)
    .map((b) => b.replace(/^\n+/, ""))
    .filter((b) => b.trim())
    .map((b) => {
      const [sha, subject, corpo = ""] = b.split(SEP_CAMPO);
      return { sha: sha.trim(), subject: subject ?? "", corpo, trailers: trailersDe(corpo) };
    });
}

function canonicoEm(repo, sha, ciclo) {
  const ls = tentarGit(repo, ["ls-tree", "-r", "--name-only", sha, "--", ".agents/ciclo"]);
  if (ls.status !== 0) return null;
  const caminho = ls.saida.split("\n").find((p) => p.endsWith(`/${ciclo}/canonico.md`));
  if (!caminho) return null;
  const c = tentarGit(repo, ["show", `${sha}:${caminho}`]);
  return c.status === 0 ? c.saida : null;
}

/** `{ id → bloco }` das tasks (`#### T<k> — …`) do texto do canonico. */
function blocosDasTasks(texto) {
  const blocos = new Map();
  if (!texto) return blocos;
  const linhas = texto.split("\n");
  let atual = null;
  for (const l of linhas) {
    const h = /^####\s+(T\d+)\b/.exec(l);
    if (h) {
      atual = h[1];
      blocos.set(atual, []);
    } else if (/^#{2,4}\s/.test(l)) atual = null;
    if (atual) blocos.get(atual).push(l);
  }
  return new Map([...blocos].map(([id, ls]) => [id, ls.join("\n")]));
}

function veioDoRevert(c, alvos) {
  const m = [...c.corpo.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)].map((x) => x[1]);
  return m.some((s) => alvos.some((a) => a.startsWith(s) || s.startsWith(a)));
}

/**
 * O que o git diz: as marcas sozinhas, os reverts e os re-planos seguintes que desfazem task
 * nascida num sozinho. Puro sobre `commits` + `lerCanonico(sha)`.
 */
export function medirGit({ commits, ciclo, lerCanonico }) {
  const sozinhos = commits
    .filter((c) => c.trailers[TRAILER_MOTIVO] && c.trailers["Conducao-Origem"] === "sozinho")
    .map((c) => ({
      marca: c.sha,
      motivo: c.trailers[TRAILER_MOTIVO],
      replanos: (c.trailers[TRAILER_REPLANOS] ?? "").split(/\s+/).filter(Boolean),
    }));
  const erros = [];
  const replanoDe = new Map(); // sha do commit do re-plano → o sozinho
  for (const s of sozinhos) for (const r of s.replanos) replanoDe.set(r, s);
  // (a) git revert de commit do re-plano sozinho
  for (const c of commits) {
    const alvos = [...replanoDe.keys()];
    if (alvos.length && veioDoRevert(c, alvos)) erros.push({ tipo: "revert", sha: c.sha });
  }
  // (b) re-plano seguinte que remove/reescreve task nascida num sozinho antes de executar
  const reTask = new RegExp(`^${ciclo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-F\\d+[/.](T\\d+)\\b`);
  const indice = new Map(commits.map((c, i) => [c.sha, i]));
  for (const s of sozinhos) {
    for (const r of s.replanos) {
      const i = indice.get(r);
      if (i === undefined) continue;
      const antes = blocosDasTasks(lerCanonico(i > 0 ? commits[i - 1].sha : `${r}^`));
      const depois = blocosDasTasks(lerCanonico(r));
      const nascidas = [...depois.keys()].filter((id) => !antes.has(id));
      const executadas = new Set();
      let corrente = depois;
      for (let j = i + 1; j < commits.length; j++) {
        const m = reTask.exec(commits[j].subject);
        if (m) executadas.add(m[1]);
        const agora = blocosDasTasks(lerCanonico(commits[j].sha));
        for (const id of nascidas) {
          if (executadas.has(id) || !corrente.has(id)) continue;
          if (!agora.has(id) || agora.get(id) !== corrente.get(id)) erros.push({ tipo: "replano-mexeu-em-task-sozinha", sha: commits[j].sha, task: id });
        }
        corrente = agora;
      }
    }
  }
  return { sozinhos, erros };
}

function escolhida(p) {
  // A opção escolhida pela resposta (`escolhas` letra → texto da opção na abertura), se legível.
  const letras = (p.escolhas ?? []).map((e) => e?.letra).filter(Boolean);
  const opcoes = (p.itens ?? []).flatMap((it) => it?.opcoes ?? []);
  return letras.map((l) => opcoes.find((o) => o?.letra === l)?.texto ?? "");
}

const respondidaPorPessoa = (p) => p.estado === "respondida" && (p.origem === "pessoa" || p.origem_resposta === "pessoa");

/**
 * O que o registro das perguntas diz. `perguntas` = `ler().perguntas` do comando da pergunta (ou
 * `null` sem leitura). Devolve os erros por pergunta, os repetidos e a dívida por mandato.
 */
export function medirPerguntas({ perguntas, ciclo, sozinhos }) {
  const doCiclo = perguntas.filter((p) => !p.ciclo || p.ciclo === ciclo);
  const sha8Sozinhos = new Set(sozinhos.flatMap((s) => s.replanos.map((r) => r.slice(0, 8))));
  const noReplano = doCiclo
    .map((p) => ({ p, m: /^replano:([0-9a-f]{8})$/.exec(p.ponteiro ?? "") }))
    .filter((x) => x.m)
    .map((x) => ({ ...x, sha8: x.m[1] }));
  const erros = noReplano
    .filter(({ p, sha8 }) => sha8Sozinhos.has(sha8) && respondidaPorPessoa(p) && !escolhida(p).some((t) => /^\s*manter\b/i.test(t)))
    .map(({ p }) => ({ tipo: "pergunta-contra-o-replano", pergunta: p.pergunta_id }));
  const repetidos = noReplano.filter(({ sha8 }) => !sha8Sozinhos.has(sha8)).length;
  const divida = {};
  for (const p of doCiclo) {
    if (!respondidaPorPessoa(p) || !p.mandato) continue;
    const papel = PAPEL_DO_MANDATO[p.mandato];
    if (p.em_nome_de && p.em_nome_de === papel) divida[p.mandato] = (divida[p.mandato] ?? 0) + 1;
  }
  return { erros, repetidos, divida };
}

/**
 * Mede o ciclo. `ler` é a leitura das perguntas (`async () => ({ perguntas })`); falha ou ausência
 * de registro ⇒ `sem-leitura` na dívida e erros só do git (declarado em `perguntas`).
 */
export async function medir({ repo, ciclo, desde = null, divida = false, ler = null, lerCanonico = null }) {
  const commits = commitsDoRamo(repo, { desde });
  const canonico = lerCanonico ?? ((sha) => canonicoEm(repo, sha, ciclo));
  const g = medirGit({ commits, ciclo, lerCanonico: canonico });
  let perguntas = null;
  let motivoSemLeitura = null;
  if (typeof ler === "function") {
    try {
      const lido = await ler();
      // Registro fora do ar: o `ler` sai sem erro, só com a fila local e `sem_registro`. Isso é
      // sem leitura, nunca "lido e vazio" — senão a dívida e o erro (c) saem 0 em silêncio.
      if (lido?.sem_registro) motivoSemLeitura = "registro fora do ar (sem_registro)";
      else perguntas = lido?.perguntas ?? [];
    } catch (e) {
      motivoSemLeitura = e?.message ?? String(e);
    }
  } else motivoSemLeitura = "sem leitor das perguntas";
  const p = perguntas ? medirPerguntas({ perguntas, ciclo, sozinhos: g.sozinhos }) : { erros: [], repetidos: 0, divida: {} };
  const erros = [...g.erros, ...p.erros];
  const n = g.sozinhos.length;
  const veredito = n === 0 ? "sem-amostra" : erros.length >= 1 ? "volta-ao-operador" : "segue";
  return {
    ciclo,
    replanos_sozinhos: n,
    erros: erros.length,
    detalhe_dos_erros: erros,
    repetidos: p.repetidos,
    perguntas: perguntas ? "lidas" : `sem-leitura (${motivoSemLeitura})`,
    divida_de_ambiente: !divida ? "nao-pedida" : perguntas ? Object.values(p.divida).reduce((a, b) => a + b, 0) : "sem-leitura",
    divida_por_mandato: divida && perguntas ? p.divida : {},
    veredito,
  };
}

export function formatar(r) {
  const linhas = [
    `ciclo: ${r.ciclo}`,
    `replanos_sozinhos: ${r.replanos_sozinhos}`,
    `erros: ${r.erros}`,
    ...r.detalhe_dos_erros.map((e) => `  - ${e.tipo}: ${e.sha ?? e.pergunta}${e.task ? ` (${e.task})` : ""}`),
    `repetidos: ${r.repetidos}`,
    `perguntas: ${r.perguntas}`,
    `divida_de_ambiente: ${r.divida_de_ambiente}`,
    ...Object.entries(r.divida_por_mandato).map(([m, n]) => `  - ${m}: ${n}`),
    `veredito: ${r.veredito}`,
  ];
  return linhas.join("\n");
}

const USO = "uso: medir-replano.mjs --ciclo <id> [--desde <sha>] [--divida] [--repo <dir>] [--json]\n";

export function parsear(argv) {
  const o = { json: false, divida: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--divida") o.divida = true;
    else if (["--ciclo", "--desde", "--repo"].includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return { erro: `${a} exige valor` };
      o[a.slice(2)] = v;
    } else return { erro: `argumento desconhecido: ${a}` };
  }
  if (!o.ciclo) return { erro: "--ciclo é obrigatório" };
  return { opcoes: o };
}

/** O leitor real: o `ler` do comando da pergunta, pelo adaptador do projeto em `repo`. */
export async function leitorDoProjeto(repo) {
  const { registroDoProjeto, ler } = await import("../pergunta/comando.mjs");
  const registro = await registroDoProjeto(repo);
  return () => ler({}, { registro });
}

export async function principal(argv, { stdout = process.stdout, stderr = process.stderr, ler = undefined } = {}) {
  const { erro, opcoes: o } = parsear(argv);
  if (erro) {
    stderr.write(`${erro}\n${USO}`);
    return 2;
  }
  const repo = path.resolve(o.repo ?? RAIZ_PADRAO);
  try {
    let leitor = ler;
    if (leitor === undefined) {
      try {
        leitor = await leitorDoProjeto(repo);
      } catch (e) {
        const motivo = `sem leitor das perguntas: ${e?.message ?? String(e)}`;
        leitor = async () => {
          throw new Error(motivo);
        };
      }
    }
    const r = await medir({ repo, ciclo: o.ciclo, desde: o.desde ?? null, divida: o.divida, ler: leitor });
    stdout.write(`${o.json ? JSON.stringify(r, null, 2) : formatar(r)}\n`);
    return 0;
  } catch (e) {
    stderr.write(`medir-replano: ${e?.message ?? String(e)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await principal(process.argv.slice(2));
}
