#!/usr/bin/env node
/**
 * hooks-do-motor.mjs — HN-29 T8.
 *
 * Os hooks do motor (`git-guard.js`, `lean-entry-check.js`, `auto-bump-updated.js`) moram
 * NA ARVORE, em `.claude/skills/vega/motor/`. Vieram do pino `3a830a06` do plugin
 * `harness-core` 0.1.6 e mudam na fonte desde entao (HN-29 T12, T42). Este modulo e quem os lista, diz o caminho deles na arvore e
 * os executa — o papel que o resolvedor do pino tinha quando o codigo
 * vivia numa instalacao do host, com os MESMOS nomes exportados (`HOOKS_DO_NUCLEO`,
 * `caminhoDoHook`, `inventario`), para os consumidores trocarem so o caminho do import.
 *
 * Sem instalacao a resolver, nao ha pino a conferir: a versao do motor e a do commit da
 * arvore. O que fica do resolvedor e o fail-closed do `--executar`.
 *
 * ## Modos
 *
 *   --verificar             confere que os hooks do motor existem na arvore.
 *   --inventario            lista os hooks que o motor serve.
 *   --executar <hook.js>    executa o hook do motor, repassando stdin, stdout e stderr.
 *
 * ## Por que TODA recusa sai `2`, e nunca `1` (ruling de Leo, 10/09/2026)
 *
 * Os tres hooks sao registrados como `PreToolUse`/`PostToolUse` em `.claude/settings.json`,
 * e o host Claude chama este arquivo direto, sem despachante que traduza codigo em veredito.
 * Nessa posicao **so `exit 2` bloqueia**; qualquer outro nao-zero e erro nao-bloqueante e a
 * ferramenta PROSSEGUE. Entao hook ausente, `MODULE_NOT_FOUND`, sinal, ou saida que nao
 * seja 0 nem 2 viram exit 2: um exit 1 deixaria o guard desligado em silencio.
 *
 * Exit: 0 ok · 2 qualquer recusa · (`--executar` repassa 0 e 2 do hook; o resto vira 2).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Hooks do motor, alcancados pelo canal dos quatro hosts (AC-HN38-7). */
export const HOOKS_DO_NUCLEO = [
  "git-guard.js",
  "lean-entry-check.js",
  "auto-bump-updated.js",
];

/** Onde o motor mora, relativo a raiz da arvore. */
export const DIRETORIO_DO_MOTOR = join(".claude", "skills", "vega", "motor");

const ESTE = dirname(fileURLToPath(import.meta.url));
const RAIZ_PADRAO = resolve(ESTE, "..", "..", "..", "..");

/** Diretorio do motor na arvore `raiz`. */
export function diretorioDoMotor(raiz = RAIZ_PADRAO) {
  return join(resolve(raiz), DIRETORIO_DO_MOTOR);
}

/**
 * Caminho de um hook do motor na arvore. `{ caminho, diretorio }` ou `{ erro, codigo: 2 }`
 * — nunca lanca. Aceita qualquer nome de hook valido (a prova de execucao por host planta
 * um canario aqui), nao so os do nucleo.
 */
export function caminhoDoHook(nome, raiz = RAIZ_PADRAO) {
  if (typeof nome !== "string" || !/^[a-z0-9][a-z0-9._-]*\.js$/i.test(nome)) {
    return { erro: "nome de hook invalido: " + String(nome), codigo: 2 };
  }
  const diretorio = diretorioDoMotor(raiz);
  const caminho = join(diretorio, nome);
  if (!existsSync(caminho)) {
    return { erro: "hook ausente no motor da arvore: " + caminho, codigo: 2 };
  }
  return { caminho, diretorio };
}

/** Inventario do que o motor serve: `{ diretorio, hooks, skills, codigo }` ou `{ erro, codigo }`. */
export function inventario(raiz = RAIZ_PADRAO) {
  const diretorio = diretorioDoMotor(raiz);
  if (!existsSync(diretorio)) {
    return { erro: "motor ausente da arvore: " + diretorio, codigo: 2 };
  }
  const hooks = readdirSync(diretorio, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".js"))
    .map((d) => d.name)
    .sort();
  return { diretorio, hooks, skills: [], codigo: 0 };
}

/** Confere que todo hook do nucleo existe na arvore. `{ ok, codigo, faltando, diretorio }`. */
export function verificar(raiz = RAIZ_PADRAO) {
  const diretorio = diretorioDoMotor(raiz);
  const faltando = HOOKS_DO_NUCLEO.filter((n) => !existsSync(join(diretorio, n)));
  return { ok: faltando.length === 0, codigo: faltando.length === 0 ? 0 : 2, faltando, diretorio };
}

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------

function sair(codigo, linhas) {
  const canal = codigo === 0 ? process.stdout : process.stderr;
  for (const l of linhas) canal.write(l + "\n");
  process.exit(codigo);
}

function main(argv) {
  const raiz = RAIZ_PADRAO;
  const json = argv.includes("--json");

  if (argv.includes("--verificar")) {
    const v = verificar(raiz);
    if (json) {
      process.stdout.write(JSON.stringify(v, null, 2) + "\n");
      process.exit(v.codigo);
    }
    if (!v.ok) {
      sair(2, ["[hooks-do-motor] faltam na arvore (" + v.diretorio + "): " + v.faltando.join(" · ")]);
    }
    sair(0, [
      "[hooks-do-motor] " + HOOKS_DO_NUCLEO.length + " hooks do motor presentes em " + v.diretorio,
    ]);
  }

  if (argv.includes("--inventario")) {
    const inv = inventario(raiz);
    if (inv.erro) sair(inv.codigo, ["[hooks-do-motor] " + inv.erro]);
    if (json) {
      process.stdout.write(JSON.stringify(inv, null, 2) + "\n");
      process.exit(0);
    }
    sair(0, [
      "[hooks-do-motor] " + inv.diretorio,
      "  hooks (" + inv.hooks.length + "): " + (inv.hooks.join(" · ") || "(nenhum)"),
    ]);
  }

  const i = argv.indexOf("--executar");
  if (i !== -1) {
    const nome = argv[i + 1];
    if (!nome || nome.startsWith("--")) {
      sair(2, ["[hooks-do-motor] --executar exige o nome do hook."]);
    }
    const h = caminhoDoHook(nome, raiz);
    if (h.erro) sair(2, ["[hooks-do-motor] " + h.erro]);
    const r = spawnSync(process.execPath, [h.caminho], { stdio: "inherit" });
    if (r.error) sair(2, ["[hooks-do-motor] " + nome + " nao executou: " + r.error.message]);
    if (r.status === 0 || r.status === 2) process.exit(r.status);
    sair(2, [
      "[hooks-do-motor] " +
        nome +
        " saiu " +
        (r.status === null ? "por sinal " + r.signal : String(r.status)) +
        " — so 0 ou 2 sao veredito; recusa por fail-closed.",
    ]);
  }

  sair(2, ["[hooks-do-motor] uso: --verificar | --inventario | --executar <hook.js>"]);
}

if (resolve(process.argv[1] || "") === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
