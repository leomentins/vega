/**
 * versao-instalada.test.mjs — a abertura da sessão confere a fábrica instalada contra a declarada
 * (HN-29 T13, AC-HN29-7, AC-HN29-8).
 *
 * Registro do host, `installPath` e projetos são de mentira, num diretório temporário: nada lê o
 * registro da máquina. O registro diz uma versão e o `plugin.json` do `installPath` outra quando o
 * caso pede, porque o check lê os arquivos instalados (o registro mente depois da perda do cache).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PLUGINS } from "../versao-instalada.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "versao-instalada.mjs");
const CORPO = path.resolve(AQUI, "..", "..", "..");

const tmps = [];
function tmp(prefixo) {
  const d = mkdtempSync(path.join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
}
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Projeto git de mentira, com a declaração dada (ou nenhuma) e os settings dados. */
function projeto({ declaracao = null, settings = {} } = {}) {
  const repo = tmp("versao-proj-");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  if (declaracao !== null) {
    mkdirSync(path.join(repo, ".vega"));
    writeFileSync(path.join(repo, ".vega", "declaracao.json"), typeof declaracao === "string" ? declaracao : JSON.stringify(declaracao));
  }
  for (const [rel, json] of Object.entries(settings)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), JSON.stringify(json));
  }
  return repo;
}

const consumidor = (corpo, empresa) => ({ esquema: 1, papel: "consumidor", versao: { corpo, ...(empresa ? { empresa } : {}) }, decisoes: { destino: "git" } });
const FONTE = { esquema: 1, papel: "fonte", decisoes: { destino: "banco" }, listas: { corpo: ".vega/lista-corpo.txt", empresa: ".vega/lista-empresa.txt" } };

/** Um `installPath` de cache com o `plugin.json` na versão dada (`null` = cache perdido). */
function cache(nome, versao) {
  const d = path.join(tmp("versao-cache-"), nome, versao ?? "perdido");
  if (versao !== null) {
    mkdirSync(path.join(d, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(d, ".claude-plugin", "plugin.json"), JSON.stringify({ name: nome, version: versao }));
  }
  return d;
}

const entrada = (projectPath, installPath, version) => ({ scope: "project", projectPath, installPath, version, installedAt: "2026-10-30T00:00:00.000Z" });

/** Registro do host com as entradas dadas por id. */
function registro(plugins) {
  const arquivo = path.join(tmp("versao-registro-"), "installed_plugins.json");
  writeFileSync(arquivo, JSON.stringify({ version: 2, plugins }));
  return arquivo;
}

function rodar(repo, arquivo) {
  const r = spawnSync(process.execPath, [SCRIPT, "--repo", repo, "--registro", arquivo, "--json"], { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr, saida: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

const ID_CORPO = `${PLUGINS.corpo}@${PLUGINS.corpo}`;
const ID_EMPRESA = `${PLUGINS.empresa}@${PLUGINS.empresa}`;

describe("consumidor: a versão instalada é a declarada (AC-HN29-7)", () => {
  test("plugin.json instalado noutra versão, com o registro dizendo a declarada: recusa citando as duas", () => {
    const repo = projeto({ declaracao: consumidor("0.2.0") });
    const arq = registro({ [ID_CORPO]: [entrada(repo, cache(PLUGINS.corpo, "0.1.0"), "0.2.0")] });
    const r = rodar(repo, arq);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /declarada 0\.2\.0, instalada 0\.1\.0/);
    assert.match(r.stderr, /o registro diz 0\.2\.0/);
    assert.equal(r.saida.ok, false);
  });

  test("contraprova: plugin.json na versão declarada passa, mesmo com o registro dizendo outra", () => {
    const repo = projeto({ declaracao: consumidor("0.2.0") });
    const arq = registro({ [ID_CORPO]: [entrada(repo, cache(PLUGINS.corpo, "0.2.0"), "0.1.0")] });
    const r = rodar(repo, arq);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.saida.conferidas.map((c) => [c.camada, c.versao]), [["corpo", "0.2.0"]]);
  });

  test("cache perdido: o registro segue dizendo a declarada, o installPath não tem plugin.json, e recusa", () => {
    const repo = projeto({ declaracao: consumidor("0.1.0") });
    const arq = registro({ [ID_CORPO]: [entrada(repo, cache(PLUGINS.corpo, null), "0.1.0")] });
    const r = rodar(repo, arq);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /declarada 0\.1\.0, instalada ilegível: .*plugin\.json ilegível \(ENOENT\) \(o registro diz 0\.1\.0\)/);
  });

  test("sem instalação deste projeto, só a do vizinho: recusa, e o vizinho não vale por este", () => {
    const repo = projeto({ declaracao: consumidor("0.1.0") });
    const vizinho = projeto();
    const arq = registro({ [ID_CORPO]: [entrada(vizinho, cache(PLUGINS.corpo, "0.1.0"), "0.1.0")] });
    const r = rodar(repo, arq);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /declarada 0\.1\.0, nenhuma instalação deste projeto/);
  });

  test("registro ausente: recusa dizendo que está ausente", () => {
    const repo = projeto({ declaracao: consumidor("0.1.0") });
    const r = rodar(repo, path.join(tmp("versao-sem-registro-"), "installed_plugins.json"));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /nenhuma instalação deste projeto em .*\(ausente\)/);
  });

  test("camada da empresa declarada: confere as duas, e a da empresa divergente recusa", () => {
    const repo = projeto({ declaracao: consumidor("0.3.0", "1.0.0") });
    const corpo = entrada(repo, cache(PLUGINS.corpo, "0.3.0"), "0.3.0");
    const ok = rodar(repo, registro({ [ID_CORPO]: [corpo], [ID_EMPRESA]: [entrada(repo, cache(PLUGINS.empresa, "1.0.0"), "1.0.0")] }));
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(ok.saida.conferidas.map((c) => c.camada), ["corpo", "empresa"]);
    const r = rodar(repo, registro({ [ID_CORPO]: [corpo], [ID_EMPRESA]: [entrada(repo, cache(PLUGINS.empresa, "0.9.0"), "1.0.0")] }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, new RegExp(`${ID_EMPRESA} \\(empresa\\): declarada 1\\.0\\.0, instalada 0\\.9\\.0`));
  });
});

describe("consumidor: settings e caminho relativo", () => {
  test("instalação desligada nos settings do projeto não conta: a velha desligada não acusa, e só desligada recusa", () => {
    const repo = projeto({ declaracao: consumidor("0.2.0"), settings: { ".claude/settings.local.json": { enabledPlugins: { "vega@velho": false } } } });
    const ativa = entrada(repo, cache(PLUGINS.corpo, "0.2.0"), "0.2.0");
    const velha = entrada(repo, cache(PLUGINS.corpo, "0.1.0"), "0.1.0");
    assert.equal(rodar(repo, registro({ [ID_CORPO]: [ativa], "vega@velho": [velha] })).status, 0);
    const r = rodar(repo, registro({ "vega@velho": [velha] }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /nenhuma instalação deste projeto/);
  });

  test("settings do projeto ilegível recusa, em vez de virar mapa vazio calado", () => {
    const repo = projeto({ declaracao: consumidor("0.2.0") });
    mkdirSync(path.join(repo, ".claude"), { recursive: true });
    writeFileSync(path.join(repo, ".claude", "settings.json"), "{ quebrado");
    const r = rodar(repo, registro({ [ID_CORPO]: [entrada(repo, cache(PLUGINS.corpo, "0.2.0"), "0.2.0")] }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /settings\.json não é JSON/);
  });

  test("installPath relativo resolve contra a raiz do projeto, não contra o cwd", () => {
    const repo = projeto({ declaracao: consumidor("0.2.0") });
    const pasta = path.join(repo, "plug");
    mkdirSync(path.join(pasta, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(pasta, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.2.0" }));
    const r = rodar(repo, registro({ [ID_CORPO]: [entrada(repo, "plug", "0.2.0")] }));
    assert.equal(r.status, 0, r.stderr);
  });
});

describe("dois projetos no mesmo registro, cada um na sua versão (AC-HN29-8)", () => {
  test("os dois passam, e trocar as declarações faz os dois recusarem", () => {
    const a = projeto({ declaracao: consumidor("0.1.0") });
    const b = projeto({ declaracao: consumidor("0.2.0") });
    const arq = registro({ [ID_CORPO]: [entrada(a, cache(PLUGINS.corpo, "0.1.0"), "0.1.0"), entrada(b, cache(PLUGINS.corpo, "0.2.0"), "0.2.0")] });
    for (const repo of [a, b]) {
      const r = rodar(repo, arq);
      assert.equal(r.status, 0, `${repo}: ${r.stderr}`);
    }
    writeFileSync(path.join(a, ".vega", "declaracao.json"), JSON.stringify(consumidor("0.2.0")));
    writeFileSync(path.join(b, ".vega", "declaracao.json"), JSON.stringify(consumidor("0.1.0")));
    assert.match(rodar(a, arq).stderr, /declarada 0\.2\.0, instalada 0\.1\.0/);
    assert.match(rodar(b, arq).stderr, /declarada 0\.1\.0, instalada 0\.2\.0/);
  });
});

describe("fonte: nenhuma instalação da fábrica ativa no projeto (AC-HN29-7)", () => {
  test("o plugin do corpo instalado no projeto fonte: recusa", () => {
    const repo = projeto({ declaracao: FONTE });
    const r = rodar(repo, registro({ [ID_CORPO]: [entrada(repo, cache(PLUGINS.corpo, "0.1.1"), "0.1.1")] }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /é a fonte da fábrica/);
    assert.match(r.stderr, new RegExp(`${ID_CORPO} \\(corpo\\) instalado e ativo no projeto`));
  });

  test("o plugin da camada da empresa instalado no projeto fonte: recusa", () => {
    const repo = projeto({ declaracao: FONTE });
    const r = rodar(repo, registro({ [ID_EMPRESA]: [entrada(repo, cache(PLUGINS.empresa, "1.0.0"), "1.0.0")] }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /\(empresa\) instalado e ativo/);
  });

  test("contraprova: harness-core no projeto, a fábrica em outro projeto ou desligada nos settings não contam", () => {
    const vizinho = projeto();
    const repo = projeto({ declaracao: FONTE, settings: { ".claude/settings.local.json": { enabledPlugins: { [ID_EMPRESA]: false } } } });
    const arq = registro({
      "harness-core@harness-core-marketplace": [entrada(repo, cache("harness-core", "0.1.6"), "0.1.6")],
      [ID_CORPO]: [entrada(vizinho, cache(PLUGINS.corpo, "0.1.1"), "0.1.1")],
      [ID_EMPRESA]: [entrada(repo, cache(PLUGINS.empresa, "1.0.0"), "1.0.0")],
    });
    const r = rodar(repo, arq);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.saida.papel, "fonte");
  });
});

describe("declaração", () => {
  test("projeto sem .vega/declaracao.json: sai 0 calado", () => {
    const repo = projeto();
    const r = spawnSync(process.execPath, [SCRIPT, "--repo", repo, "--registro", registro({})], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  });

  test("declaração ilegível: recusa citando o arquivo", () => {
    const repo = projeto({ declaracao: "{ não é json" });
    const r = rodar(repo, registro({}));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /declaracao\.json: JSON ilegível/);
  });

  test("registro ilegível: recusa citando o registro, sem exceção crua", () => {
    const repo = projeto({ declaracao: consumidor("0.1.0") });
    const arq = path.join(tmp("versao-registro-ruim-"), "installed_plugins.json");
    writeFileSync(arq, "{ quebrado");
    const r = rodar(repo, arq);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /registro do host não é JSON/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
});

describe("ligação na abertura da sessão", () => {
  const comandos = (json) => (json.hooks?.SessionStart ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);

  test("o hooks.json do corpo liga o check no SessionStart, pela raiz do plugin", () => {
    const hooks = JSON.parse(readFileSync(path.join(CORPO, "hooks", "hooks.json"), "utf8"));
    assert.ok(comandos(hooks).some((c) => c.includes("${CLAUDE_PLUGIN_ROOT}/scripts/vega/versao-instalada.mjs")), JSON.stringify(comandos(hooks)));
  });
});
