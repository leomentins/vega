/**
 * verbos.test.mjs — a política dos verbos sem git (VEGA-29 T8).
 *
 * Exercita `verbos.mjs` com o que a casca (`git-conducao.mjs`) leria do git
 * passado como valor ou função: nenhum repositório é criado. Cada função
 * injetada que não deve ser chamada naquele caminho falha se for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErroPlano } from "../ler-plano.mjs";
import * as v from "../verbos.mjs";

const nunca = (nome) => () => assert.fail(`${nome} não devia ser chamado`);
const BASE = { ciclo: "X-1", task: "T3", tentativa: 1, nonce: "abcd1234", marcador: "m".repeat(40) };
const PONTA = "a".repeat(40);

function erro(fn, codigo) {
  assert.throws(fn, (e) => e instanceof ErroPlano && e.codigo === codigo);
}

// ── trazer ───────────────────────────────────────────────────────────────────

test("conferirPonta: aviso divergente, sem trabalho e ponta fora do marcador perguntam, na ordem", () => {
  assert.equal(v.conferirPonta({ base: BASE, ponta: PONTA, marcador: BASE.marcador, shaAvisado: "bbbbbbb", descende: nunca("descende") }).motivo, "ponta-diverge-do-aviso");
  assert.equal(v.conferirPonta({ base: BASE, ponta: BASE.marcador, marcador: BASE.marcador, shaAvisado: null, descende: nunca("descende") }).motivo, "sem-trabalho");
  assert.equal(v.conferirPonta({ base: BASE, ponta: PONTA, marcador: BASE.marcador, shaAvisado: "aaaaaaa", descende: () => null }).motivo, "ponta-nao-descende-do-marcador");
  assert.equal(v.conferirPonta({ base: BASE, ponta: PONTA, marcador: BASE.marcador, shaAvisado: null, descende: () => true }), null);
});

test("precisaDoMain: só com merge ou commit fora do caminho do marcador", () => {
  assert.equal(v.precisaDoMain({ faixa: ["c1", "c2"], caminho: new Set(["c1", "c2"]), merges: [] }), false);
  assert.equal(v.precisaDoMain({ faixa: ["c1", "c2"], caminho: new Set(["c1"]), merges: [] }), true);
  assert.equal(v.precisaDoMain({ faixa: ["c1"], caminho: new Set(["c1"]), merges: ["c1"] }), true);
});

test("conferirFaixa: commit de fora, merge alheio e marca da condução perguntam; o main é aceito", () => {
  const comum = { base: BASE, merges: [], noMain: new Set(), doMain: null, erroMain: null, paisDoMerge: nunca("paisDoMerge"), paiNoMain: nunca("paiNoMain"), subjectDe: nunca("subjectDe") };
  const fora = v.conferirFaixa({ ...comum, faixa: ["c1", "x"], caminho: new Set(["c1"]), erroMain: "rede", comMarca: nunca("comMarca") });
  assert.equal(fora.motivo, "faixa-fora-do-marcador");
  assert.deepEqual(fora.fora, ["x"]);
  assert.equal(fora.erroMain, "rede");
  // commit do main fora do caminho é aceito
  assert.equal(v.conferirFaixa({ ...comum, faixa: ["c1", "m1"], caminho: new Set(["c1"]), noMain: new Set(["m1"]), doMain: "M", comMarca: () => new Set() }), null);
  // merge sem main buscado é alheio
  const semMain = v.conferirFaixa({ ...comum, faixa: ["mg"], caminho: new Set(["mg"]), merges: ["mg"], comMarca: nunca("comMarca") });
  assert.equal(semMain.motivo, "faixa-com-merge");
  // merge cujo segundo pai não está no main é alheio; com ele no main, passa
  const pais = () => ["p2"];
  assert.equal(v.conferirFaixa({ ...comum, faixa: ["mg"], caminho: new Set(["mg"]), merges: ["mg"], doMain: "M", paisDoMerge: pais, paiNoMain: () => false, comMarca: nunca("comMarca") }).motivo, "faixa-com-merge");
  assert.equal(v.conferirFaixa({ ...comum, faixa: ["mg"], caminho: new Set(["mg"]), merges: ["mg"], doMain: "M", paisDoMerge: pais, paiNoMain: () => true, comMarca: () => new Set() }), null);
  // marca no corpo de commit da filha pergunta; do main, só se o subject é marca
  const marca = v.conferirFaixa({ ...comum, faixa: ["c1"], caminho: new Set(["c1"]), comMarca: () => new Set(["c1"]) });
  assert.equal(marca.motivo, "faixa-com-marca-da-conducao");
  assert.deepEqual(marca.marcas, ["c1"]);
  const doMainCorpo = { ...comum, faixa: ["m1"], caminho: new Set(), noMain: new Set(["m1"]), doMain: "M", comMarca: () => new Set(["m1"]) };
  assert.equal(v.conferirFaixa({ ...doMainCorpo, subjectDe: () => "fix: algo" }), null);
  assert.equal(v.conferirFaixa({ ...doMainCorpo, subjectDe: () => "Conducao: T1 conferida" }).motivo, "faixa-com-marca-da-conducao");
});

test("conferirBase: base fora do ramo e merge sem fast-forward perguntam", () => {
  assert.equal(v.conferirBase({ base: BASE, head: "H", paiMarcador: "P", baseNoRamo: null, merges: [] }).motivo, "base-do-marcador-fora-do-ramo");
  assert.equal(v.conferirBase({ base: BASE, head: "H", paiMarcador: "P", baseNoRamo: true, merges: ["mg"] }).motivo, "merge-do-main-exige-fast-forward");
  assert.equal(v.conferirBase({ base: BASE, head: "P", paiMarcador: "P", baseNoRamo: true, merges: ["mg"] }), null);
  assert.equal(v.modoDeTrazer({ head: "P", paiMarcador: "P" }), "fast-forward");
  assert.equal(v.modoDeTrazer({ head: "H", paiMarcador: "P" }), "cherry-pick");
});

test("caminhosDoDiff: sem merge é o diff cru; com merge sai só o que é mudança só do main", () => {
  assert.deepEqual(v.caminhosDoDiff({ cru: ["a", "b"], merges: [], baseComum: nunca("baseComum"), blob: nunca("blob") }), ["a", "b"]);
  // blobs: só-do-main (a), mudado pelos dois (b), devolvido a versão velha (c)
  const blobs = {
    BC: { a: "a0", b: "b0", c: "c0" },
    M: { a: "a1", b: "b1", c: "c1" },
    MK: { a: "a0", b: "bX", c: "c0" },
    PT: { a: "a1", b: "b1", c: "c0" },
  };
  const out = v.caminhosDoDiff({ cru: ["a", "b", "c"], merges: ["mg"], marcador: "MK", ponta: "PT", doMain: "M", baseComum: () => "BC", blob: (rev, p) => blobs[rev][p] ?? null });
  assert.deepEqual(out, ["b", "c"]);
  assert.deepEqual(v.comCanonico({ cru: ["a", "can.md"], caminhos: ["b"], canonico: "can.md" }), ["b", "can.md"]);
  assert.deepEqual(v.comCanonico({ cru: ["a"], caminhos: ["b"], canonico: "can.md" }), ["b"]);
});

test("decidirNoTrazer: hook, instrução e canonico vão ao relato sem pergunta; caminho clínico fora dos Outputs e o que define a parada param (D-VEGA20-26)", () => {
  const codigo = { caminhosProtegidos: ["db/migrations/**"], telasProtegidasDosSteps: [], foraDasTelasDosSteps: [], definemAParada: ["**/hooks/gate-de-publicacao.js"] };
  const d = v.decidirNoTrazer({
    caminhos: [".husky/pre-commit", "x/canonico.md", "src/ok.mjs", ".claude/hooks/x.js", "CLAUDE.md"],
    canonico: "x/canonico.md",
    outputs: ["src/ok.mjs"],
    codigo,
  });
  assert.deepEqual(d.motivos, []);
  assert.deepEqual(d.foraDosOutputs, [".husky/pre-commit", ".claude/hooks/x.js", "CLAUDE.md"]);
  assert.equal(d.canonicoAlterado, true);
  // Diretório declarado cobre o que está embaixo dele: nada fora, nada para.
  const dir = v.decidirNoTrazer({ caminhos: [".claude/hooks/x.js"], canonico: "c", outputs: [".claude/hooks/"], codigo });
  assert.deepEqual([dir.motivos, dir.foraDosOutputs, dir.canonicoAlterado], [[], [], false]);
  // Caminho clínico fora dos Outputs para; declarado, segue (o sim da fase cobre a task sensível).
  assert.deepEqual(v.motivosParaPerguntar({ caminhos: ["db/migrations/1.sql"], canonico: "c", outputs: [], codigo }), [
    { motivo: "caminho-clinico-fora-dos-outputs", caminhos: ["db/migrations/1.sql"] },
  ]);
  assert.deepEqual(v.motivosParaPerguntar({ caminhos: ["db/migrations/1.sql"], canonico: "c", outputs: ["db/migrations/1.sql"], codigo }), []);
  assert.deepEqual(v.foraDosOutputs(["d/a.ts", "e/b.ts", "f.ts"], ["d", "f.ts"]), ["e/b.ts"]);
});

test("decidirNoTrazer: o que define a parada de publicação para mesmo declarado; settings só quando o diff toca o gate (D-VEGA20-26)", () => {
  const codigo = { caminhosProtegidos: [], telasProtegidasDosSteps: [], foraDasTelasDosSteps: [], definemAParada: ["**/hooks/gate-de-publicacao.js", "**/liberacao-da-publicacao.mjs", "db/scripts/**"] };
  const daParada = [".vega/projeto.mjs", ".altair/adaptador.json", ".claude/hooks/gate-de-publicacao.js", ".claude/hooks/lib/liberacao-da-publicacao.mjs", "db/scripts/publicar.mjs"];
  const d = v.decidirNoTrazer({ caminhos: daParada, canonico: "c", outputs: daParada, codigo });
  assert.deepEqual(d.motivos, [{ motivo: "define-a-parada", caminhos: daParada }]);
  assert.deepEqual(d.foraDosOutputs, []);
  // `settings.json` que não toca o gate segue e vai ao relato; o que o registra para.
  const settings = ".claude/settings.json";
  const calado = v.decidirNoTrazer({ caminhos: [settings], canonico: "c", outputs: [], codigo, registraAParada: () => false });
  assert.deepEqual([calado.motivos, calado.foraDosOutputs], [[], [settings]]);
  const gate = v.decidirNoTrazer({ caminhos: [settings], canonico: "c", outputs: [settings], codigo, registraAParada: (c) => c === settings });
  assert.deepEqual(gate.motivos, [{ motivo: "define-a-parada", caminhos: [settings] }]);
  // O que define a parada nunca segue por repetição: o sim de antes não vale para o trazer de hoje.
  const consentimentos = [{ ciclo: "X-1", fase: "F1", tipo: "trazer", motivo: "define-a-parada", caminhos: [".vega/projeto.mjs"], sha: "a".repeat(40), sim: "sim", quem: "op" }];
  const rep = v.decidirNoTrazer({ caminhos: [".vega/projeto.mjs"], canonico: "c", outputs: [], codigo, consentimentos, ciclo: "X-1", fase: "F1" });
  assert.deepEqual(rep.motivos.map((m) => m.motivo), ["define-a-parada"]);
});

test("aprovadoConfere e exigirAprovacao: SHA inteiro, prefixo resolvido, e o porquê da recusa", () => {
  assert.equal(v.aprovadoConfere({ aprovado: PONTA, ponta: PONTA, resolver: nunca("resolver") }), true);
  assert.equal(v.aprovadoConfere({ aprovado: "aaaaaaa", ponta: PONTA, resolver: () => PONTA }), true);
  assert.equal(v.aprovadoConfere({ aprovado: "aaaaaaa", ponta: PONTA, resolver: () => null }), false);
  assert.equal(v.aprovadoConfere({ aprovado: "aaaaaa", ponta: PONTA, resolver: nunca("resolver") }), false);
  assert.equal(v.aprovadoConfere({ aprovado: null, ponta: PONTA, resolver: nunca("resolver") }), false);
  const motivos = [{ motivo: "canonico-do-ciclo", caminhos: ["c"] }];
  assert.equal(v.exigirAprovacao({ base: BASE, ponta: PONTA, aprovado: null, motivos: [], confere: nunca("confere") }), null);
  assert.equal(v.exigirAprovacao({ base: BASE, ponta: PONTA, aprovado: PONTA, motivos, confere: () => true }), null);
  assert.equal(v.exigirAprovacao({ base: BASE, ponta: PONTA, aprovado: "bbbbbbb", motivos, confere: () => false }).motivo, "aprovado-nao-confere");
  const sem = v.exigirAprovacao({ base: BASE, ponta: PONTA, aprovado: null, motivos, confere: () => false });
  assert.equal(sem.motivo, "trazer-exige-aprovacao");
  assert.equal(sem.acao, "perguntar");
  assert.equal(sem.sha, PONTA);
});

test("perguntar: acao e motivo do chamador nunca mascaram a pergunta", () => {
  assert.deepEqual(v.perguntar("m", { acao: "trazida", motivo: "x", a: 1 }), { a: 1, acao: "perguntar", motivo: "m" });
});

// ── conferir-carimbo ─────────────────────────────────────────────────────────

test("desfechoDoCarimbo: só prosa, sem cherry-picked-from, sem carimbo, veredito e carimbado", () => {
  const base = { acao: "conferir-carimbo", ...BASE };
  assert.equal(v.desfechoDoCarimbo({ base, ultimo: null, corpo: nunca("corpo"), achar: nunca("achar"), ler: nunca("ler") }).desfecho, "so-prosa");
  assert.equal(v.desfechoDoCarimbo({ base, ultimo: "c", modo: "cherry-pick", corpo: () => "corpo", achar: nunca("achar"), ler: nunca("ler") }).motivo, "trazido-sem-cherry-picked-from");
  const corpo = () => `x\n(cherry picked from commit ${"1".repeat(40)})\n(cherry picked from commit ${"2".repeat(40)})`;
  assert.equal(v.desfechoDoCarimbo({ base, ultimo: "c", modo: "cherry-pick", corpo, achar: () => null, ler: nunca("ler") }).sha, "2".repeat(40));
  assert.equal(v.desfechoDoCarimbo({ base, ultimo: "c", modo: "fast-forward", corpo: () => "", achar: () => null, ler: nunca("ler") }).motivo, "sem-carimbo");
  const reprova = v.desfechoDoCarimbo({ base, ultimo: "c", modo: "fast-forward", corpo: () => "", achar: () => "k.md", ler: () => "sha: c\nveredito: needs work\n" });
  assert.equal(reprova.motivo, "carimbo-nao-aprova");
  assert.equal(reprova.veredito, "needs work");
  const ok = v.desfechoDoCarimbo({ base, ultimo: "c", modo: "fast-forward", corpo: () => "", achar: () => "k.md", ler: () => "veredito:  aprovado, com ressalva\n" });
  assert.equal(ok.desfecho, "carimbado");
  assert.equal(ok.veredito, "aprovado, com ressalva");
  for (const t of ["verde", "PASS", "pass-with-warnings", "0 critical", "\"approved"]) assert.equal(v.vereditoAprova(t), true, t);
  for (const t of ["", "reprovado", "passa", "readyish"]) assert.equal(v.vereditoAprova(t), false, t);
});

// ── registrar-conferencia (com o modo da maestra) ────────────────────────────

const task = (campos = {}) => ({ fase: "F1", publicacao: [], estacao: "servidor", posMerge: false, marcas: [], ...campos });
/** O caso `(gate-de-ux)` como o projeto de teste o declara no adaptador (T14). */
const GATE = { marca: "gate-de-ux", arquivo: "gate-de-ux-approval.md", sim: ["SHIP", "SHIP_WITH_DEBT"], nao: ["NEEDS_REWORK"] };
const conf = (campos) => v.politicaDaConferencia({ task: "T3", verificacao: "verde", publicacao: "nao-se-aplica", approval: nunca("approval"), ...campos });

test("exigirUsoDaConferencia: task, manual com maestra e publicação fora do conjunto são uso", () => {
  erro(() => v.exigirUsoDaConferencia({ task: "X", publicacao: "feita" }), "uso");
  erro(() => v.exigirUsoDaConferencia({ task: "T1", manual: true, maestra: true, publicacao: "feita" }), "uso");
  erro(() => v.exigirUsoDaConferencia({ task: "T1", publicacao: "talvez" }), "uso");
  v.exigirUsoDaConferencia({ task: "T1", publicacao: "feita" });
});

test("politicaDaConferencia: a publicação bate com o plano, o sim vai no corpo e a dispensa no trailer", () => {
  erro(() => conf({ t: task({ publicacao: ["db push"] }) }), "publicacao-pendente");
  erro(() => conf({ t: task(), publicacao: "feita" }), "publicacao-fora-do-plano");
  erro(() => conf({ t: task({ publicacao: ["db push"] }), publicacao: "feita" }), "sim-da-publicacao-ausente");
  const dispensada = conf({ t: task({ publicacao: ["db push"] }), sim: " não publica " });
  assert.equal(dispensada.corpo, "Sem publicação: não publica");
  assert.deepEqual(dispensada.dispensa, { "Conducao-Publicacao-Dispensada": "operador" });
  const publicada = conf({ t: task({ publicacao: ["db push"] }), publicacao: "feita", sim: "pode" });
  assert.equal(publicada.corpo, "Publicada com o sim do operador: pode");
  assert.deepEqual(publicada.dispensa, {});
  // A primeira publicação do ciclo pede o registro do caso; com ele no ciclo, a seguinte fecha sem --sim (D-VEGA37-52).
  assert.deepEqual({ ...publicada.consentimento }, { caso: "publicacao-do-ciclo", fase: "F1", origem: null, task: "T3", motivo: null, tasks: [] });
  const simDoCiclo = { sim: "pode", origem: "a".repeat(40), sha: "b".repeat(40) };
  const seguinte = conf({ t: task({ publicacao: ["db push"] }), publicacao: "feita", simDoCiclo });
  assert.equal(seguinte.corpo, `Publicada com o sim do ciclo: pode (origem ${"a".repeat(40)})`);
  assert.equal(seguinte.consentimento, undefined);
  assert.equal(conf({ t: task({ publicacao: ["db push"] }), publicacao: "feita", sim: "pode", simDoCiclo }).consentimento, undefined);
  const filha = conf({ t: task() });
  assert.equal(filha.via, "filha");
  assert.equal(filha.subject, "Conducao: T3 conferida");
  assert.equal(filha.corpo, undefined);
});

test("politicaDaConferencia: manual só em workstation, com o sim", () => {
  erro(() => conf({ t: task(), manual: true, sim: "ok" }), "manual-fora-de-workstation");
  erro(() => conf({ t: task({ estacao: "workstation" }), manual: true }), "sim-ausente");
  const m = conf({ t: task({ estacao: "workstation" }), manual: true, sim: "terminou" });
  assert.equal(m.via, "manual");
  assert.equal(m.corpo, "terminou");
  assert.deepEqual(m.trailers, { "Conducao-Task": "T3", "Conducao-Verificacao": "manual", "Conducao-Publicacao": "nao-se-aplica" });
  erro(() => conf({ t: task({ estacao: "workstation" }) }), "workstation-sem-manual");
});

test("politicaDaConferencia: a Verificação segue o plano, e o approval em NEEDS_REWORK não fecha", () => {
  erro(() => conf({ t: task(), verificacao: "amarela" }), "uso");
  erro(() => conf({ t: task({ posMerge: true }) }), "verificacao-diverge-do-plano");
  assert.equal(conf({ t: task({ posMerge: true }), verificacao: "declarada-pos-merge" }).via, "filha");
  erro(() => conf({ t: task(), caso: GATE, approval: () => ({ caminho: "a.md", verdict: "NEEDS_REWORK" }) }), "approval-pede-rodada");
  assert.equal(conf({ t: task(), caso: GATE, approval: () => ({ caminho: "a.md", verdict: "SHIP" }) }).via, "filha");
});

test("politicaDaConferencia: modo da maestra só na estação maestra, com a sessão dela", () => {
  erro(() => conf({ t: task(), maestra: true, sessao: "s" }), "maestra-fora-da-estacao");
  erro(() => conf({ t: task({ estacao: "maestra" }), maestra: true }), "sessao-ausente");
  erro(() => conf({ t: task({ estacao: "maestra" }) }), "maestra-sem-flag");
  const m = conf({ t: task({ estacao: "maestra" }), maestra: true, sessao: "sess-1" });
  assert.equal(m.via, "maestra");
  assert.deepEqual(m.saida, { executor: "maestra", verificacao: "verde", publicacao: "nao-se-aplica" });
  assert.equal(m.trailers["Conducao-Executor"], "maestra");
  assert.equal(m.trailers["Conducao-Sessao-Maestra"], "sess-1");
});

test("sessaoDaFilha e trailersDaFilha: a sessão passada vence a do trazer; nenhuma é erro", () => {
  const r = { ponta: PONTA, nonce: "n1", sessao: "da-trazida" };
  assert.equal(v.sessaoDaFilha({ task: "T3", sessao: null, r }), "da-trazida");
  assert.equal(v.sessaoDaFilha({ task: "T3", sessao: "agora", r }), "agora");
  erro(() => v.sessaoDaFilha({ task: "T3", sessao: null, r: { ...r, sessao: null } }), "sessao-ausente");
  assert.deepEqual(Object.keys(v.trailersDaFilha({ task: "T3", r, sessaoFilha: "s", verificacao: "verde", publicacao: "feita" })), [
    "Conducao-Task",
    "Conducao-Sha-Filha",
    "Conducao-Sessao-Filha",
    "Conducao-Nonce",
    "Conducao-Verificacao",
    "Conducao-Publicacao",
  ]);
});

// ── rito de rodadas ──────────────────────────────────────────────────────────

test("rito de rodadas: uso, task do gate e approval que pede rodada", () => {
  erro(() => v.exigirUsoDaRodada({ task: "T3", rodada: "outra" }), "uso");
  v.exigirUsoDaRodada({ task: "T3", rodada: "carimbo" });
  erro(() => v.exigirTaskDeRodada({ task: "T3", caso: null }), "rodada-fora-da-conferencia");
  v.exigirTaskDeRodada({ task: "T3", caso: GATE, rodada: "needs-rework" });
  erro(() => v.exigirApprovalDeRodada({ caminho: "a.md", a: null, caso: GATE }), "approval-ausente");
  erro(() => v.exigirApprovalDeRodada({ caminho: "a.md", a: { verdict: "SHIP", rodada: 1 }, caso: GATE }), "approval-nao-pede-rodada");
  erro(() => v.exigirApprovalDeRodada({ caminho: "a.md", a: { verdict: "NEEDS_REWORK", rodada: Number.NaN }, caso: GATE }), "approval-rodada-invalida");
  v.exigirApprovalDeRodada({ caminho: "a.md", a: { verdict: "NEEDS_REWORK", rodada: 2 }, caso: GATE });
});

test("conferirRodada: floor(k/2)+1 contra o approval, com teto em 3 pelas marcas", () => {
  const b = { ciclo: "X-1", task: "T3" };
  assert.equal(v.conferirRodada({ base: b, anteriores: 0, rodadaDoApproval: 1, ref: "r" }), null);
  assert.equal(v.conferirRodada({ base: b, anteriores: 2, rodadaDoApproval: 2, ref: "r" }), null);
  const fora = v.conferirRodada({ base: b, anteriores: 2, rodadaDoApproval: 1, ref: "r" });
  assert.equal(fora.motivo, "approval-fora-do-rito");
  assert.equal(fora.rodadaEsperada, 2);
  assert.equal(v.conferirRodada({ base: b, anteriores: 0, rodadaDoApproval: 3, ref: "r" }).motivo, "teto-de-rodadas");
  const teto = v.conferirRodada({ base: b, anteriores: 4, rodadaDoApproval: 1, ref: "r" });
  assert.equal(teto.motivo, "teto-de-rodadas");
  assert.equal(teto.teto, v.TETO_RODADAS_GATE);
});

test("conferirRodada: a B por re-plano só destrava approval que pulou a B, e só é lida quando a regra estrita recusa", () => {
  const b = { ciclo: "X-1", task: "T3" };
  const achado = { replano: { sha: "abc", ruling: "D-X1-2", novas: ["T9"], por: "dependencia", dependidas: ["T9"] }, vistos: [] };
  let lidas = 0;
  const replanoB = () => (lidas++, achado);
  // Regra estrita passa: o git nem é lido.
  assert.equal(v.conferirRodada({ base: b, anteriores: 1, rodadaDoApproval: 1, ref: "r", replanoB }), null);
  assert.equal(lidas, 0);
  // B pendente (1 marca) e approval já na C (2): o re-plano grava a rodada.
  assert.deepEqual(v.conferirRodada({ base: b, anteriores: 1, rodadaDoApproval: 2, ref: "r", replanoB }), { acao: "gravar-rodada", replano: achado.replano });
  assert.equal(lidas, 1);
  // Sem B pendente (k par) o re-plano não afrouxa: approval que recuou segue recusando, sem ler o git.
  const recuou = v.conferirRodada({ base: b, anteriores: 2, rodadaDoApproval: 1, ref: "r", replanoB });
  assert.equal(recuou.motivo, "approval-fora-do-rito");
  assert.equal(recuou.destrava, undefined);
  // Approval no teto segue no teto, com ou sem re-plano.
  assert.equal(v.conferirRodada({ base: b, anteriores: 1, rodadaDoApproval: 3, ref: "r", replanoB }).motivo, "teto-de-rodadas");
  assert.equal(v.conferirRodada({ base: b, anteriores: 3, rodadaDoApproval: 3, ref: "r", replanoB }).motivo, "teto-de-rodadas");
  assert.equal(lidas, 1);
  // Sem re-plano achado: a recusa de sempre, com o que destravaria e o que foi visto.
  const sem = v.conferirRodada({ base: b, anteriores: 1, rodadaDoApproval: 2, ref: "r", replanoB: () => ({ replano: null, vistos: [{ sha: "s", motivo: "sem-task-nova" }], aviso: "x" }) });
  assert.equal(sem.motivo, "approval-fora-do-rito");
  assert.equal(sem.rodadaEsperada, 1);
  assert.match(sem.destrava, /T3/);
  assert.deepEqual(sem.replanosVistos, [{ sha: "s", motivo: "sem-task-nova" }]);
  assert.equal(sem.aviso, "x");
  // Sem leitor injetado: recusa igual.
  assert.equal(v.conferirRodada({ base: b, anteriores: 1, rodadaDoApproval: 2, ref: "r" }).motivo, "approval-fora-do-rito");
});

test("replanoDaRodadaB: conta o primeiro re-plano de ruling com task nova de que o gate depende, ou que cita o gate", () => {
  const C = "X-1-teste";
  const ruling = (n, resto) => `${C}-F1/D-X1-${n} — re-plano de ${resto}`;
  const c = (sha, subject, novas, depsDoGate, corpo = "") => ({ sha, subject, corpo, novas, depsDoGate });
  const r = v.replanoDaRodadaB({
    task: "T2",
    ciclo: C,
    replanos: [
      c("a", `${C}-F1/T5 — task comum`, [], []),
      c("b", ruling(1, "F1: só dependência"), [], ["T1"]),
      c("d", ruling(2, "F1: T7 sem relação, T20 também"), ["T7"], ["T1"]),
      c("e", ruling(3, "F1: consertos em T8"), ["T8", "T9"], ["T1", "T9"]),
    ],
  });
  assert.deepEqual(r.replano, { sha: "e", ruling: "D-X1-3", novas: ["T8", "T9"], por: "dependencia", dependidas: ["T9"] });
  assert.deepEqual(r.vistos, [
    { sha: "a", motivo: "nao-e-replano-de-ruling" },
    { sha: "b", ruling: "D-X1-1", motivo: "sem-task-nova" },
    { sha: "d", ruling: "D-X1-2", motivo: "T2-nao-depende-nem-e-citada" },
  ]);
  // Plano ilegível num re-plano não conta e é dito; o seguinte ainda conta.
  const ileg = v.replanoDaRodadaB({
    task: "T2",
    ciclo: C,
    replanos: [{ ...c("x", ruling(8, "F1: x"), [], []), ilegivel: "declaracao-invalida: y" }, c("z", ruling(9, "F1: x"), ["T7"], ["T7"])],
  });
  assert.equal(ileg.replano.sha, "z");
  assert.deepEqual(ileg.vistos, [{ sha: "x", ruling: "D-X1-8", motivo: "plano-ilegivel", detalhe: "declaracao-invalida: y" }]);
  // Citação no corpo vale; T20 não é T2.
  const cita = v.replanoDaRodadaB({ task: "T2", ciclo: C, replanos: [c("f", ruling(4, "F1: x"), ["T7"], [], "A rodada B da T2 sai na T7.")] });
  assert.equal(cita.replano.por, "citacao");
  const t20 = v.replanoDaRodadaB({ task: "T2", ciclo: C, replanos: [c("g", ruling(5, "F1: T20 e T21"), ["T7"], [])] });
  assert.equal(t20.replano, null);
  // Re-plano de outro ciclo, ou com o reconhecedor desligado (contraprova), não conta.
  assert.equal(v.replanoDaRodadaB({ task: "T2", ciclo: "Y-2-outro", replanos: [c("h", ruling(6, "F1: x"), ["T7"], ["T7"])] }).replano, null);
  assert.equal(v.replanoDaRodadaB({ task: "T2", ciclo: C, replanos: [c("i", ruling(7, "F1: x"), ["T7"], ["T7"])], reconhecer: () => null }).replano, null);
});

test("rodadasDasMarcas: a marca da B por re-plano conta duas; trailer da B só quando há re-plano", () => {
  assert.equal(v.rodadasDasMarcas([]), 0);
  assert.equal(v.rodadasDasMarcas([{ sha: "a", replanoB: null }, { sha: "b", replanoB: "x" }]), 3);
  const r = { ponta: "p", nonce: "n" };
  assert.equal(v.trailersDaRodada({ task: "T1", r, sessaoFilha: "s", rodada: "nao", rodadaDoApproval: 2 })[v.TRAILER_RODADA_B_REPLANO], undefined);
  assert.equal(v.trailersDaRodada({ task: "T1", r, sessaoFilha: "s", rodada: "nao", rodadaDoApproval: 2, replanoB: { sha: "x" } })[v.TRAILER_RODADA_B_REPLANO], "x");
});

test("lerApproval: verdict e rodada do frontmatter, rodada ausente conta 1", () => {
  assert.deepEqual(v.lerApproval("---\nverdict: NEEDS_REWORK\nrodada: 2\n---\n"), { verdict: "NEEDS_REWORK", rodada: 2 });
  assert.deepEqual(v.lerApproval("---\nverdict: \"SHIP\"\n---"), { verdict: "SHIP", rodada: 1 });
  assert.ok(Number.isNaN(v.lerApproval("---\nverdict: SHIP\nrodada: 0\n---\n").rodada));
  assert.deepEqual(v.lerApproval("sem frontmatter"), { verdict: null, rodada: null });
});

test("carimbosDaFaixa: só carimbo acrescentado ou alterado nos dois destinos; o resto recusa", () => {
  const notas = ".agents/ciclo/x/X-1/revisoes/";
  const mud = v.mudancasDoLog(`A\t${notas}abcdef12.md\nM\t.projeto/state/revisoes/0123abcd.md\n\nA\t${notas}abcdef12.md\n`);
  assert.deepEqual(v.carimbosDaFaixa({ task: "T3", tentativa: 2, mudancas: mud, notas }), [`${notas}abcdef12.md`, ".projeto/state/revisoes/0123abcd.md"]);
  erro(() => v.carimbosDaFaixa({ task: "T3", tentativa: 2, mudancas: [{ status: "D", caminho: `${notas}abcdef12.md` }], notas }), "rodada-carimbo-fora-do-carimbo");
  erro(() => v.carimbosDaFaixa({ task: "T3", tentativa: 2, mudancas: [{ status: "A", caminho: "src/a.mjs" }], notas }), "rodada-carimbo-fora-do-carimbo");
  erro(() => v.carimbosDaFaixa({ task: "T3", tentativa: 2, mudancas: [{ status: "A", caminho: `${notas}nao-e-sha.md` }], notas }), "rodada-carimbo-fora-do-carimbo");
  erro(() => v.carimbosDaFaixa({ task: "T3", tentativa: 2, mudancas: [], notas }), "rodada-carimbo-sem-carimbo");
  erro(() => v.exigirCarimboDoConserto({ carimbos: ["k.md"], conserto: null, cobre: null }), "rodada-carimbo-nao-cobre-o-conserto");
  v.exigirCarimboDoConserto({ carimbos: ["k.md"], conserto: "c", cobre: "k.md" });
  const tr = v.trailersDaRodada({ task: "T3", r: { ponta: PONTA, nonce: "n" }, sessaoFilha: "s", rodada: "carimbo", rodadaDoApproval: 2 });
  assert.equal(tr["Conducao-Rodada"], "carimbo");
  assert.equal(tr["Conducao-Rodada-Approval"], "2");
});
