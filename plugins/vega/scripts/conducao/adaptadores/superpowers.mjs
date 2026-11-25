/**
 * superpowers.mjs — o adaptador embutido do formato público de plano (VEGA-29 T21).
 *
 * Lê o plano que o `writing-plans` do superpowers escreve (o Deneb: `docs/planos/`;
 * o padrão do plugin: `docs/superpowers/plans/`), um arquivo por ciclo, com o id do
 * ciclo igual ao nome do arquivo sem `.md`. É a única exceção à regra de que o código
 * do adaptador mora em `<repo>/.altair/` (a restrição do plano): o formato é público, então o
 * leitor viaja com o núcleo. Mesma forma do código de qualquer adaptador, conferida por
 * `validarCodigo` (`adaptador.mjs`).
 *
 * O formato, fora de bloco de código:
 *
 *   **Fase:** F<n>                  — no topo, OPCIONAL (default F1): o arquivo é uma fase
 *   **Modelo:** <texto>             — no topo, OPCIONAL: o modelo da fase
 *   **Tier:** <tier>                — no topo, OPCIONAL: o tier da fase (`mecanico` · `parecer` ·
 *                                     `critico` · `inherit`, default `inherit`); a tarefa o troca
 *   **Largura do ciclo:** <n>       — no topo, OPCIONAL: ausente cai no padrão do núcleo
 *
 * Plano de várias fases num arquivo só (D-VEGA37-54): o cabeçalho `## Fase F<n>`
 * (`## Fase F<n> — <título>` também), OPCIONAL, abre a fase; as tarefas abaixo dele são
 * dessa fase até o próximo cabeçalho de fase, e `**Modelo:**` e `**Tier:**` entre o
 * cabeçalho e a primeira tarefa dele são os da fase (sem eles, os do topo). `fases` sai
 * na ordem do arquivo. A numeração segue corrida no arquivo (T1..Tn, sem recomeçar por
 * fase), e cada fase tem a sua tarefa com `fechamento-de-fase`. Vão a perguntar: fase
 * sem fechamento, fase repetida, fase fora da forma `F<n>`, heading que parece fase fora
 * do `## Fase F<n>`, tarefa antes do primeiro cabeçalho de fase e `**Fase:**` (no topo
 * ou sob um cabeçalho) junto com cabeçalho de fase. Plano sem cabeçalho de fase é lido
 * como sempre: o `**Fase:**` do topo, default F1.
 *   ### Tarefa <n>: <título>        — a tarefa `T<n>` (`### Task <n>:` também)
 *   **Arquivos:** / **Files:**      — a lista `- Criar|Modificar|Teste: \`caminho\`` vira os Outputs
 *   - [ ] **Passo <k>: …**          — os passos (Steps)
 *
 * e as anotações da tarefa, uma por linha, entre o título e o primeiro passo:
 *
 *   **Estação:** servidor | workstation | condutora — OBRIGATÓRIA (`maestra`, o nome antigo, lê-se `condutora`)
 *   **Publicação:** sim | não                       — OBRIGATÓRIA
 *   **Sensível:** sim | não                         — OBRIGATÓRIA
 *   **Verificação:** `<comando>`                    — o único comando que a conferência roda
 *   **Marcas:** <marca>, …                          — as marcas do núcleo
 *                                                     (`fechamento-de-fase`, `conferencia-do-operador`)
 *   **Independente:** sim · **Prazo:** <n> min · **Verificação pós-merge:** sim
 *   **Empurra no meio:** sim                        — OPCIONAL, só em ciclo sem ramo: a operária empurra ao
 *                                                     ramo principal dentro da tarefa
 *   **Verificação vence:** sim                      — OPCIONAL, só em ciclo sem ramo: feita fora da condução,
 *                                                     a tarefa é reconhecida sem rodar a Verificação
 *   **Commit:** <subject>                           — OPCIONAL: sem ela, o `-m "…"` do `git commit`
 *   **Tier:** <tier>                                — OPCIONAL: o tier da tarefa, acima do da fase
 *
 * Nada é adivinhado: estação, publicação e sensibilidade vêm só da anotação, nunca do
 * texto (o passo que diz `db push` ou "o operador abre no celular" não muda nada). Tarefa
 * sem uma das três, ou com valor fora do vocabulário, sai com o campo nulo e entra em
 * `declaracoes.invalidas` como a perguntar — e o núcleo, ao ler o plano para pedir o
 * sim, pergunta (`declaracao-invalida`) em vez de abrir filha. Verificação e commit
 * só explícitos, fechamento de fase só pela marca. Vai a perguntar também o plano que
 * sumiria em silêncio: sem tarefa, heading de tarefa fora do formato, numeração com
 * buraco, cerca de código aberta até o fim, anotação repetida ou depois do primeiro passo.
 *
 * O núcleo lê publicação nos trechos de `publicacao` dentro do texto da tarefa, e
 * sensibilidade nos Outputs que casam `caminhosProtegidos`. A anotação vira um token
 * próprio em cada lado (`MARCA_PUBLICACAO` num campo, `MARCA_SENSIVEL` nos Outputs),
 * que nenhum caminho de arquivo casa: a regra do núcleo segue a mesma.
 *
 * O brief da operária é este arquivo como CLI: `node superpowers.mjs brief --plano
 * <arquivo> T<n> --nonce <x> --ref <ref>` — o contrato da operária (o mesmo modelo
 * do `task-brief.mjs`) à frente do bloco da tarefa, verbatim, e das seções
 * "Restrições globais" e "Foco de revisão" do plano.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESTE = fileURLToPath(import.meta.url);
const CONTRATO_OPERARIA = path.resolve(path.dirname(ESTE), "..", "..", "..", "skills", "conducao", "references", "brief-operaria.md");

export const MARCA_PUBLICACAO = "altair:publicacao";
export const MARCA_SENSIVEL = "altair:sensivel";
export const A_PERGUNTAR = "sem anotação — a perguntar";

// `maestra` é o nome antigo de `condutora` (D-VEGA26-21): aceito e lido normalizado.
const ESTACOES = Object.freeze(["servidor", "workstation", "condutora", "maestra"]);
const ESTACOES_LEGADAS = Object.freeze({ maestra: "condutora" });
const OBRIGATORIAS = Object.freeze(["Estação", "Publicação", "Sensível"]);
const PASTAS = Object.freeze(["docs/planos/", "docs/superpowers/plans/"]);

const CERCA_RE = /^\s*(`{3,}|~{3,})/;
const TAREFA_RE = /^###\s+(?:Tarefa|Task)\s+(\d{1,3})(?:\s*[:—–-]\s*(.*?))?\s*$/;
/** Heading que parece tarefa: o que não casa `TAREFA_RE` vai a perguntar, nunca some. */
const PARECE_TAREFA_RE = /^#{1,6}\s*(?:Tarefa|Task)\b/i;
const SECAO_RE = /^#{1,3}\s/;
/** Cabeçalho de fase: `## Fase <id>`, com título opcional depois de `—`, `–`, `:` ou `-`. */
const FASE_CAB_RE = /^##\s+Fase\s+([^\s:—–]+)(?:\s*[:—–-]\s.*)?$/;
/** Heading que parece fase: o que não casa `FASE_CAB_RE` vai a perguntar, nunca some. */
const PARECE_FASE_RE = /^#{1,6}\s*Fase\s+F\d/i;
const ANOTACAO_RE = /^\s*(?:[-*]\s+)?\*\*([^*:]+):\*\*\s*(.*?)\s*$/;
const ARQUIVO_RE = /^\s*[-*]\s+[^:`]+:\s*(.*)$/;
const PASSO_RE = /^\s*[-*]\s+\[[ xX]\]\s+\*\*(?:Passo|Step)\b/;
const COMMIT_RE = /\bgit\s+commit\b[^\n]*?\s-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;
const PRAZO_RE = /^([1-9]\d*) min$/;
const LARGURA_RE = /^[1-9]\d*$/;
const FASE_RE = /^F\d{1,2}$/;
const MARCA_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Valor da anotação: sem crase e sem ponto final; o que vier depois de ` — ` é motivo,
 * mas só fora da crase (`\`echo a — b\`` fica inteiro).
 */
function valor(bruto) {
  const s = String(bruto ?? "").trim();
  const crase = /^`([^`]*)`(?:\s+—\s+.*)?\.?$/.exec(s);
  if (crase) return crase[1].trim();
  return s.replace(/\s+—\s+.*$/, "").replace(/\.$/, "").trim();
}

/** As chaves de anotação que o adaptador lê; `Estacao` e `estação` são `Estação`. */
const CHAVES = Object.freeze(["Estação", "Publicação", "Sensível", "Verificação", "Verificação pós-merge", "Verificação vence", "Empurra no meio", "Marcas", "Independente", "Prazo", "Commit", "Tier", "Arquivos", "Files"]);
const semAcento = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const PELA_FORMA = new Map(CHAVES.map((c) => [semAcento(c), c]));
function chave(campo) {
  return PELA_FORMA.get(semAcento(campo)) ?? null;
}

/** `sim`/`não` (com ou sem acento); qualquer outro valor ⇒ `undefined`. */
function simOuNao(v) {
  const x = v.toLowerCase();
  if (x === "sim") return true;
  if (x === "não" || x === "nao") return false;
  return undefined;
}

/**
 * Linhas com a marca de dentro-de-bloco-de-código; a cerca conta como dentro. A cerca
 * fecha só com o mesmo caractere e pelo menos o mesmo comprimento (CommonMark);
 * `cercaAberta` diz que o arquivo acabou dentro de um bloco.
 */
function linhasDo(texto) {
  let aberta = null;
  const L = String(texto ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((linha) => {
      const m = CERCA_RE.exec(linha);
      if (aberta) {
        if (m && m[1][0] === aberta[0] && m[1].length >= aberta.length && linha.trim() === m[1]) aberta = null;
        return { linha, codigo: true };
      }
      if (m) aberta = m[1];
      return { linha, codigo: Boolean(m) };
    });
  L.cercaAberta = aberta !== null;
  return L;
}

/** Caminhos entre crases, sem a faixa de linhas (`src/app.ts:12-30` ⇒ `src/app.ts`). */
function caminhos(texto) {
  return [...texto.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim().replace(/:\d+(?:-\d+)?$/, "")).filter((c) => c && !/\s/.test(c));
}

/** Topo, blocos de tarefa (linhas `[inicio, fim)`), cabeçalhos de fase e seções `##` do plano. */
function recortar(L) {
  const tarefas = [];
  const fases = [];
  const secoes = new Map();
  let aberta = null;
  let secao = null;
  for (const [i, { linha, codigo }] of L.entries()) {
    if (codigo || !SECAO_RE.test(linha)) continue;
    if (aberta) {
      aberta.fim = i;
      aberta = null;
    }
    const t = TAREFA_RE.exec(linha);
    if (secao && (t || /^#{1,2}\s/.test(linha))) {
      secao.fim = i;
      secao = null;
    }
    if (t) {
      aberta = { id: `T${Number(t[1])}`, titulo: t[2] ?? "", inicio: i, fim: L.length };
      tarefas.push(aberta);
    } else if (/^##\s/.test(linha)) {
      const f = FASE_CAB_RE.exec(linha.trim());
      if (f) fases.push({ id: f[1], inicio: i });
      secao = { inicio: i, fim: L.length };
      secoes.set(linha.replace(/^##\s+/, "").trim(), secao);
    }
  }
  const topo = Math.min(tarefas.length ? tarefas[0].inicio : L.length, fases.length ? fases[0].inicio : L.length);
  return { topo, tarefas, fases, secoes };
}

/**
 * Anotações de um trecho fora de tarefa, linhas `[ini, fim)`: o topo (tudo antes da
 * primeira tarefa e do primeiro cabeçalho de fase, também sob um `## Contexto`) ou o
 * trecho entre um cabeçalho de fase e a primeira tarefa dele.
 */
function lerTopo(L, ini, fim) {
  const topo = new Map();
  for (const { linha, codigo } of L.slice(ini, fim)) {
    if (codigo) continue;
    const a = ANOTACAO_RE.exec(linha);
    const campo = a && ({ fase: "Fase", modelo: "Modelo", tier: "Tier", "largura do ciclo": "Largura do ciclo" })[semAcento(a[1])];
    if (campo && !topo.has(campo)) topo.set(campo, valor(a[2]));
  }
  return topo;
}

/** Uma tarefa: anotações, arquivos, passos e o subject do commit. */
function lerTarefa(L, t) {
  const anotacoes = new Map();
  const problemas = [];
  const arquivos = [];
  const passos = [];
  let commit = null;
  let naLista = false;
  let nosPassos = false;
  for (const { linha, codigo } of L.slice(t.inicio + 1, t.fim)) {
    if (codigo) {
      naLista = false;
      if (!commit) {
        const m = COMMIT_RE.exec(linha);
        if (m) commit = (m[1] ?? m[2]).replace(/\\(.)/g, "$1");
      }
      continue;
    }
    if (PASSO_RE.test(linha)) {
      naLista = false;
      nosPassos = true;
      passos.push(linha.trim());
      continue;
    }
    if (naLista && /^\s*[-*]\s+/.test(linha)) {
      const m = ARQUIVO_RE.exec(linha.replaceAll("**", ""));
      if (m) {
        arquivos.push(...caminhos(m[1]));
        continue;
      }
    }
    const a = ANOTACAO_RE.exec(linha);
    const campo = a ? chave(a[1]) : null;
    // Anotação só antes do primeiro passo: depois dele, chave conhecida vai a perguntar
    // (o `**Esperado:**` do corpo de um passo não é chave, e segue sendo texto).
    if (campo && nosPassos) {
      problemas.push({ campo, valor: "depois do primeiro passo" });
      continue;
    }
    if (a && !nosPassos) {
      naLista = campo === "Arquivos" || campo === "Files";
      if (campo && !naLista) {
        if (anotacoes.has(campo)) problemas.push({ campo, valor: "repetida" });
        else anotacoes.set(campo, campo === "Commit" ? a[2].replace(/^`([^`]*)`$/, "$1").trim() : valor(a[2]));
      }
      continue;
    }
    if (naLista) {
      const m = ARQUIVO_RE.exec(linha);
      if (m) arquivos.push(...caminhos(m[1]));
      else if (linha.trim()) naLista = false;
    }
  }
  return { anotacoes, problemas, arquivos: [...new Set(arquivos)], passos, commit: anotacoes.get("Commit") || commit };
}

/**
 * Parse do plano no formato público: o mesmo contrato de `plano.ler` de qualquer adaptador
 * (`{ ciclo, fases, tasks, declaracoes }`), mais `declaracoes.anotacoes` (estação,
 * publicação e sensibilidade de cada tarefa, `null` quando faltam) e
 * `declaracoes.aPerguntar` (as tarefas que o núcleo pergunta antes do sim).
 */
export function lerPlanoPublico(texto) {
  const L = linhasDo(texto);
  const { topo: fimDoTopo, tarefas, fases: cabecalhos } = recortar(L);
  const topo = lerTopo(L, 0, fimDoTopo);
  const invalidas = [];
  const ausentes = [];

  if (L.cercaAberta) invalidas.push({ campo: "Bloco de código", valor: "cerca aberta até o fim do arquivo — a perguntar" });
  for (const [i, { linha, codigo }] of L.entries())
    if (!codigo && PARECE_TAREFA_RE.test(linha) && !TAREFA_RE.test(linha)) invalidas.push({ campo: "Tarefa", valor: `linha ${i + 1} fora do formato: ${linha.trim()}` });
  if (!tarefas.length) invalidas.push({ campo: "Tarefa", valor: "nenhuma tarefa no plano — a perguntar" });
  // Numeração 1..n em ordem: tarefa que um bloco de código engoliu deixa o buraco à vista.
  const furo = tarefas.findIndex((t, i) => t.id !== `T${i + 1}`);
  if (furo >= 0) invalidas.push({ campo: "Tarefa", valor: `esperada T${furo + 1}, veio ${tarefas[furo].id} — a perguntar` });

  for (const [i, { linha, codigo }] of L.entries())
    if (!codigo && PARECE_FASE_RE.test(linha) && !FASE_CAB_RE.test(linha.trim())) invalidas.push({ campo: "Fase", valor: `linha ${i + 1} fora do formato: ${linha.trim()} — a perguntar` });

  // Fases: sem cabeçalho, o arquivo é uma fase (o `**Fase:**` do topo, default F1); com
  // cabeçalho, uma por `## Fase F<n>`, na ordem do arquivo, e a tarefa é da do cabeçalho acima.
  const fases = [];
  const faseDaTarefa = (t) => {
    if (!cabecalhos.length) return fases[0].id;
    const acima = cabecalhos.filter((c) => c.inicio < t.inicio).at(-1);
    return acima ? acima.id : null;
  };
  if (!cabecalhos.length) {
    const fase = topo.get("Fase") ?? "F1";
    if (!FASE_RE.test(fase)) invalidas.push({ campo: "Fase", valor: fase });
    fases.push({ id: fase, model: topo.get("Modelo") ?? null, tier: topo.get("Tier") ?? null });
  } else {
    if (topo.has("Fase")) invalidas.push({ campo: "Fase", valor: `**Fase:** ${topo.get("Fase")} no topo junto com cabeçalho de fase — a perguntar` });
    for (const [k, c] of cabecalhos.entries()) {
      const proximo = cabecalhos[k + 1]?.inicio ?? L.length;
      const primeira = tarefas.find((t) => t.inicio > c.inicio)?.inicio ?? L.length;
      const dela = lerTopo(L, c.inicio + 1, Math.min(proximo, primeira));
      if (dela.has("Fase")) invalidas.push({ campo: "Fase", valor: `**Fase:** ${dela.get("Fase")} sob o cabeçalho ${c.id} — a perguntar` });
      if (!FASE_RE.test(c.id)) invalidas.push({ campo: "Fase", valor: `${c.id} fora da forma F<n> — a perguntar` });
      if (fases.some((f) => f.id === c.id)) {
        invalidas.push({ campo: "Fase", valor: `${c.id} repetida — a perguntar` });
        continue;
      }
      fases.push({ id: c.id, model: dela.get("Modelo") ?? topo.get("Modelo") ?? null, tier: dela.get("Tier") ?? topo.get("Tier") ?? null });
    }
  }
  let largura = 1;
  if (!topo.has("Largura do ciclo")) ausentes.push({ campo: "Largura do ciclo" });
  else if (LARGURA_RE.test(topo.get("Largura do ciclo"))) largura = Number(topo.get("Largura do ciclo"));
  else invalidas.push({ campo: "Largura do ciclo", valor: topo.get("Largura do ciclo") });

  const tasks = [];
  const porTask = new Map();
  const anotacoes = new Map();
  const aPerguntar = new Set();
  const vistos = new Set();
  for (const t of tarefas) {
    if (vistos.has(t.id)) invalidas.push({ campo: "Tarefa", valor: `${t.id} repetida`, task: t.id });
    vistos.add(t.id);
    const fase = faseDaTarefa(t);
    if (fase === null) invalidas.push({ campo: "Fase", valor: "tarefa antes do primeiro cabeçalho de fase — a perguntar", task: t.id });
    const lida = lerTarefa(L, t);
    const a = lida.anotacoes;
    for (const p of lida.problemas) invalidas.push({ ...p, task: t.id });
    if (!a.has("Verificação")) invalidas.push({ campo: "Verificação", valor: A_PERGUNTAR, task: t.id });
    else if (a.get("Verificação").includes("`")) invalidas.push({ campo: "Verificação", valor: a.get("Verificação"), task: t.id });
    if (!lida.commit) invalidas.push({ campo: "Commit", valor: "sem **Commit:** nem `git commit -m` — a perguntar", task: t.id });
    const perguntar = (campo, v) => {
      invalidas.push({ campo, valor: v, task: t.id });
      aPerguntar.add(t.id);
    };
    for (const campo of OBRIGATORIAS)
      if (!a.has(campo)) {
        ausentes.push({ campo, task: t.id });
        perguntar(campo, A_PERGUNTAR);
      }
    const estacao = a.has("Estação") && ESTACOES.includes(a.get("Estação")) ? (ESTACOES_LEGADAS[a.get("Estação")] ?? a.get("Estação")) : null;
    if (a.has("Estação") && !estacao) perguntar("Estação", a.get("Estação"));
    const lado = (campo) => {
      if (!a.has(campo)) return null;
      const v = simOuNao(a.get(campo));
      if (v === undefined) perguntar(campo, a.get(campo));
      return v ?? null;
    };
    const publicacao = lado("Publicação");
    const sensivel = lado("Sensível");
    anotacoes.set(t.id, Object.freeze({ estacao, publicacao, sensivel }));

    const d = { estacao, independente: false, verificacaoPosMerge: false, prazoMin: null };
    const opcional = (campo, aplicar) => {
      if (!a.has(campo)) return;
      if (!aplicar(a.get(campo))) invalidas.push({ campo, valor: a.get(campo), task: t.id });
    };
    opcional("Independente", (v) => v === "sim" && (d.independente = true));
    opcional("Verificação pós-merge", (v) => v === "sim" && (d.verificacaoPosMerge = true));
    // Ciclo sem ramo (hotfix vega-conducao-sem-ramo): só `sim` liga; fora disso, a perguntar.
    opcional("Empurra no meio", (v) => v === "sim" && (d.empurraNoMeio = true));
    opcional("Verificação vence", (v) => v === "sim" && (d.verificacaoVence = true));
    opcional("Prazo", (v) => PRAZO_RE.test(v) && (d.prazoMin = Number(PRAZO_RE.exec(v)[1])));
    if (estacao === "condutora" && /\bfechamento-de-fase\b/.test(a.get("Marcas") ?? ""))
      invalidas.push({ campo: "Estação", valor: `${a.get("Estação")} (fechamento de fase roda pela filha)`, task: t.id });
    porTask.set(t.id, d);

    const marcas = (a.get("Marcas") ?? "").split(/[\s,]+/).filter(Boolean);
    const foraDoVocabulario = marcas.filter((m) => !MARCA_RE.test(m));
    if (foraDoVocabulario.length) invalidas.push({ campo: "Marcas", valor: foraDoVocabulario.join(", "), task: t.id });
    const bullets = new Map();
    bullets.set("Outputs", [...lida.arquivos, ...(sensivel ? [MARCA_SENSIVEL] : [])].map((c) => `\`${c}\``).join(" · "));
    bullets.set("Steps", lida.passos.join("\n"));
    if (a.has("Verificação")) bullets.set("Verificação", `\`${a.get("Verificação")}\``);
    // Neste formato quem diz se a publicação altera o existente é `Sensível` (D18a): sem ela, aditiva.
    if (publicacao) bullets.set("Publicação", sensivel ? MARCA_PUBLICACAO : `${MARCA_PUBLICACAO} (aditiva)`);
    if (lida.commit) bullets.set("Commit", lida.commit);
    if (a.has("Tier")) bullets.set("Tier", a.get("Tier"));
    tasks.push({ id: t.id, title: t.titulo, phase: fase, bullets, satisfiesRaw: marcas.length ? `(${marcas.join(", ")})` : "" });
  }
  // Cada fase com a sua tarefa de fechamento; o plano de uma fase sem tarefa já vai a
  // perguntar por "nenhuma tarefa", e o de várias fases cobra fase a fase.
  if (tasks.length || cabecalhos.length)
    for (const f of fases)
      if (!tasks.some((t) => t.phase === f.id && /\bfechamento-de-fase\b/.test(t.satisfiesRaw)))
        invalidas.push({ campo: "Marcas", valor: `nenhuma tarefa de ${f.id} com fechamento-de-fase — a perguntar` });

  return {
    ciclo: null,
    fases,
    tasks,
    declaracoes: { largura, porTask, invalidas, ausentes, anotacoes, aPerguntar: [...aPerguntar] },
  };
}

/** O plano do ciclo: `docs/planos/<ciclo>.md` ou `docs/superpowers/plans/<ciclo>.md`. */
function casa(caminho, ciclo) {
  return PASTAS.some((p) => caminho === `${p}${ciclo}.md`);
}

// ── brief da operária ────────────────────────────────────────────────────────

/**
 * O trecho de publicação do "Nunca" do contrato (`{{PUBLICACAO}}`, D-HN29-24a):
 * os trechos que o adaptador declara em `publicacao`, entre crases; sem
 * nenhum, a publicação genérica.
 */
function textoDaPublicacao(publicacao = []) {
  const lista = [...publicacao].filter((x) => typeof x === "string" && x.trim());
  return lista.length ? `${lista.map((x) => `\`${x}\``).join(", ")} ou outra publicação` : "qualquer publicação";
}

/** O contrato da operária do modelo, com os campos trocados (a mesma regra do `task-brief.mjs`). */
function contrato(modelo, campos) {
  const m = String(modelo).match(/<!-- contrato:inicio -->\r?\n([\s\S]*?)<!-- contrato:fim -->/);
  if (!m) throw new Error("contrato da operaria sem os marcadores <!-- contrato:inicio --> / <!-- contrato:fim -->");
  for (const k of ["task", "nonce", "ref", "commit", "ciclo"])
    if (!campos[k] || (k !== "commit" && /\s/.test(campos[k]))) throw new Error(`contrato da operaria: campo ${k} ausente ou com espaco`);
  const texto = m[1]
    .replaceAll("{{TASK}}", () => campos.task)
    .replaceAll("{{NONCE}}", () => campos.nonce)
    .replaceAll("{{REF}}", () => campos.ref)
    .replaceAll("{{COMMIT}}", () => campos.commit)
    .replaceAll("{{CICLO}}", () => campos.ciclo)
    .replaceAll("{{AVISO}}", () => campos.ref.replace(/^refs\/conducao\//, "refs/conducao-aviso/"))
    .replaceAll("{{PUBLICACAO}}", () => textoDaPublicacao(campos.publicacao))
    .replace(/\s+$/, "");
  const sobra = texto.match(/\{\{[^}]*\}\}/);
  if (sobra) throw new Error(`contrato da operaria: campo ${sobra[0]} sem valor`);
  return texto;
}

/** Brief da tarefa `task` do plano em `arquivo`: contrato, bloco verbatim e as seções globais. */
export function montarBrief(arquivo, task, { nonce, ref, modelo = readFileSync(CONTRATO_OPERARIA, "utf8") }) {
  const texto = readFileSync(arquivo, "utf8");
  const L = linhasDo(texto);
  const { tarefas, secoes } = recortar(L);
  const t = tarefas.find((x) => x.id === task);
  if (!t) throw new Error(`${task} não está em ${arquivo}`);
  if (!new RegExp(`/${task}/\\d+$`).test(ref)) throw new Error(`--ref ${ref} nao e de ${task}`);
  const { commit } = lerTarefa(L, t);
  if (!commit) throw new Error(`${task} sem **Commit:** nem \`git commit -m\` no bloco — a operaria nao tem subject para commitar`);
  const ciclo = path.basename(arquivo, ".md");
  const corte = (ini, fim) => L.slice(ini, fim).map((x) => x.linha).join("\n").replace(/\s+$/, "");
  const out = [
    `# brief · ${task} · ${arquivo}`,
    "",
    // A `publicacao` deste adaptador é a marca da anotação (`MARCA_PUBLICACAO`), não um
    // verbo: o "Nunca" sai com a publicação genérica (D-HN29-24a).
    contrato(modelo, { task, nonce, ref, commit, ciclo, publicacao: [] }),
    "",
    `## tarefa (linhas ${t.inicio + 1}–${t.fim})`,
    corte(t.inicio, t.fim),
  ];
  for (const nome of ["Restrições globais", "Foco de revisão"]) {
    const s = [...secoes].find(([titulo]) => titulo.startsWith(nome))?.[1];
    if (s) out.push("", corte(s.inicio, s.fim));
  }
  return `${out.join("\n")}\n`;
}

function principal(args) {
  const [verbo, ...resto] = args;
  const flags = {};
  const posicionais = [];
  for (let i = 0; i < resto.length; i++) {
    if (["--plano", "--nonce", "--ref"].includes(resto[i])) flags[resto[i].slice(2)] = resto[++i];
    else posicionais.push(resto[i]);
  }
  if (verbo !== "brief" || !flags.plano || !flags.nonce || !flags.ref || posicionais.length !== 1) {
    process.stderr.write("uso: superpowers.mjs brief --plano <arquivo> T<n> --nonce <x> --ref refs/conducao/<ciclo>/T<n>/<k>\n");
    return 2;
  }
  try {
    process.stdout.write(montarBrief(flags.plano, posicionais[0], flags));
    return 0;
  } catch (e) {
    process.stderr.write(`superpowers: ${e.message}\n`);
    return 2;
  }
}

// ── o registro de perguntas no destino git (VEGA-19 T33, D-VEGA19-57) ──────

/**
 * O valor de `phi` que este adaptador declara: sem filtro de PHI próprio, o
 * gate do caso faz as vezes dele (D-VEGA19-46). O núcleo
 * (`conducao/consentimento.mjs`, `PHI_DO_CASO`) só o aceita de um embutido.
 */
export const PHI_DO_CASO = "gate-do-caso";

const PREFIXO_DA_SESSAO = "sessao-";
/**
 * O leitor de prova e o da declaração, carregados só quando as peças do consentimento são pedidas
 * (`consentimentoDoProjeto`): este arquivo também carrega copiado para fora do plugin (como código
 * próprio de um projeto), e só essa chamada falha lá.
 */
const requerer = createRequire(import.meta.url);
const pecasDoPlugin = () => ({ prova: requerer("../../pergunta/prova.mjs"), declaracao: requerer("../../vega/declaracao.mjs") });
const PERGUNTA_ID_RE = /^p-[0-9a-f]{16}$/;
const SESSAO_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Os eventos que o consentimento grava (abertura e resposta); o resto do registro só se lê. */
const EVENTOS_GRAVADOS = Object.freeze(["abertura", "resposta"]);
const EVENTOS_LIDOS = Object.freeze(["abertura", "resposta", "autoria", "dispensa", "previsao", "destino"]);
const VERSAO_DO_ESQUEMA = 1;
/** CPF (com ou sem pontuação) e CNS (15 dígitos), fora de palavra: a forma, nunca o valor, vai à mensagem. */
const FORMAS_DE_PACIENTE = Object.freeze([/(?<![\d.])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/, /(?<!\d)\d{3}[ .]?\d{4}[ .]?\d{4}[ .]?\d{4}(?!\d)/]);

/** As folhas de texto de um valor, com o nome de cada chave. */
function folhasDe(v) {
  if (typeof v === "string") return [v];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(folhasDe);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...folhasDe(x)]);
  return [];
}

/** A pasta do registro: a do `decisoes.arquivo` com destino `git` na declaração; null sem ela. */
export function pastaDoRegistro(repo) {
  const { declaracao } = pecasDoPlugin();
  if (!declaracao.existe(repo)) return null;
  const { decisoes } = declaracao.lerDeclaracao(repo).declaracao;
  if (decisoes?.destino !== "git" || !decisoes.arquivo) return null;
  return path.dirname(path.join(path.resolve(repo), decisoes.arquivo));
}

/**
 * Os eventos do registro (`sessao-<id>.jsonl` da pasta, em ordem de nome), na
 * forma que o destino git grava (T13): linha ilegível, evento fora da forma e
 * chave que não é a do evento (recalculada aqui) ficam fora, contados em
 * `descartadas` (sem o conteúdo). A mesma chave com conteúdo diferente (fora a
 * sessão) marca a pergunta em `divergentes`: quem a lê recusa, nunca escolhe uma.
 * A sessão da linha que não a leva vem do nome do arquivo.
 */
export function lerEventosDoRegistro(pasta) {
  const eventos = [];
  let descartadas = 0;
  let nomes = [];
  try {
    nomes = readdirSync(pasta).filter((n) => n.startsWith(PREFIXO_DA_SESSAO) && n.endsWith(".jsonl")).sort();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const porChave = new Map();
  const divergentes = new Set();
  for (const nome of nomes) {
    const sessao = nome.slice(PREFIXO_DA_SESSAO.length, -".jsonl".length);
    for (const l of readFileSync(path.join(pasta, nome), "utf8").split("\n")) {
      if (!l.trim()) continue;
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        descartadas++;
        continue;
      }
      const valido =
        o && typeof o === "object" && !Array.isArray(o) && EVENTOS_LIDOS.includes(o.evento) && PERGUNTA_ID_RE.test(o.pergunta_id ?? "") &&
        !Number.isNaN(Date.parse(o.carimbo ?? "")) && o.chave === chaveDoEvento(o);
      if (!valido) {
        descartadas++;
        continue;
      }
      const ev = o.sessao === undefined && SESSAO_RE.test(sessao) ? { ...o, sessao } : o;
      const { sessao: _s, ...conteudo } = ev;
      const json = canonico(conteudo);
      const visto = porChave.get(ev.chave);
      if (visto === undefined) {
        porChave.set(ev.chave, json);
        eventos.push(ev);
      } else if (visto !== json) divergentes.add(ev.pergunta_id);
    }
  }
  return { eventos, descartadas, divergentes };
}

/** JSON com as chaves em ordem, em todo nível: a ordem das chaves não conta como divergência. */
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonico(x))).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** A chave do evento, a mesma conta do destino git e do banco (T10, `decisoes/destino.mjs` `chaveDoEvento`). */
function chaveDoEvento(ev) {
  const sha = (...partes) => createHash("sha256").update(partes.join("|")).digest("hex");
  const p = ev.pergunta_id;
  switch (ev.evento) {
    case "abertura":
    case "resposta":
      return sha(ev.evento, p);
    case "dispensa":
      return sha("dispensa", p, ev.carimbo);
    case "autoria":
      return sha("autoria", p, ev.origem_resposta, ev.prova);
    case "previsao":
      return sha("previsao", p, ev.modelo, ev.versao_esquema ?? VERSAO_DO_ESQUEMA);
    case "destino":
      return sha("destino", p, ev.ponteiro);
    default:
      return null;
  }
}

/**
 * Grava os eventos do consentimento (abertura e resposta) no arquivo da sessão
 * de cada um, só acrescentando a chave que o arquivo ainda não tem. Confere
 * tudo antes de escrever: evento fora da forma, pergunta com dado de paciente
 * ligado ou folha com a forma de CPF/CNS lançam, nada gravado.
 */
export function gravarEventosNoRegistro(pasta, eventos) {
  if (!Array.isArray(eventos)) throw new Error("eventos: esperada lista");
  const porArquivo = new Map();
  for (const e of eventos) {
    if (!EVENTOS_GRAVADOS.includes(e?.evento)) throw new Error("evento fora do consentimento (abertura, resposta)");
    if (!PERGUNTA_ID_RE.test(e.pergunta_id ?? "")) throw new Error("evento.pergunta_id: esperado p-<16 hex>");
    if (!SESSAO_RE.test(e.sessao ?? "")) throw new Error("evento.sessao: esperado id de sessão [A-Za-z0-9_-]");
    if (Number.isNaN(Date.parse(e.carimbo ?? ""))) throw new Error("evento.carimbo: esperado data ISO");
    if (e.has_patient_data !== false && e.has_patient_data !== undefined) throw new Error("evento com dado de paciente: o registro git deste adaptador não o grava");
    const { has_patient_data: _h, chave: _c, versao_esquema: _v, evento, pergunta_id, carimbo, ...resto } = e;
    const linha = { chave: chaveDoEvento(e), versao_esquema: VERSAO_DO_ESQUEMA, evento, pergunta_id, carimbo, ...resto };
    const { chave: _k, ...varrido } = linha;
    if (folhasDe(varrido).some((t) => FORMAS_DE_PACIENTE.some((re) => re.test(t)))) throw new Error(`a pergunta ${pergunta_id} tem dado com a forma de CPF/CNS: nada gravado`);
    const arquivo = path.join(pasta, `${PREFIXO_DA_SESSAO}${e.sessao}.jsonl`);
    porArquivo.set(arquivo, [...(porArquivo.get(arquivo) ?? []), linha]);
  }
  let gravados = 0;
  let ja_existiam = 0;
  const plano = [];
  for (const [arquivo, linhas] of porArquivo) {
    const texto = existsSync(arquivo) ? readFileSync(arquivo, "utf8") : "";
    const existentes = new Set();
    for (const l of texto.split("\n")) {
      if (!l.trim()) continue;
      try {
        existentes.add(JSON.parse(l)?.chave);
      } catch {
        throw new Error(`${arquivo}: linha ilegível — conserte o arquivo antes de gravar`);
      }
    }
    const novas = linhas.filter((l) => {
      if (existentes.has(l.chave)) return (ja_existiam++, false);
      existentes.add(l.chave);
      return true;
    });
    plano.push({ arquivo, novas, semFim: texto.length > 0 && !texto.endsWith("\n") });
  }
  for (const { arquivo, novas, semFim } of plano) {
    if (novas.length === 0) continue;
    mkdirSync(path.dirname(arquivo), { recursive: true });
    appendFileSync(arquivo, (semFim ? "\n" : "") + novas.map((l) => JSON.stringify(l)).join("\n") + "\n");
    gravados += novas.length;
  }
  return { gravados, ja_existiam, enfileirados: 0 };
}

/**
 * Os eventos de `id` no registro, com as descartadas avisadas no stderr (contagem, nunca o
 * conteúdo). Pergunta com linhas divergentes lança: a leitura recusa, nunca escolhe uma.
 */
function eventosDaPergunta(pasta, id) {
  const { eventos, descartadas, divergentes } = lerEventosDoRegistro(pasta);
  if (descartadas > 0) process.stderr.write(`aviso: ${descartadas} linha(s) descartada(s) na leitura do registro git de perguntas (${pasta})\n`);
  if (divergentes.has(id)) throw new Error(`a pergunta ${id} tem linhas divergentes com a mesma chave no registro git`);
  return eventos.filter((e) => e.pergunta_id === id);
}

/**
 * As peças do consentimento deste adaptador (VEGA-19 T33, D-VEGA19-57): o
 * núcleo (`conducao/consentimento.mjs`, `pecasDoConsentimento`) chama esta
 * função, exportada fora do `default`, e recebe:
 *   — `phi`: `PHI_DO_CASO` — sem filtro de PHI próprio, o gate do caso
 *     (D-VEGA19-46): o trazer, o regravar e o herdar com caso consentido
 *     seguem passando sem perguntar;
 *   — `perguntas`: o registro de perguntas sobre o destino `git` da
 *     declaração (`decisoes.destino: "git"`), um evento por linha num arquivo
 *     por sessão (T13): `gravar(eventos)` (abertura e resposta do
 *     consentimento), `origemEfetiva(id)` e `perguntaDoAutorizar(id)`, que
 *     reconferem a `autoria` contra o transcript por `pergunta/prova.mjs`.
 *     Sem destino `git` declarado, `perguntas` sai nulo: a pergunta citada
 *     recusa por `registro-nao-declarado`.
 * Síncrona: a condução grava em série. `prova` troca o leitor nos testes.
 */
export function consentimentoDoProjeto({ repo = process.cwd(), prova = null } = {}) {
  const pasta = pastaDoRegistro(repo);
  if (!pasta) return Object.freeze({ phi: PHI_DO_CASO, perguntas: null });
  const ler = prova ?? {};
  const { prova: leitor } = pecasDoPlugin();
  // As `autoria` do turno corrente (o pareador do plugin sobre o transcript da abertura) somam aos
  // eventos lidos: o `autorizar-ciclo`/`resposta-da-maestra` no mesmo turno da resposta não espera o
  // Stop. Nada grava; `origemEfetiva` reconfere a prova delas como a das gravadas.
  // Carga e falha do pareador nunca derrubam o leitor: sem as autorias do turno, a leitura é a de
  // antes (o que está gravado), e o motivo vai ao stderr.
  const doTurno =
    ler.autoriasDoTurno ??
    ((id, eventos) => {
      try {
        const { pareador } = { pareador: requerer("../../pergunta/pareador.mjs") };
        return pareador.autoriasDoTurno(id, { eventos, ...(ler.achar ? { achar: ler.achar } : {}), ...(ler.lerEntradas ? { lerEntradas: ler.lerEntradas } : {}) });
      } catch (e) {
        process.stderr.write(`aviso: as autorias do turno de ${id} nao se leram (${String(e?.message ?? e).split("\n")[0].slice(0, 160)}); vale so o registro gravado\n`);
        return [];
      }
    });
  const daPergunta = (id) => {
    if (!PERGUNTA_ID_RE.test(id ?? "")) throw new Error("pergunta fora da forma p-<16 hex>");
    const eventos = eventosDaPergunta(pasta, id);
    return { eventos: [...eventos, ...doTurno(id, eventos)], ...ler };
  };
  return Object.freeze({
    phi: PHI_DO_CASO,
    perguntas: Object.freeze({
      destino: "git",
      gravar: (eventos) => gravarEventosNoRegistro(pasta, eventos),
      origemEfetiva: (id) => ({ ...leitor.origemEfetiva(id, daPergunta(id)), sem_registro: false }),
      perguntaDoAutorizar: (id) => ({ ...leitor.perguntaDoAutorizar(id, daPergunta(id)), sem_registro: false }),
    }),
  });
}

export default Object.freeze({
  plano: Object.freeze({
    /** Onde o núcleo procura o plano (`git ls-tree` a partir daqui). */
    raiz: "docs",
    casa,
    ler: lerPlanoPublico,
    /** Comando do brief da operária (`node <args>`): este arquivo como CLI. */
    brief: ({ canonico, task, nonce, ref }) => [ESTE, "brief", "--plano", canonico, task, "--nonce", nonce, "--ref", ref],
  }),
  /** Publicação só pela anotação: o token que `**Publicação:** sim` grava na tarefa. */
  publicacao: Object.freeze([MARCA_PUBLICACAO]),
  /** Sensibilidade só pela anotação: o token que `**Sensível:** sim` põe nos Outputs. */
  caminhosProtegidos: Object.freeze([MARCA_SENSIVEL]),
  telasProtegidasDosSteps: Object.freeze([]),
  foraDasTelasDosSteps: Object.freeze([]),
  /** O formato público não tem gate de publicação próprio: define a parada só o que o motor guarda. */
  definemAParada: Object.freeze([]),
  /** O formato público não traz carimbo de revisão nem CI da proposta. */
  carimbo: null,
  ci: null,
  marcasDeRodadas: Object.freeze([]),
});

function souACli() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(ESTE);
  } catch {
    return false;
  }
}

if (souACli()) process.exitCode = principal(process.argv.slice(2));
