/**
 * consentimento.test.mjs — os casos que o operador já decidiu (VEGA-37 T19, AC-VEGA37-5).
 *
 * Puro onde dá (decisão do `trazer` e do re-plano); a marca no git é exercitada
 * num repositório temporário, com um gate de teste injetado (o contrato de
 * `gravarConsentimento` é a injeção). O caso "sim com PHI é recusado", que só
 * prova com o gate real do projeto, mora nas suítes do projeto (D-VEGA37-33):
 * a suíte do plugin roda fora da fonte, sem arquivo do projeto.
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as c from "../consentimento.mjs";
import { ErroPlano, casaAlgum } from "../ler-plano.mjs";
import { caminhosDoIntervalo } from "../git-conducao.mjs";
import { decidirNoTrazer, motivosParaPerguntar } from "../verbos.mjs";
import { regraAutorizarFase, regraReplano } from "../regras.mjs";
import { pastaTemporaria } from "../../testes/pasta-temporaria.mjs";

// Gate de teste do próprio plugin: recusa um padrão fixo de documento, na forma
// `{ recusar, mensagem }` que `gravarConsentimento` espera do gate injetado.
const DOCUMENTO = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
const phiDoProjeto = (entrada) => (DOCUMENTO.test(entrada.corpo ?? "") ? { recusar: true, mensagem: "documento no sim" } : { recusar: false });

const CODIGO = { caminhosProtegidos: [], telasProtegidasDosSteps: [], foraDasTelasDosSteps: [], alcanceDosHooks: [], definemAParada: ["**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"] };
const alcance = (caminhos, globs) => caminhos.filter((x) => casaAlgum(x, globs));
const MOTOR = ".claude/skills/vega/scripts/conducao";
const CANONICO = ".agents/ciclo/vega/X-1/canonico.md";
const trazer = (caminhos, outputs, extra = {}) => decidirNoTrazer({ caminhos, canonico: CANONICO, outputs, alcance, codigo: CODIGO, ...extra });

function repo() {
  const dir = pastaTemporaria("consentimento-");
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("config", "core.hooksPath", "/dev/null");
  g("commit", "-q", "--allow-empty", "-m", "raiz");
  return { dir, g };
}

const RESPOSTA = { ciclo: "X-1", fase: "F3", caso: c.CASOS.respostaDoOperador, quem: "operador", quando: "2026-11-14T12:00:00Z", sim: "sim, pode trazer", tipo: "trazer", motivo: "alcance-dos-hooks" };
// alcance dos hooks pelo adaptador, para a repetição exercer um motivo que repete (D-VEGA37-40)
const HOOKS = { ...CODIGO, alcanceDosHooks: [".claude/**"] };
const HOOK_COMUM = ".claude/hooks/x.js";

test("pergunta repetida do mesmo tipo segue sem perguntar e registra", () => {
  const { dir } = repo();
  try {
    const gravado = c.gravarConsentimento({ repo: dir, registro: RESPOSTA, phi: phiDoProjeto, cerca: () => {} });
    const lidos = c.lerConsentimentos(dir, { ciclo: "X-1" });
    assert.equal(lidos.length, 1);
    assert.equal(lidos[0].sha, gravado.sha);
    assert.equal(lidos[0].sim, "sim, pode trazer");
    // D-VEGA20-26: o trazer não para pelo hook, e não há o que repetir nele; a regra da repetição segue
    assert.deepEqual(trazer([HOOK_COMUM], [], { codigo: HOOKS, consentimentos: lidos, ciclo: "X-1", fase: "F3" }).motivos, []);
    const repete = (consentimentos, fase) => c.seguePorRepeticao({ consentimentos, ciclo: "X-1", fase, tipo: "trazer", motivo: "alcance-dos-hooks", caminhos: [HOOK_COMUM] });
    // tipo novo na fase: sobe uma vez
    assert.equal(repete([], "F3"), null);
    // mesmo tipo e motivo já respondido: segue e registra o caso com o sim de origem
    const origem = repete(lidos, "F3");
    const caso = { caso: c.CASOS.perguntaRepetida, motivo: "alcance-dos-hooks", origem: origem.sha, sim: origem.sim, quem: origem.quem };
    assert.equal(caso.origem, gravado.sha);
    const reg = c.gravarConsentimento({
      repo: dir,
      registro: { ciclo: "X-1", fase: "F3", caso: caso.caso, quem: caso.quem, quando: "2026-11-14T13:00:00Z", sim: caso.sim, tipo: "trazer", motivo: caso.motivo, origem: caso.origem },
      phi: phiDoProjeto,
      cerca: () => {},
    });
    const depois = c.lerConsentimentos(dir);
    assert.equal(depois.at(-1).sha, reg.sha);
    assert.equal(depois.at(-1).caso, c.CASOS.perguntaRepetida);
    assert.equal(depois.at(-1).sim, "sim, pode trazer");
    // em outra fase, o mesmo motivo volta a perguntar
    assert.equal(repete(lidos, "F4"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pergunta repetida com caminho que sempre pergunta segue perguntando", () => {
  const motivo = "alcance-dos-hooks";
  const respondida = { ...RESPOSTA, sha: "b".repeat(40), motivo };
  const pergunta = (caminhos) => c.seguePorRepeticao({ consentimentos: [respondida], ciclo: "X-1", fase: "F3", tipo: "trazer", motivo, caminhos });
  // controle: caminho comum, mesmo tipo e motivo já respondidos ⇒ segue
  assert.equal(pergunta([`${MOTOR}/verbos.mjs`])?.sha, respondida.sha);
  for (const caminho of [
    ".claude/settings.json",
    ".claude/settings.local.json",
    "package.json",
    "apps/x/package.json",
    "pnpm-lock.yaml",
    ".husky/pre-commit",
    ".husky/_/pre-push",
    ".claude/state/scratch-path-guard-mode",
    ".claude/hooks/vigia-de-fora-mode",
    ".claude/scripts/estacao/linux/instalar-vigia-de-fora.sh",
    ".claude/skills/vega/hooks/lib/sessao-operaria.js",
  ]) {
    assert.equal(pergunta([`${MOTOR}/verbos.mjs`, caminho]), null, caminho);
  }
  // pelo `trazer` (D-VEGA20-26): settings que não registra o gate não para, nem por repetição; vai ao relato
  const hooks = { ...CODIGO, alcanceDosHooks: [".claude/**"] };
  const comSettings = trazer([".claude/hooks/x.js", ".claude/settings.json"], [], { codigo: hooks, consentimentos: [respondida], ciclo: "X-1", fase: "F3" });
  assert.deepEqual(comSettings.motivos, []);
  assert.deepEqual(comSettings.foraDosOutputs, [".claude/hooks/x.js", ".claude/settings.json"]);
  assert.ok(!comSettings.consentidos.some((x) => x.caso === c.CASOS.perguntaRepetida));
});

test("repetição sem caminhos pergunta", () => {
  const motivo = "alcance-dos-hooks";
  const respondida = { ...RESPOSTA, sha: "c".repeat(40), motivo };
  const base = { consentimentos: [respondida], ciclo: "X-1", fase: "F3", tipo: "trazer", motivo };
  // controle: com a lista (mesmo vazia), o mesmo tipo e motivo já respondidos seguem
  assert.equal(c.seguePorRepeticao({ ...base, caminhos: [`${MOTOR}/verbos.mjs`] })?.sha, respondida.sha);
  assert.equal(c.seguePorRepeticao({ ...base, caminhos: [] })?.sha, respondida.sha);
  // sem a lista, ou com não-lista: pergunta, nunca repete sem conferir
  for (const caminhos of [undefined, null, "x.mjs", { 0: "x.mjs" }]) {
    assert.equal(c.seguePorRepeticao({ ...base, caminhos }), null, String(caminhos));
  }
  assert.equal(c.seguePorRepeticao(base), null, "caminhos ausente");
});

test("motivo de integridade nunca segue por repetição", () => {
  for (const motivo of c.MOTIVOS_DE_INTEGRIDADE) {
    const respondida = { ...RESPOSTA, sha: "a".repeat(40), motivo };
    assert.equal(c.seguePorRepeticao({ consentimentos: [respondida], ciclo: "X-1", fase: "F3", tipo: "trazer", motivo }), null, motivo);
  }
  // publicação também nunca entra
  const pub = { ...RESPOSTA, tipo: "publicacao", motivo: "publicar" };
  assert.equal(c.seguePorRepeticao({ consentimentos: [pub], ciclo: "X-1", fase: "F3", tipo: "publicacao", motivo: "publicar" }), null);
  assert.equal(c.seguePorRepeticao({ consentimentos: [{ ...RESPOSTA, tipo: "task-sensivel" }], ciclo: "X-1", fase: "F3", tipo: "task-sensivel", motivo: RESPOSTA.motivo }), null);
});

test("publicação do ciclo vale só no ciclo em que foi gravada", () => {
  const pub = (ciclo, sim, origem) => ({ ...c.casoResolvido({ ciclo, fase: "F3", caso: c.CASOS.publicacaoDoCiclo, quem: "operador", quando: "2026-11-14T12:00:00Z", sim, task: "T1", tipo: "publicacao", origem }), sha: origem.replace(/a/g, "b") });
  const primeira = pub("X-1", "pode publicar", "a".repeat(40));
  const segunda = pub("X-1", "outra", "c".repeat(40));
  const resposta = { ...RESPOSTA, sha: "d".repeat(40) };
  assert.equal(c.simDaPublicacaoDoCiclo({ consentimentos: [resposta, primeira, segunda], ciclo: "X-1" }), primeira);
  assert.equal(c.simDaPublicacaoDoCiclo({ consentimentos: [primeira, segunda], ciclo: "X-2" }), null);
  assert.equal(c.simDaPublicacaoDoCiclo({ consentimentos: [resposta], ciclo: "X-1" }), null);
  assert.equal(c.simDaPublicacaoDoCiclo({ ciclo: "X-1" }), null);
  // A publicação segue fora da repetição: o caso próprio não vira pergunta repetida.
  assert.equal(c.seguePorRepeticao({ consentimentos: [primeira], ciclo: "X-1", fase: "F3", tipo: "publicacao", motivo: "publicar", caminhos: [] }), null);

  // O gate só aceita o sim que está no corpo da conferência publicada, no git.
  const gate = c.gateDaConferenciaPublicada("Publicada com o sim do operador: pode publicar\n\nConferida pelo operador: sim");
  assert.deepEqual(gate({ corpo: "pode publicar" }), { recusar: false });
  assert.deepEqual(c.gateDaConferenciaPublicada("Publicada com o sim do operador: pode publicar")({ corpo: "pode publicar" }), { recusar: false });
  for (const corpo of ["pode", "pode publicar tudo", "outro sim", "", undefined]) assert.equal(gate({ corpo }).recusar, true, String(corpo));
  assert.equal(c.gateDaConferenciaPublicada("Sem publicação: pode publicar")({ corpo: "pode publicar" }).recusar, true);
  assert.throws(() => c.gateDaConferenciaPublicada(""), (e) => e instanceof ErroPlano && e.codigo === "origem-sem-sim");
});

test("superfície de instrução declarada em Outputs segue sem perguntar", () => {
  const skill = ".claude/skills/vega/skills/conducao/SKILL.md";
  const hook = ".claude/hooks/lib/fase.js";
  // D-VEGA20-26: declarada, segue sem caso a gravar; fora dos Outputs, também segue, e vai ao relato
  const r = trazer([skill, hook], [skill, hook]);
  assert.deepEqual([r.motivos, r.consentidos, r.foraDosOutputs], [[], [], []]);
  assert.deepEqual(motivosParaPerguntar({ caminhos: [skill], canonico: CANONICO, outputs: [], codigo: CODIGO }), []);
  assert.deepEqual(trazer([skill], []).foraDosOutputs, [skill]);
});

test("settings declarado em Outputs ainda pergunta", () => {
  // D-VEGA20-26: no trazer, o settings só pergunta quando o diff registra o gate de publicação
  // (`define-a-parada`); o resto segue sem caso. Na repetição, todos seguem perguntando.
  for (const p of [".claude/settings.json", ".claude/settings.local.json", ".claude/state/vigia-de-fora-mode", "package.json", ".claude/skills/vega/hooks/lib/sessao-operaria.js", ".claude/scripts/estacao/linux/instalar-vigia-de-fora.sh"]) {
    const r = trazer([p], [p]);
    assert.deepEqual([r.motivos, r.consentidos], [[], []], p);
    const respondida = { ...RESPOSTA, sha: "d".repeat(40) };
    assert.equal(c.seguePorRepeticao({ consentimentos: [respondida], ciclo: "X-1", fase: "F3", tipo: "trazer", motivo: RESPOSTA.motivo, caminhos: [p] }), null, p);
  }
  for (const p of [".claude/settings.json", ".claude/settings.local.json"])
    assert.deepEqual(trazer([p], [p], { registraAParada: () => true }).motivos, [{ motivo: "define-a-parada", caminhos: [p] }], p);
});

// O caminho segue nas listas de quem lê fora do trazer e nunca segue por
// repetição (o mesmo motivo já respondido na fase não o dispensa). No trazer
// (D-VEGA20-26), declarado ou não, só para o que define a parada de publicação;
// o resto vai ao relato, sem caso a gravar.
/** O que define a parada no trazer deste teste, literal: o do motor e o de `CODIGO.definemAParada`. */
const DEFINEM_NO_TRAZER = [".vega/**", ".altair/**", "**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"];
function seguePerguntando(p) {
  assert.ok(casaAlgum(p, c.SEGUEM_PERGUNTANDO), `${p} fora de SEGUEM_PERGUNTANDO`);
  assert.ok(casaAlgum(p, c.NUNCA_REPETEM_POR_CAMINHO), `${p} fora de NUNCA_REPETEM_POR_CAMINHO`);
  const esperado = casaAlgum(p, DEFINEM_NO_TRAZER) ? [{ motivo: "define-a-parada", caminhos: [p] }] : [];
  const r = trazer([p], [p]);
  assert.deepEqual(r.motivos, esperado, `${p} no trazer`);
  assert.deepEqual(r.consentidos, [], `${p} não devia virar consentimento`);
  const motivo = esperado[0]?.motivo ?? "alcance-dos-hooks";
  const respondida = { ...RESPOSTA, sha: "d".repeat(40), motivo };
  assert.equal(c.seguePorRepeticao({ consentimentos: [respondida], ciclo: "X-1", fase: "F3", tipo: "trazer", motivo, caminhos: [p] }), null, `${p} não devia repetir`);
  const rep = trazer([p], [p], { consentimentos: [respondida], ciclo: "X-1", fase: "F3" });
  assert.deepEqual(rep.motivos, esperado, `${p} de novo no trazer`);
  assert.ok(!rep.consentidos.some((x) => x.caso === c.CASOS.perguntaRepetida), `${p} virou pergunta repetida`);
}

test("settings de pacote, mcp e guards de hook seguem perguntando no consentimento", () => {
  // D-VEGA37-40: decidem dependência, instalação ou ferramenta — sobem ao operador.
  // O guard de hook saiu desta lista por D-VEGA37-41 (caso "o que liga, desliga
  // ou registra guard segue perguntando").
  for (const p of [".npmrc", "apps/sistoli-os/.npmrc", ".pnpmfile.cjs", ".mcp.json"]) seguePerguntando(p);
  // controle: hook comum não entra na lista
  for (const p of [".claude/hooks/x.js", ".claude/hooks/lib/guard-util.js", ".claude/hooks/__tests__/scratch-path-guard.test.mjs"]) {
    assert.ok(!casaAlgum(p, c.SEGUEM_PERGUNTANDO), `${p} não devia seguir perguntando`);
  }
});

test("o que liga, desliga ou registra guard segue perguntando", () => {
  // D-VEGA37-41: por diretório e papel, nunca por nome de guard
  for (const p of [
    ".claude/hooks/lib/read-mode-file.js",
    ".claude/state/scratch-path-guard-mode",
    ".claude/skills/vega/hooks/hooks.json",
    ".husky/pre-push",
    ".github/workflows/ci.yml",
    // `.vega/**` declarado nos Outputs deixou de perguntar (D-VEGA19-32): o
    // caso está em `consentimento-padrao-da-fabrica.test.mjs`.
  ]) seguePerguntando(p);
});

test("corpo de guard segue pela conferência de quem conduz", () => {
  // D-VEGA37-41: o corpo do hook e do guard volta a quem conduz, que confere o diff
  for (const p of [".claude/hooks/x-guard.js", ".claude/skills/vega/hooks/x-gate.js"]) {
    assert.ok(!casaAlgum(p, c.SEGUEM_PERGUNTANDO), `${p} não devia seguir perguntando`);
    // D-VEGA20-26: declarado ou não, segue sem pergunta e sem caso; fora dos Outputs vai ao relato
    for (const outputs of [[p], []]) {
      const r = trazer([p], outputs);
      assert.deepEqual([r.motivos, r.consentidos, r.foraDosOutputs], [[], [], outputs.length ? [] : [p]], p);
    }
  }
});

// D-VEGA37-42: os registros saem do repositório (`git ls-files`), nunca de uma
// lista à mão. Raiz do repositório que contém o plugin; fora de um git (suíte do
// plugin rodando fora da fonte), o caso não tem o que achar e diz isso.
function raizDoRepo() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: path.dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
// D-VEGA37-44: também o registro com nome próprio sob a pasta de hooks do host
// (`.grok/hooks/sistoli-guards.json`).
const REGISTRO_RE = /(^|\/)(settings[^/]*\.json|hooks\.json)$|^\.[^/]+\/hooks\/[^/]+\.json$/;
// Comando que não é arquivo do repositório: binário de fora (o registro decide
// quando chamá-lo, e o registro já pergunta) ou `node -e` com o corpo no próprio
// registro. Muda quando um registro ganhar outro binário de fora.
const BINARIOS_DE_FORA = Object.freeze(["serena-hooks"]);
const SCRIPT_RE = /\.(c?js|mjs)$/;

function comandosDoRegistro(json) {
  const out = [];
  (function andar(o) {
    if (Array.isArray(o)) o.forEach(andar);
    // D-VEGA37-44: `commandWindows` é o mesmo comando no Windows e pode despachar outro guard
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) (k === "command" || k === "commandWindows") && typeof v === "string" ? out.push(v) : andar(v);
  })(json);
  return out;
}

// Comando registrado → { script, despacha }: o arquivo que o `node` roda
// (relativo à raiz; `${CLAUDE_PLUGIN_ROOT}` é a pasta acima de `hooks/` do
// registro do plugin) e os nomes de guard que ele recebe por argumento.
function lerComando(comando, registro) {
  // `commandWindows` separa o caminho por barra invertida: normalizar antes de ler
  const palavras = comando.replaceAll("\\", "/").match(/"[^"]*"[^\s"]*|\S+/g) ?? [];
  const limpa = (w) => w.replaceAll('"', "");
  if (BINARIOS_DE_FORA.includes(palavras[0])) return { externo: palavras[0] };
  if (palavras[0] !== "node") return { desconhecido: true };
  if (palavras[1] === "-e") return { inline: true };
  const bruto = limpa(palavras[1] ?? "");
  const plugin = path.posix.dirname(path.posix.dirname(registro));
  const script = bruto
    .replace(/^\$\{CLAUDE_PROJECT_DIR:-\$\(git rev-parse --show-toplevel\)\}\//, "")
    .replace(/^\$\(git rev-parse --show-toplevel\)\//, "")
    .replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\//, `${plugin}/`);
  if (!SCRIPT_RE.test(script) || script.includes("$")) return { desconhecido: true };
  const despacha = palavras.slice(2).map(limpa).filter((w) => SCRIPT_RE.test(w));
  return { script, despacha };
}

test("todo registro de hook e todo despachante de guard seguem perguntando", (t) => {
  const raiz = raizDoRepo();
  if (!raiz) return t.skip("fora de um repositório git: sem registros para achar");
  const arquivos = execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8" }).split("\n").filter(Boolean);
  // Corpo fora da fonte (`corpo-fora-da-fonte.test.mjs`): o repositório só tem o
  // plugin, e os registros do projeto não vêm junto. Ali o caso confere o
  // registro do próprio plugin e o casador; piso, despachante morto e guard do
  // projeto só na fonte, onde há sempre arquivo fora do plugin.
  const plugin = path.relative(raiz, path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")).split(path.sep).join("/");
  const naFonte = arquivos.some((f) => !f.startsWith(`${plugin}/`));
  const registros = arquivos.filter((f) => REGISTRO_RE.test(f));
  // piso: os registros que o ruling nomeia estão entre os achados
  const piso = naFonte
    ? [".claude/settings.json", ".claude/skills/vega/hooks/hooks.json", ".codex/hooks.json", ".cursor/hooks.json", ".grok/hooks/sistoli-guards.json"]
    : [`${plugin}/hooks/hooks.json`];
  for (const f of piso) assert.ok(registros.includes(f), `${f} não foi achado pela busca`);
  // D-VEGA37-44: o comando do Windows é lido e despacha pelo mesmo despachante
  assert.deepEqual(comandosDoRegistro({ h: [{ command: "a", commandWindows: "b" }] }), ["a", "b"]);
  assert.deepEqual(lerComando('node "$(git rev-parse --show-toplevel)\\.codex\\hooks\\run-existing-hook.mjs" x-guard.js shell', ".codex/hooks.json"), {
    script: ".codex/hooks/run-existing-hook.mjs",
    despacha: ["x-guard.js"],
  });
  const usados = new Set();
  const unicos = new Set();
  for (const f of registros) {
    seguePerguntando(f);
    const json = JSON.parse(execFileSync("git", ["show", `HEAD:${f}`], { cwd: raiz, encoding: "utf8", maxBuffer: 1 << 24 }));
    for (const comando of comandosDoRegistro(json.hooks ?? json)) {
      const r = lerComando(comando, f);
      assert.ok(!r.desconhecido, `${f}: comando que não é despachante nem guard único: ${comando}`);
      if (r.externo || r.inline) continue;
      const glob = c.DESPACHANTES_DE_GUARD.find((d) => casaAlgum(r.script, [d]));
      if (glob) {
        usados.add(glob);
        seguePerguntando(r.script);
      } else {
        // despacha outro guard pelo nome sem estar na lista ⇒ despachante novo
        assert.deepEqual(r.despacha, [], `${f}: ${r.script} despacha ${r.despacha.join(", ")} e não está em DESPACHANTES_DE_GUARD`);
        unicos.add(r.script);
      }
    }
  }
  // a lista não tem despachante morto: todo nome dela é comando de algum registro
  if (naFonte) for (const d of c.DESPACHANTES_DE_GUARD) assert.ok(usados.has(d), `${d} em DESPACHANTES_DE_GUARD sem registro que o rode`);
  // D-VEGA37-43: o glob neutro de host `.*/hooks/...` casa a pasta de todo host
  // (`.codex`, `.cursor`, `.claude`) no casador do motor, e não casa caminho sem
  // ponto nem pasta de host aninhada — senão o despachante de um host novo
  // passaria só pela conferência, e um `hooks/` qualquer perguntaria à toa.
  for (const d of c.DESPACHANTES_DE_GUARD.filter((g) => g.startsWith(".*/hooks/"))) {
    const resto = d.slice(".*/".length);
    for (const host of [".codex", ".cursor", ".claude"]) assert.ok(casaAlgum(`${host}/${resto}`, [d]), `${d} devia casar ${host}/${resto}`);
    for (const p of [resto, `codex/${resto}`, `claude/${resto}`, `x/.codex/${resto}`]) assert.ok(!casaAlgum(p, [d]), `${d} não devia casar ${p}`);
  }
  // o corpo de guard registrado segue com quem conduz (16a)
  if (naFonte) assert.ok(unicos.has(".claude/hooks/publicacao-gate.js"), "publicacao-gate.js devia estar registrado como guard único");
  for (const g of unicos) assert.ok(!casaAlgum(g, c.SEGUEM_PERGUNTANDO), `${g} é corpo de guard e não devia seguir perguntando`);
});

test("caminhos que desligam gate de segredo, revisão ou dono seguem perguntando", () => {
  // D-VEGA37-42: declarados em Outputs, ainda perguntam no `trazer` e na repetição
  for (const p of [
    ".github/scripts/gitleaks.sh",
    ".github/runner/entrypoint.sh",
    ".github/CODEOWNERS",
    ".claude/scripts/review-carimbo-ci.mjs",
    ".altair/x",
    ".claude/hooks/vigia-de-fora-mode",
    ".codex/hooks.json",
    ".cursor/hooks.json",
    ".claude/skills/vega/motor/hooks-do-motor.mjs",
    ".agents/ciclo/x/medicao/settings-base.json",
  ]) seguePerguntando(p);
  // fora do alcance e fora dos Outputs, o `trazer` não pergunta mais e põe o caminho no relato (D-VEGA20-26)
  for (const p of [".codex/hooks.json", ".github/runner/entrypoint.sh", ".agents/ciclo/x/medicao/settings-base.json"]) {
    assert.deepEqual(alcance([p], [".husky/**", ".*/hooks/**", ".*/scripts/**", ".*/state/**"]), [], `${p} devia estar fora da base do alcance`);
    const r = trazer([p], []);
    assert.deepEqual([r.motivos, r.foraDosOutputs], [[], [p]], p);
  }
  // controle: o motor de consentimento é corpo e fica com quem conduz (16a)
  for (const p of [`${MOTOR}/consentimento.mjs`, `${MOTOR}/verbos.mjs`, ".github/scripts-x/y.mjs"]) {
    assert.ok(!casaAlgum(p, c.SEGUEM_PERGUNTANDO), `${p} não devia seguir perguntando`);
  }
});

test("caminho que o git põe entre aspas segue casando a lista", () => {
  // D-VEGA37-44: o `trazer` lê os caminhos com `-z`. Mesmo com
  // `core.quotePath=false` o git cita o nome com aspas, barra invertida ou
  // caractere de controle, e o nome citado escapa de `.husky/**`.
  const nomes = [".husky/pré-push", ".github/workflows/a b.yml"];
  if (process.platform !== "win32") nomes.push('.husky/pre"push', ".github/workflows/x\ty.yml", ".husky/a\\b");
  const { dir, g } = repo();
  try {
    const base = g("rev-parse", "HEAD");
    for (const n of nomes) {
      mkdirSync(path.join(dir, path.dirname(n)), { recursive: true });
      writeFileSync(path.join(dir, n), "x\n");
    }
    g("add", "-A");
    g("commit", "-q", "-m", "nomes citados");
    const lidos = caminhosDoIntervalo(dir, base, "HEAD");
    assert.deepEqual([...lidos].sort(), [...nomes].sort());
    // contraprova: a leitura por linha devolve o nome citado, que não casa a lista
    if (process.platform !== "win32") {
      const porLinha = g("-c", "core.quotePath=false", "diff", "--name-only", base, "HEAD").split("\n");
      assert.ok(porLinha.includes('".husky/pre\\"push"'), `leitura por linha devia citar: ${porLinha.join(" | ")}`);
      assert.ok(!casaAlgum('".husky/pre\\"push"', c.SEGUEM_PERGUNTANDO));
    }
    for (const p of lidos) seguePerguntando(p);
    // D-VEGA20-26: declarados, seguem no trazer; o nome citado não escapa da lista de fora dos Outputs
    assert.deepEqual(trazer(lidos, lidos).motivos, []);
    assert.deepEqual([...trazer(lidos, []).foraDosOutputs].sort(), [...nomes].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("configuração e registro de hook de cada host seguem perguntando", () => {
  // D-VEGA37-44: declarados em Outputs, perguntam no `decidirNoTrazer` e na repetição
  for (const p of [".codex/config.toml", ".gitleaksignore", ".grok/hooks/sistoli-guards.json", ".cursor/mcp.json", "mcp.json"]) seguePerguntando(p);
  // fora do alcance e fora dos Outputs, o `trazer` não pergunta mais e põe o caminho no relato (D-VEGA20-26)
  for (const p of [".gitleaksignore", ".cursor/mcp.json"]) {
    const r = trazer([p], []);
    assert.deepEqual([r.motivos, r.foraDosOutputs], [[], [p]], p);
  }
  // controle: globs neutros de host — a configuração de produto e o json comum de hooks não entram
  for (const p of ["supabase/config.toml", "app/servico/supabase/config.toml", ".codex/hooks/lib/x.json", "apps/x/hooks/y.json", "x/.codex/config.toml"]) {
    assert.ok(!casaAlgum(p, c.SEGUEM_PERGUNTANDO), `${p} não devia seguir perguntando`);
  }
});

test("instrução de sessão declarada em Outputs segue perguntando", () => {
  // D-VEGA37-45: as instruções de sessão que o adaptador declara (`instrucoes`)
  // nunca seguem por repetição. No trazer (D-VEGA20-26) as `instrucoes` deixam
  // de ser lidas: declarada ou não, segue sem pergunta e sem caso.
  const instrucoes = ["**/CLAUDE.md"];
  const SKILL = ".claude/skills/x/SKILL.md";
  for (const p of ["CLAUDE.md", "apps/x/CLAUDE.md"]) {
    const r = trazer([p], [p]);
    assert.deepEqual([r.motivos, r.consentidos], [[], []], p);
    const respondida = { ...RESPOSTA, sha: "c".repeat(40), motivo: "superficie-de-instrucao" };
    assert.equal(
      c.seguePorRepeticao({ consentimentos: [respondida], ciclo: "X-1", fase: "F3", tipo: "trazer", motivo: "superficie-de-instrucao", caminhos: [p], instrucoes }),
      null,
      `${p} não devia repetir`,
    );
    assert.deepEqual(trazer([p], []).foraDosOutputs, [p]);
  }
  // controle: com o skill junto, nenhum dos dois pergunta
  const junto = trazer(["CLAUDE.md", SKILL], ["CLAUDE.md", SKILL]);
  assert.deepEqual([junto.motivos, junto.consentidos], [[], []]);
});

test("pergunta repetida não vale para caminho clínico nem canonico do ciclo", () => {
  const motivos = ["canonico-do-ciclo", "caminho-clinico-fora-dos-outputs", "define-a-parada"];
  assert.deepEqual([...c.MOTIVOS_QUE_NUNCA_REPETEM], motivos);
  for (const motivo of motivos) {
    const respondida = { ...RESPOSTA, sha: "e".repeat(40), motivo };
    assert.equal(c.seguePorRepeticao({ consentimentos: [respondida], ciclo: "X-1", fase: "F3", tipo: "trazer", motivo, caminhos: [] }), null, motivo);
  }
  // pelo trazer (D-VEGA20-26): o canonico não pergunta mais; vai ao relato à parte, sem repetição
  const canonico = { ...RESPOSTA, sha: "f".repeat(40), motivo: "canonico-do-ciclo" };
  const doCanonico = trazer([CANONICO], [], { consentimentos: [canonico], ciclo: "X-1", fase: "F3" });
  assert.deepEqual([doCanonico.motivos, doCanonico.consentidos, doCanonico.foraDosOutputs, doCanonico.canonicoAlterado], [[], [], [], true]);
  // pelo trazer: caminho clínico fora dos Outputs já respondido volta a perguntar
  const CLINICO = "apps/sistoli-os/src/app/laudos/page.tsx";
  const clinico = { ...RESPOSTA, sha: "9".repeat(40), motivo: "caminho-clinico-fora-dos-outputs" };
  const protegido = { ...CODIGO, caminhosProtegidos: ["apps/sistoli-os/src/app/laudos/**"] };
  const doClinico = trazer([CLINICO], [], { codigo: protegido, consentimentos: [clinico], ciclo: "X-1", fase: "F3" });
  assert.deepEqual(doClinico.motivos.map((m) => m.motivo), ["caminho-clinico-fora-dos-outputs"]);
  assert.ok(!doClinico.consentidos.some((x) => x.caso === c.CASOS.perguntaRepetida));
  // controle: motivo que repete, com a mesma resposta na fase, segue
  const hook = { ...RESPOSTA, sha: "8".repeat(40), motivo: "alcance-dos-hooks" };
  assert.equal(c.seguePorRepeticao({ consentimentos: [hook], ciclo: "X-1", fase: "F3", tipo: "trazer", motivo: "alcance-dos-hooks", caminhos: [HOOK_COMUM] })?.sha, hook.sha);
});

test("teste fora dos Outputs que acompanha o código do plano segue sem perguntar", () => {
  const codigo = `${MOTOR}/regras.mjs`;
  const teste = `${MOTOR}/__tests__/regras.test.mjs`;
  const contrato = `${MOTOR}/contrato-atual.md`;
  // D-VEGA20-26: o trazer não pergunta e não grava caso; o teste e o contrato vão ao relato
  const r = trazer([codigo, teste, contrato], [codigo]);
  assert.deepEqual([r.motivos, r.consentidos], [[], []]);
  assert.deepEqual([...r.foraDosOutputs].sort(), [contrato, teste].sort());
  // a regra do acompanhamento segue para quem a lê fora do trazer
  assert.equal(c.acompanhaOCodigo(teste, [codigo]), true);
  assert.equal(c.acompanhaOCodigo(contrato, [codigo]), true);
  // teste de outro módulo, ou sem código declarado: não acompanha, e o trazer segue sem perguntar
  const alheio = ".claude/hooks/__tests__/outro.test.mjs";
  assert.equal(c.acompanhaOCodigo(alheio, [codigo]), false);
  assert.deepEqual(trazer([alheio], [codigo]).motivos, []);
  assert.deepEqual(trazer([teste], []).motivos, []);
});

const tarefa = (id, fase, classe, extra = {}) => ({ id, fase, classe, publicacao: [], protegida: classe === "sensivel" ? ["x/**"] : [], passos: [], ...extra });
function plano(fases, tasks) {
  return { fases, porId: new Map(tasks.map((t) => [t.id, t])) };
}
function mudancas(de, para) {
  const out = [];
  for (const id of new Set([...de.porId.keys(), ...para.porId.keys()])) {
    const a = de.porId.get(id)?.classe ?? null;
    const b = para.porId.get(id)?.classe ?? null;
    if (a !== b && !(a === null && b === "comum")) out.push({ task: id, de: a, para: b });
  }
  return out;
}
function ctxReplano(de, para) {
  return {
    ciclo: "X-1",
    acao: (tipo, alvo, tentativa, campos) => ({ acao: tipo, alvo, tentativa, ...campos }),
    plano: de,
    planoHead: para,
    planoHeadBlob: "b2",
    planoBlob: "b1",
    replanos: [{ sha: "r".repeat(40), subject: "x" }],
    reconhecer: () => null,
    fase: { id: "F3", tasks: de.fases[0].tasks },
    autorizadas: new Set(["F3"]),
    daFase: true,
    cicloCobre: true,
    semMudarAlcance: true,
    ultimaAutorizacao: { sha: "u".repeat(40), herdada: null },
    autorizacaoDoCiclo: { sha: "c".repeat(40) },
    trazidas: new Map(),
    diferencaDoPlano: () => [{ task: "T3", mudou: "nasceu" }],
    mudancasQuePerguntam: mudancas,
    rulingDoReplano: () => null,
    tasksQueMudaramDeClasse: mudancas,
  };
}

test("task sensível aditiva na ordem segue sem perguntar e registra", () => {
  const de = plano([{ id: "F3", tasks: ["T1", "T2"] }], [tarefa("T1", "F3", "comum"), tarefa("T2", "F3", "comum")]);
  const para = plano([{ id: "F3", tasks: ["T1", "T3", "T2"] }], [tarefa("T1", "F3", "comum"), tarefa("T3", "F3", "sensivel"), tarefa("T2", "F3", "comum")]);
  const a = regraReplano(ctxReplano(de, para));
  assert.equal(a.acao, "herdar-autorizacao");
  assert.equal(a.consentimento.caso, c.CASOS.replanoSemMudancaDeClasse);
  assert.deepEqual(a.consentimentos.map((x) => [x.caso, x.task, x.origem]), [[c.CASOS.sensivelAditivaNaOrdem, "T3", "u".repeat(40)]]);
  // fora de ordem (as antigas trocaram de lugar): pergunta
  const trocada = plano([{ id: "F3", tasks: ["T2", "T3", "T1"] }], [tarefa("T1", "F3", "comum"), tarefa("T3", "F3", "sensivel"), tarefa("T2", "F3", "comum")]);
  assert.equal(regraReplano(ctxReplano(de, trocada)).acao, "perguntar");
  // com publicação: nunca entra
  const comPub = plano([{ id: "F3", tasks: ["T1", "T3", "T2"] }], [tarefa("T1", "F3", "comum"), tarefa("T3", "F3", "sensivel", { publicacao: ["db push"] }), tarefa("T2", "F3", "comum")]);
  assert.equal(regraReplano(ctxReplano(de, comPub)).acao, "perguntar");
});

test("herança entre fases pelo sim do ciclo registra o caso", () => {
  const p = plano([{ id: "F4", tasks: ["T9"] }], [tarefa("T9", "F4", "comum")]);
  const a = regraAutorizarFase({
    acao: (tipo, alvo, tentativa, campos) => ({ acao: tipo, ...campos }),
    plano: p,
    planoHead: p,
    planoHeadBlob: "b",
    planoBlob: "b",
    entrada: {},
    autorizadas: new Set(),
    fase: { id: "F4", tasks: ["T9"] },
    cicloCobre: true,
    replanoSoDeRuling: false,
    semMudarAlcance: true,
    autorizacaoDoCiclo: { sha: "c".repeat(40) },
    tasksQueMudaramDeClasse: () => [],
  });
  assert.equal(a.acao, "herdar-autorizacao");
  assert.deepEqual([a.consentimento.caso, a.consentimento.fase, a.consentimento.origem], [c.CASOS.herancaEntreFases, "F4", "c".repeat(40)]);
});

test("tela dos Steps segue sem perguntar e registra", () => {
  const codigo = { ...CODIGO, caminhosProtegidos: ["app/labs/**"], telasProtegidasDosSteps: ["app/labs/**"] };
  const tela = "app/labs/fila/page.tsx";
  const r = decidirNoTrazer({ caminhos: [tela], canonico: CANONICO, outputs: [], passos: ["app/labs/fila"], alcance, codigo });
  assert.deepEqual(r.motivos, []);
  assert.deepEqual(r.consentidos.map((x) => [x.caso, x.caminhos]), [[c.CASOS.telaDosSteps, [tela]]]);
});

test("marca malformada não vale como consentimento e o subject é marca da condução", () => {
  const r = c.casoResolvido(RESPOSTA);
  const m = c.mensagemDoCaso(r);
  assert.match(m.subject, /^Conducao: /);
  const bom = `${"a".repeat(40)}\x1f${m.subject}\x1f${m.corpo}\n\n${m.trailers}\x1e`;
  assert.equal(c.consentimentosDoLog(bom).length, 1);
  const semTrailer = `${"b".repeat(40)}\x1f${m.subject}\x1f${m.corpo}\x1e`;
  assert.equal(c.consentimentosDoLog(semTrailer).length, 0);
  assert.throws(() => c.casoResolvido({ ...RESPOSTA, caso: "inventado" }), (e) => e.codigo === "uso");
  assert.throws(() => c.casoResolvido({ ...RESPOSTA, sim: "  " }), (e) => e.codigo === "sim-ausente");
});
