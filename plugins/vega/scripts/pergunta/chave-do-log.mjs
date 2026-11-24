/**
 * chave-do-log.mjs — o que o log da condução diz da chave escondida da pergunta (hotfix
 * vega-chave-do-log-da-conducao, 23/11/2026).
 *
 * A #801 completava a chave pela entrada e pelo ramo; as filhas da condução rodam com HEAD solto
 * (medido em 23/11: 286 de 402 árvores soltas, 1 num ramo `ciclo-*`), e ali a chave não ganhava nem
 * o ciclo. O log da condução (`<pastaDoLog>/<ciclo>.jsonl`, `log-eventos.mjs`) já sabe tudo: a fase
 * pelo último `vida`/`autorizada`/`autorizacao-herdada`, a task pela tentativa aberta, e quem a
 * executa pelo objeto `sessao:session_<X>` — o mesmo `<X>` da pasta `.claude/worktrees/bridge-cse_<X>`
 * da filha.
 *
 * Precedência da chave (aplicada em `comando.mjs completarChave`): chave dada > log da condução >
 * ramo > `-`; na origem, o ramo vem antes do log (o log grava o mesmo `filha` para toda sessão). Log ausente, ilegível ou sem casamento devolve `{}`: o `abrir` nunca quebra por ele.
 *
 * A ORIGEM também sai do casamento (hotfix vega-pareador-texto-livre, 24/11/2026): a filha em HEAD
 * solto saía `avulsa`, porque a origem vinha só do ramo. O papel é o `qualificador` do objeto
 * `sessao:` no log (`log-eventos.mjs` grava `filha` para toda sessão que a condução cria), afinado
 * para `condutora` quando a sessão aparece num evento de condutora (`DA_CONDUTORA`). Regra segura,
 * quando o papel falta ou não é do vocabulário: `filha` — o papel menos específico que vale para
 * toda sessão que o log nomeia (quem aparece no log foi criada pela condução); nunca `maestra` nem
 * `condutora`, que o log não provou. `operaria` (o nome do papel na condução) vira `filha`, que é
 * como o vocabulário fechado da chave (`ORIGENS`) chama a sessão de task.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** A pasta da árvore de uma sessão da ponte: `.claude/worktrees/bridge-cse_<X>`. */
const ARVORE_DA_PONTE = /[\\/]\.claude[\\/]worktrees[\\/]bridge-cse_([A-Za-z0-9]{8,64})(?:[\\/]|$)/;
const CICLO_DO_ARQUIVO = /^([A-Za-z][A-Za-z0-9._-]{1,127})\.jsonl$/;
/** O que abre uma task: a tentativa registrada aberta, ou a condutora que a faz ela mesma. */
const ABRE = new Set(["aberta", "fazer-condutora"]);
/** O que fecha uma task aberta. */
const FECHA = new Set(["conferida", "trazida", "arquivar", "falha-registrada", "revertida"]);
/** O que diz a fase corrente. */
const DIZ_A_FASE = new Set(["vida", "autorizada", "autorizacao-herdada"]);
/** O que mostra a sessão no papel de condutora (e não de operária de uma task). */
const DA_CONDUTORA = new Set(["criar-condutora", "fazer-condutora", "atendido"]);
/** Os papéis do log que valem como origem da chave, e o nome dela no vocabulário `ORIGENS`. */
const PAPEL_DO_LOG = new Map([
  ["filha", "filha"],
  ["neta", "neta"],
  ["operaria", "filha"],
]);
/** A origem quando a sessão casou e o papel falta (ou não é do vocabulário): a regra segura. */
export const ORIGEM_SEGURA = "filha";

/** A sessão da nuvem (`session_<X>`) que a árvore em `cwd` serve; fora de uma árvore da ponte, `null`. Puro. */
export function sessaoDaArvore(cwd) {
  if (typeof cwd !== "string") return null;
  const m = ARVORE_DA_PONTE.exec(path.resolve(cwd));
  return m ? `session_${m[1]}` : null;
}

function lerTalvez(arquivo, ler) {
  try {
    return String(ler(arquivo));
  } catch {
    return null;
  }
}

/**
 * A chave que o texto de um log diz, para a `sessao` dada (ou `null`). Puro: linha ilegível é
 * pulada. Devolve `{ fase?, task?, origem?, casou }` — `casou` diz se a sessão aparece no log, e
 * a `origem` (só com `casou`) é o papel dela no log, pela regra do cabeçalho.
 */
export function chaveDoTexto(texto, ciclo, sessao = null) {
  const prefixo = `task:${ciclo}/`;
  const objSessao = sessao ? `sessao:${sessao}` : null;
  let fase = null;
  let casou = false;
  let daSessao = null;
  let condutora = false;
  let papel = null;
  const abertas = new Map(); // task -> ordem em que abriu
  let ordem = 0;
  for (const linha of String(texto).split("\n")) {
    if (!linha.includes('"evento"')) continue;
    let e;
    try {
      e = JSON.parse(linha);
    } catch {
      continue;
    }
    if (!e || e.linha !== "evento" || typeof e.acao !== "string" || !Array.isArray(e.objetos)) continue;
    const ids = e.objetos.map((o) => (o && typeof o.id === "string" ? o.id : "")).filter(Boolean);
    const tasks = [...new Set(ids.filter((i) => i.startsWith(prefixo)).map((i) => i.slice(prefixo.length)).filter((t) => /^T\d{1,3}$/.test(t)))];
    if (DIZ_A_FASE.has(e.acao)) {
      const f = ids.find((i) => i.startsWith(`fase:${ciclo}/`))?.slice(`fase:${ciclo}/`.length);
      if (f && /^F\d{1,2}$/.test(f)) fase = f;
    }
    if (objSessao && ids.includes(objSessao)) {
      casou = true;
      if (DA_CONDUTORA.has(e.acao)) condutora = true;
      // O papel do evento mais recente que o diz (o `qualificador` do objeto da sessão).
      const q = e.objetos.find((o) => o && o.id === objSessao)?.qualificador;
      if (typeof q === "string" && PAPEL_DO_LOG.has(q)) papel = PAPEL_DO_LOG.get(q);
      // Só o evento com uma task liga a sessão a ela: o `abrir` da leva paralela traz várias e nenhuma sessão.
      if (tasks.length === 1) daSessao = tasks[0];
    }
    if (tasks.length === 1 && ABRE.has(e.acao)) abertas.set(tasks[0], ordem++);
    if (FECHA.has(e.acao)) for (const t of tasks) abertas.delete(t);
  }
  const out = { casou };
  if (fase) out.fase = fase;
  if (casou) out.origem = condutora ? "condutora" : (papel ?? ORIGEM_SEGURA);
  // A task da sessão só vale aberta: a condutora que fez T6 e a arquivou não segue "em T6".
  if (daSessao && abertas.has(daSessao)) out.task = daSessao;
  // A aberta única vale para a condutora (ou a sessão sem task própria, a condutora aberta à mão);
  // a operária cuja task fechou não herda a task de outra filha: sai `-`.
  else if (abertas.size === 1 && (!daSessao || condutora)) out.task = [...abertas.keys()][0];
  // Mais de uma task aberta e a sessão sem casamento (a condutora da leva paralela): a posição sai `-`.
  return out;
}

/**
 * O que o log da condução diz da chave: `{ ciclo?, fase?, task?, origem? }` ou `{}` (a origem só
 * quando a sessão casou). Com `ciclo`, lê só o log
 * dele (a sessão casando ou não: a condutora aberta à mão não aparece no log). Sem `ciclo` (HEAD
 * solto), procura entre os logs da pasta o que tem a `sessao` (o mais recente, se mais de um) e
 * devolve aquele ciclo. Nunca lança.
 */
export function chaveDoLog({ pasta = null, ciclo = null, sessao = null, ler = readFileSync, listar = readdirSync } = {}) {
  try {
    if (typeof pasta !== "string" || !pasta) return {};
    const deCiclo = (c, texto) => {
      const r = chaveDoTexto(texto, c, sessao);
      const out = {};
      if (r.fase) out.fase = r.fase;
      if (r.task) out.task = r.task;
      if (r.origem) out.origem = r.origem;
      return { r, out };
    };
    // O log do ciclo já conhecido (entrada ou ramo): a sessão casou nele, ou não há sessão a casar, e é ele.
    let doDado = {};
    if (typeof ciclo === "string" && CICLO_DO_ARQUIVO.test(`${ciclo}.jsonl`)) {
      const texto = lerTalvez(path.join(pasta, `${ciclo}.jsonl`), ler);
      if (texto !== null) {
        const { r, out } = deCiclo(ciclo, texto);
        if (!sessao || r.casou) return out;
        doDado = out; // sem casamento, `out` não tem origem: a sessão não está no log
      }
    }
    // Ciclo conhecido (entrada ou ramo): os outros logs não são varridos — o ramo diz o ciclo.
    if (!sessao || ciclo) return doDado;
    let achado = null;
    let nomes;
    try {
      nomes = listar(pasta);
    } catch {
      return doDado;
    }
    const agulha = `"sessao:${sessao}"`;
    for (const nome of nomes) {
      const m = CICLO_DO_ARQUIVO.exec(String(nome));
      if (!m || m[1] === ciclo) continue;
      const texto = lerTalvez(path.join(pasta, m[1] + ".jsonl"), ler);
      if (texto === null) continue;
      const ultima = texto.lastIndexOf(agulha);
      if (ultima < 0) continue;
      const quando = /"quando":"([^"]+)"/.exec(texto.slice(ultima))?.[1] ?? "";
      if (!achado || quando > achado.quando) achado = { ciclo: m[1], texto, quando };
    }
    // A sessão não aparece em log nenhum (a condutora que o operador abriu à mão): vale o do ciclo conhecido.
    if (!achado) return doDado;
    const { out } = deCiclo(achado.ciclo, achado.texto);
    return { ciclo: achado.ciclo, ...out };
  } catch {
    return {};
  }
}
