/*
 * Antaris-Guard: the config. One file, .claude/guard.config.json under the project root, and
 * nowhere else. It sits under a protected path on purpose: the session's shell cannot name it
 * (G16) and the settings deny the editing tools, so the config has the same standing as the hooks.
 *
 * Absence is refusal. No file blocks every command with G17, naming the missing file: a file git
 * can remove without naming it (checking out an older commit) must not loosen the guard. A file
 * the hook cannot read, or that is not JSON, or that fails validation, blocks every command the
 * same way. The built-in DEFAULTS are what init will write for a new repository and what the
 * defaults comparison in the tests runs on; they are never used in place of a missing file.
 *
 * The project root is CLAUDE_PROJECT_DIR when Claude Code sets it, else the cwd field of the
 * hook's stdin, else the process working directory.
 *
 * Validation is strict: version is required and must be 1, unknown keys fail, every list is a
 * list of non-empty strings, the lists behind the rules that are never off cannot be empty, the
 * rules map accepts only ids the guard has, set to "deny", "ask" or "off" (the never-off rules
 * refuse "ask" as well), and log.path must sit under
 * .claude/ or a protected folder. This version reads these keys and no others; a key a later
 * round reads (remotes, askPrograms, packs, scan, subagents) fails until that round lands, so a
 * key the guard does not act on never looks like a rule in force.
 *
 * This file is CommonJS and has no dependencies, like the hooks that load it.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { ALL } = require("./rules");

/** Where the config lives, relative to the project root. */
const FILE = path.join(".claude", "guard.config.json");

const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); return Object.freeze(o); };

/** The built-in defaults: the generic set. A repository that blocks python and pip adds them, as configs/inventaris.json does. */
const DEFAULTS = freeze({
  version: 1,
  protectedBranches: ["main", "master"],
  protectedPaths: [".claude/", "CLAUDE.md", ".mcp.json"],
  secretPaths: [".env", ".env.*", "*.pem", "*.key", "*.p12"],
  secretEnv: ["AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "DATABASE_URL", "GITHUB_TOKEN"],
  credentialPaths: ["~/.aws", "~/.ssh", "~/.config", "~/.netrc", "~/.npmrc"],
  blockedPrograms: ["sudo", "su", "curl", "wget", "ssh", "scp", "nc", "ncat", "telnet", "dd", "mkfs", "crontab", "eval", "base64", "xxd"],
  rules: {},
  log: { enabled: true, path: ".claude/guard/log.jsonl" },
});

/** The keys this version reads. Anything else fails validation. */
const KEYS = ["version", "operator", "protectedBranches", "protectedPaths", "secretPaths", "secretEnv", "credentialPaths", "blockedPrograms", "rules", "log"];
const LOG_KEYS = ["enabled", "path"];

/** The core rules that cannot be turned off (docs/SPEC.md section 4); G24 joins when it lands. */
const NEVER_OFF = ["G02", "G06", "G07", "G09", "G10", "G12", "G16", "G17"];
/** The lists those rules read: an empty one would be off by the back door. */
const NEVER_EMPTY = { protectedBranches: "G07", secretEnv: "G09", secretPaths: "G12" };
/** The rules that move to packs in a later round and stay unconditional until then. */
const PACK_BOUND = ["aws-cdk-01", "aws-cdk-02", "docker-01"];
/** What a rule can be set to: a tier, or off. A rule cannot be set to allow; off is the only way to stop it. */
const TIERS = ["deny", "ask", "off"];

const RULE_IDS = new Set(ALL.map((r) => r.id));

/** The project root: CLAUDE_PROJECT_DIR, else the hook's cwd, else the process working directory. */
function projectDir({ env = process.env, cwd } = {}) {
  if (env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
  if (cwd) return String(cwd);
  return process.cwd();
}

/** The path of the config file under a project root. */
const configPath = (dir) => path.join(dir, FILE);

/**
 * The config file's contents as parsed JSON, not yet validated, with the path it came from.
 * Throws when the file is missing, cannot be read, or is not JSON; guard.js turns that into G17.
 */
function readConfig(dir) {
  const file = configPath(dir);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") throw new Error(`${file} is missing; the operator writes it, following configs/README.md`);
    throw new Error(`${file} could not be read: ${err && err.code ? err.code : err && err.message ? err.message : String(err)}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not JSON: ${err.message}`);
  }
  return { raw, path: file };
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const quote = (v) => JSON.stringify(v);

function stringList(key, value, { nonEmpty, each } = {}) {
  if (!Array.isArray(value)) throw new Error(`${key} must be a list of strings`);
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) throw new Error(`${key} must be a list of non-empty strings`);
    if (/\s/.test(item)) throw new Error(`${key}: ${quote(item)} has whitespace in it`);
    if (each) each(item);
  }
  if (nonEmpty && value.length === 0) throw new Error(`${key} cannot be empty: ${nonEmpty} is never off`);
  return [...value];
}

/**
 * A config as the rules read it: the file's object checked against the shape above, with the
 * defaults filled in for the keys the file leaves out. Throws with a message a person acts on;
 * judge() turns that into G17 so a malformed config can never match the wrong thing in silence.
 */
function validate(raw) {
  if (raw === undefined || raw === null) throw new Error("no config was given");
  if (!isObject(raw)) throw new Error("the config must be a JSON object");
  if (raw.version !== 1) throw new Error(raw.version === undefined ? "version is required and must be 1" : "version must be 1");
  for (const key of Object.keys(raw)) if (!KEYS.includes(key)) throw new Error(`unknown key ${quote(key)}`);

  const config = { version: 1 };
  if (raw.operator !== undefined) {
    if (typeof raw.operator !== "string" || raw.operator.trim().length === 0) throw new Error("operator must be a non-empty string");
    config.operator = raw.operator;
  }
  for (const key of ["protectedBranches", "protectedPaths", "secretPaths", "secretEnv", "credentialPaths", "blockedPrograms"]) {
    if (raw[key] === undefined) { config[key] = [...DEFAULTS[key]]; continue; }
    config[key] = stringList(key, raw[key], {
      nonEmpty: NEVER_EMPTY[key],
      each: key === "secretEnv" ? (v) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new Error(`secretEnv: ${quote(v)} is not an environment variable name`); }
        : key === "secretPaths" ? (v) => { if (v.includes("/")) throw new Error(`secretPaths: ${quote(v)} is a path, not a file name pattern`); }
        : undefined,
    });
  }
  config.rules = {};
  if (raw.rules !== undefined) {
    if (!isObject(raw.rules)) throw new Error('rules must be an object of rule ids to "deny", "ask" or "off"');
    for (const [id, tier] of Object.entries(raw.rules)) {
      if (!RULE_IDS.has(id)) throw new Error(`rules.${id} names a rule the guard does not have`);
      if (!TIERS.includes(tier)) throw new Error(`rules.${id} must be "deny", "ask" or "off", not ${quote(tier)}`);
      // The rules that are never off are never ask either: what they stop is not the operator's to wave through.
      if (tier !== "deny" && NEVER_OFF.includes(id)) throw new Error(`rules.${id} cannot be ${tier}`);
      if (tier === "off" && PACK_BOUND.includes(id)) throw new Error(`rules.${id} cannot be off yet; pack rules move to packs in a later version`);
      config.rules[id] = tier;
    }
  }
  config.log = { ...DEFAULTS.log };
  if (raw.log !== undefined) {
    if (!isObject(raw.log)) throw new Error("log must be an object with enabled and path");
    for (const key of Object.keys(raw.log)) if (!LOG_KEYS.includes(key)) throw new Error(`unknown key ${quote(`log.${key}`)}`);
    if (raw.log.enabled !== undefined) {
      if (typeof raw.log.enabled !== "boolean") throw new Error("log.enabled must be true or false");
      config.log.enabled = raw.log.enabled;
    }
    if (raw.log.path !== undefined) {
      if (typeof raw.log.path !== "string" || raw.log.path.length === 0) throw new Error("log.path must be a non-empty string");
      config.log.path = checkedLogPath(raw.log.path, config.protectedPaths);
    }
  }
  return config;
}

/**
 * A log path the session's shell cannot name: relative, no .. in it, under .claude/ or under a
 * folder the config's protectedPaths names. Anything else is a file the session could edit, and
 * is refused.
 */
function checkedLogPath(given, protectedPaths) {
  const refuse = (why) => { throw new Error(`log.path must be under .claude/ or a folder in protectedPaths, not ${quote(given)}: ${why}`); };
  const p = given.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) refuse("an absolute path is a file the session's shell can name, so a log it can edit");
  if (p.split("/").some((s) => s === "..")) refuse("a path with .. in it can leave the protected folder");
  const folders = [".claude/", ...protectedPaths.filter((x) => x.endsWith("/")).map((x) => x.replace(/\\/g, "/"))];
  const under = folders.find((f) => p.startsWith(f) && p.length > f.length && !p.slice(f.length).startsWith("/"));
  if (!under) refuse("a log the session's shell can name is a log it can edit");
  if (p.endsWith("/")) refuse("it names a folder, not a file");
  return p;
}

/** Read and validate the config under a project root: what explain does, and what a test does for a temporary project. */
function load(options) {
  const { raw, path: file } = readConfig(projectDir(options));
  return { config: validate(raw), path: file };
}

module.exports = { FILE, DEFAULTS, KEYS, LOG_KEYS, NEVER_OFF, NEVER_EMPTY, PACK_BOUND, TIERS, projectDir, configPath, readConfig, validate, load };
