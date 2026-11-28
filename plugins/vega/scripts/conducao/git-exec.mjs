/**
 * git-exec.mjs — o executor git único da condução (VEGA-29 T5, prazo na T17).
 *
 * `git` lança no exit diferente de 0 e devolve a saída aparada (`cru` devolve
 * byte a byte); `tentarGit` nunca lança e devolve `{ status, saida, erro }`.
 * Os dois rodam com `GIT_TERMINAL_PROMPT=0` e com prazo (T17, 20-a): a chamada
 * de rede (`rede`) tem `PRAZO_REDE_MS`, a local `PRAZO_GIT_MS`, e o estouro
 * mata o processo com `SIGKILL` (o git pendurado num hook ou num lock não
 * responde a `SIGTERM` a tempo). No `git`, o estouro vira `ErroGitPrazo`,
 * desfecho `git-prazo-estourado`, com os `*.lock` achados sob o git-dir — o
 * lock que sobra é o que trava a próxima chamada; no `tentarGit`, volta
 * `status: null` com `prazoEstourado` e os mesmos locks.
 *
 * Consumidores: `conducao.mjs`, `git-conducao.mjs`, `marcas.mjs` e o hook
 * `operaria-stop-guard.js`.
 *
 * MEMÓRIA POR PROCESSO (hotfix vega-conducao-git-memoizado, decisão D4a do
 * operador, 25/11/2026). Uma resposta se repete dentro do mesmo comando só
 * quando não pode mudar enquanto ele roda: a que depende só de objetos
 * endereçados por SHA completo (`show <sha>:<caminho>`, `log -1 --format=%b
 * <sha>`, `ls-tree <sha>`, `merge-base --is-ancestor <sha> <sha>`, `diff <sha>
 * <sha>`…) e a raiz do repositório (`rev-parse --show-toplevel`, `--git-dir`,
 * `--git-common-dir`). A forma aceita é uma LISTA DO QUE É PERMITIDO por
 * subcomando (`respostaImutavel`); nada que leia HEAD, ref, nota, mailmap,
 * índice, árvore de trabalho ou relógio entra: o próprio comando os muda, e
 * resposta guardada errada vira decisão errada. Medido no `conducao-rodadas`
 * (263 comandos, 5.944 chamadas): 841 se repetem no mesmo processo; HEAD e ref
 * ficaram de fora de propósito. Só sucesso é guardado; falha e prazo estourado
 * sempre tornam a perguntar. `ALTAIR_CONDUCAO_GIT_SEM_MEMORIA=1` desliga.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const ENV_GIT = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
/** Rede (push/fetch/ls-remote) com prazo: origin pendurado vira erro, nunca espera infinita. */
export const PRAZO_REDE_MS = 120_000;
/**
 * Git local com prazo: folgado para `commit` com hooks e `log` de histórico
 * longo, curto o bastante para a maestra não esperar para sempre. O teste o
 * encurta por `ALTAIR_CONDUCAO_GIT_PRAZO_MS` (vale para rede e local).
 */
export const PRAZO_GIT_MS = 600_000;
const PRAZO_FORCADO = Number(process.env.ALTAIR_CONDUCAO_GIT_PRAZO_MS) > 0 ? Number(process.env.ALTAIR_CONDUCAO_GIT_PRAZO_MS) : null;

export const DESFECHO_PRAZO = "git-prazo-estourado";

export class ErroGitPrazo extends Error {
  constructor({ args, prazoMs, locks }) {
    super(`git ${args.join(" ")} passou de ${prazoMs} ms e foi morto${locks.length ? ` — lock: ${locks.join(", ")}` : ""}`);
    this.name = "ErroGitPrazo";
    this.codigo = DESFECHO_PRAZO;
    this.comando = ["git", ...args].join(" ");
    this.prazoMs = prazoMs;
    this.locks = locks;
  }
}

function prazo(rede) {
  return PRAZO_FORCADO ?? (rede ? PRAZO_REDE_MS : PRAZO_GIT_MS);
}

function estourou(e) {
  return e?.code === "ETIMEDOUT";
}

/** Git-dir (e o comum, em worktree) sem depender do git que acabou de pendurar: `.git` lido à mão se ele não responder. */
function gitDirs(repo) {
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--git-dir", "--git-common-dir"], {
    encoding: "utf8",
    env: ENV_GIT,
    timeout: 5_000,
    killSignal: "SIGKILL",
  });
  if (r.status === 0) return [...new Set(r.stdout.split("\n").filter(Boolean).map((l) => path.resolve(repo, l)))];
  const ponto = path.join(repo, ".git");
  try {
    if (statSync(ponto).isDirectory()) return [ponto];
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(ponto, "utf8"));
    return m ? [path.resolve(repo, m[1].trim())] : [];
  } catch {
    return [];
  }
}

/** `*.lock` sob o git-dir (sem descer em `objects`), em caminho absoluto. */
export function locksDoRepo(repo) {
  const achados = new Set();
  const descer = (dir, fundo) => {
    let itens;
    try {
      itens = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (it.name !== "objects" && fundo < 8) descer(p, fundo + 1);
      } else if (it.name.endsWith(".lock")) achados.add(p);
    }
  };
  for (const d of gitDirs(repo)) if (existsSync(d)) descer(d, 0);
  return [...achados].sort();
}

// LISTA DO QUE E PERMITIDO, nunca do que e proibido (achado dos dois revisores deste hotfix): uma
// opcao que o git ganhe amanha, ou um formato que leia ref (`%d`/`%D`/`--decorate`), nota (`%N`,
// o `show <sha>` de commit), mailmap (`%aN`), tag (`%(describe)`), relogio (`%ar`, `--date=human`)
// ou chaveiro (`%G?`), nasce FORA da memoria. Cada subcomando lista as opcoes que nao mudam a
// resposta; posicional so com SHA completo.
const SHA = "[0-9a-f]{40}(?:[0-9a-f]{24})?";
// SHA com sufixo de objeto ou ancestral (`^{commit}`, `^`, `~2`) e, opcional, `:caminho`.
const REV = `${SHA}(?:\\^\\{(?:tree|commit|blob)\\}|\\^[0-9]?|~[0-9]*)*`;
const POSICIONAL_IMUTAVEL = new RegExp(`^(?:${REV}(?:\\.\\.\\.?${REV})?|${REV}:.*)$`);
const BLOB = new RegExp(`^${REV}:.*$`);
const INTERVALO = new RegExp(`^${REV}\\.\\.\\.?${REV}$`);
// Placeholder de formato que depende so do objeto: hash cheio, arvore, pais, assunto, corpo,
// autor e committer crus (sem mailmap), datas absolutas, trailers, quebra e byte literal.
const FORMATO_IMUTAVEL = /^(?:%(?:H|T|P|s|b|B|n|%|x[0-9a-fA-F]{2}|a[neti]|aI|c[neti]|cI|\((?:trailers(?::[^)]*)?)\))|[^%])*$/;
const OPCOES = {
  // `show` so de blob (`<sha>:<caminho>`): o de commit imprime notas e muda com elas.
  show: new Set([]),
  "rev-parse": new Set(["--verify", "-q", "--quiet"]),
  "ls-tree": new Set(["-r", "-t", "-z", "--name-only", "--full-tree"]),
  // `log` exige `--format`: o padrao imprime notas e decoracao.
  log: new Set(["-1", "-z", "--reverse", "--first-parent", "--no-merges", "--merges", "--topo-order", "--extended-regexp", "-E"]),
  "rev-list": new Set(["--reverse", "--merges", "--no-merges", "--ancestry-path", "--first-parent", "--count", "--topo-order", "--extended-regexp", "-E"]),
  "merge-base": new Set(["--is-ancestor"]),
  diff: new Set(["--name-only", "--name-status", "-z", "--no-renames"]),
  "diff-tree": new Set(["-z", "-r", "--root", "--no-commit-id", "--name-only", "--name-status", "--no-renames"]),
  "cat-file": new Set(["-p", "-t", "-e", "-s"]),
};
const TOPO = new Set(["--show-toplevel", "--git-dir", "--git-common-dir"]);

/** true se a resposta desta chamada não pode mudar enquanto o processo vive. */
export function respostaImutavel(args) {
  if (!Array.isArray(args) || args.length === 0) return false;
  const [sub, ...resto] = args;
  if (sub === "rev-parse" && resto.length > 0 && resto.every((a) => TOPO.has(a))) return true;
  const permitidas = OPCOES[sub];
  if (!permitidas) return false;
  let posicionais = 0;
  let intervalos = 0;
  let formato = false;
  let caminhos = false;
  for (const a of resto) {
    if (caminhos) continue; // depois de `--`, filtro de caminho sobre objeto imutável
    if (a === "--") { caminhos = true; continue; }
    if (a.startsWith("-")) {
      const m = /^--(?:format|pretty)=(?:format:|tformat:)?(.*)$/s.exec(a);
      if (m && (sub === "log" || sub === "rev-list")) {
        if (!FORMATO_IMUTAVEL.test(m[1])) return false;
        formato = true;
        continue;
      }
      if (/^--grep=/.test(a) && (sub === "log" || sub === "rev-list")) continue; // casa a mensagem, imutável
      if (!permitidas.has(a)) return false;
      continue;
    }
    if (!POSICIONAL_IMUTAVEL.test(a)) return false;
    if (sub === "show" && !BLOB.test(a)) return false;
    if (INTERVALO.test(a)) intervalos++;
    posicionais++;
  }
  if (sub === "log" && !formato) return false;
  // `diff` com um lado so compara com a arvore de trabalho: exige dois SHAs ou um intervalo
  // SHA..SHA ANTES do `--` (o que vem depois e caminho, nunca lado do diff — achado do hunter).
  if (sub === "diff" && posicionais !== 2 && !(posicionais === 1 && intervalos === 1)) return false;
  return posicionais > 0;
}

const MEMORIA = new Map();
// Teto por entradas e por bytes: o executor vive em processo curto (um comando), mas quem o
// importar num processo longo nao cresce sem fim. Passou do teto, esvazia (o custo e so perguntar
// de novo); resposta grande demais nem entra.
const TETO_ENTRADAS = 5000;
const TETO_BYTES = 64 * 1024 * 1024;
const MAIOR_RESPOSTA = 8 * 1024 * 1024;
let bytesGuardados = 0;
function guardar(k, v) {
  const tamanho = v.cru.length + v.stderr.length;
  if (tamanho > MAIOR_RESPOSTA) return;
  if (MEMORIA.size >= TETO_ENTRADAS || bytesGuardados + tamanho > TETO_BYTES) {
    MEMORIA.clear();
    bytesGuardados = 0;
  }
  MEMORIA.set(k, v);
  bytesGuardados += tamanho;
}
const semMemoria = () => process.env.ALTAIR_CONDUCAO_GIT_SEM_MEMORIA === "1";
function chave(repo, args) {
  return `${path.resolve(repo)}\u0000${args.join("\u0000")}`;
}
/** Para teste: esvazia a memória do processo e devolve quantas respostas ela guardava. */
export function esquecerMemoriaGit() {
  const n = MEMORIA.size;
  MEMORIA.clear();
  bytesGuardados = 0;
  return n;
}
export const _memoriaGit = MEMORIA;

export function git(repo, args, { rede = false, entrada, cru = false } = {}) {
  const guardavel = !rede && entrada === undefined && !semMemoria() && respostaImutavel(args);
  const k = guardavel ? chave(repo, args) : null;
  if (guardavel && MEMORIA.has(k)) {
    const m = MEMORIA.get(k);
    if (m.status === 0) return cru ? m.cru : m.cru.trim();
  }
  const prazoMs = prazo(rede);
  let saida;
  try {
    saida = execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: ENV_GIT,
      input: entrada,
      timeout: prazoMs,
      killSignal: "SIGKILL",
      stdio: [entrada === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch (e) {
    if (estourou(e)) throw new ErroGitPrazo({ args, prazoMs, locks: locksDoRepo(repo) });
    throw e;
  }
  if (guardavel) guardar(k, { status: 0, cru: saida, stderr: "" });
  return cru ? saida : saida.trim();
}

export function tentarGit(repo, args, { rede = false } = {}) {
  const guardavel = !rede && !semMemoria() && respostaImutavel(args);
  const k = guardavel ? chave(repo, args) : null;
  if (guardavel && MEMORIA.has(k)) {
    const m = MEMORIA.get(k);
    return { status: 0, saida: m.cru.trim(), erro: m.stderr.trim() };
  }
  const prazoMs = prazo(rede);
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: ENV_GIT,
    timeout: prazoMs,
    killSignal: "SIGKILL",
  });
  if (estourou(r.error)) {
    const locks = locksDoRepo(repo);
    return { status: null, saida: (r.stdout ?? "").trim(), erro: new ErroGitPrazo({ args, prazoMs, locks }).message, prazoEstourado: true, locks };
  }
  if (guardavel && r.status === 0 && !r.error) guardar(k, { status: 0, cru: r.stdout ?? "", stderr: r.stderr ?? "" });
  return { status: r.status, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? r.error?.message ?? "").trim() };
}
