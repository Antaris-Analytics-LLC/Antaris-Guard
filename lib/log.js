/*
 * Antaris-Guard: the decision log. One JSON line per decision, allows included, hash-chained.
 *
 *   {"v":1,"t":"...","session":"...","tool":"Bash","decision":"deny","rule":"G07","reason":"...","cmd_sha256":"...","prev":"...","hash":"..."}
 *
 * v is the shape of the line, 1 for now. The command itself is never stored, only its SHA-256, so
 * the log holds no secret a command carried. An Agent line carries model after tool. hash is the
 * SHA-256 of the line's JSON text without hash, keys in the order above; prev is the hash of the
 * line before, or the word genesis on the first line. verify() recomputes every hash and follows
 * every prev, and names the first line that does not hold.
 *
 * Hook processes run at the same time when a session makes parallel tool calls, and two lines
 * must never share a prev. So the tail is read and the line appended under a lock: a file beside
 * the log, created with the wx flag (the operating system makes that atomic) and holding the
 * writer's pid. A writer that finds the lock held waits in 5 ms steps for up to 15 seconds. A lock
 * whose pid is no longer alive is cleared at once; one older than 60 seconds is cleared as well,
 * against a reused pid. The critical section is about a millisecond, so ordinary contention never
 * comes near the limit; a lock held that long means the log is stuck, and the hook says so.
 *
 * What the chain proves, and what it does not: see the README. Whoever can write the file can
 * rewrite the whole chain, so the protection is that a session cannot reach the file; the chain
 * finds a line changed, added or removed by anyone who did not recompute everything after it,
 * and verify --tip finds a rewrite when the operator kept the tip somewhere no session can write.
 *
 * This file is CommonJS and has no dependencies, like the hooks that load it.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VERSION = 1;
const GENESIS = "genesis";
/** The fields of a line, in the order they are written and hashed. model is present on Agent lines only. */
const FIELDS = ["v", "t", "session", "tool", "model", "decision", "rule", "reason", "cmd_sha256", "prev"];
const REQUIRED = FIELDS.filter((f) => f !== "model").concat("hash");

const WAIT_MS = 15000;
const STEP_MS = 5;
const STALE_MS = 60000;
const TAIL_BYTES = 8192;

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** The log's absolute path under a project root, or null when the config turns the log off. */
const logPath = (settings, projectDir) => (settings.log.enabled ? path.resolve(projectDir, settings.log.path) : null);

/** The text a line's hash is computed over: its fields in the fixed order, without hash. */
function canonical(o) {
  const ordered = {};
  for (const f of FIELDS) if (o[f] !== undefined) ordered[f] = o[f];
  return JSON.stringify(ordered);
}

/** A line for one decision, hash included, chained to prev. */
function line(entry, prev) {
  const o = { v: VERSION, t: entry.t, session: entry.session, tool: entry.tool };
  if (entry.model !== undefined) o.model = entry.model;
  o.decision = entry.decision;
  o.rule = entry.rule;
  o.reason = entry.reason;
  o.cmd_sha256 = entry.cmd_sha256;
  o.prev = prev;
  o.hash = sha256(canonical(o));
  return o;
}

/** A pause without a busy loop; the hooks are synchronous. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Whether a process with this pid is alive, as far as this user can tell. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

/** Removes a lock whose holder is dead, or which is older than STALE_MS. */
function clearIfStale(lock) {
  let st, holder;
  try {
    st = fs.statSync(lock);
    holder = Number.parseInt(fs.readFileSync(lock, "utf8"), 10);
  } catch {
    return; // gone already, or being written
  }
  const dead = Number.isInteger(holder) && holder > 0 && !alive(holder);
  const stale = Date.now() - st.mtimeMs > STALE_MS;
  if (dead || stale) { try { fs.unlinkSync(lock); } catch { /* another writer got there first */ } }
}

/** Runs fn with the log's lock held. Throws when the lock cannot be taken within WAIT_MS. */
function withLock(lock, fn) {
  const start = Date.now();
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(lock, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      clearIfStale(lock);
      if (Date.now() - start > WAIT_MS) throw new Error(`the log is busy: ${lock} has been held for ${WAIT_MS / 1000} seconds`);
      sleep(STEP_MS);
      continue;
    }
    try {
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return fn();
    } finally {
      try { fs.unlinkSync(lock); } catch { /* nothing to release */ }
    }
  }
}

/** The hash of the last line of the file, genesis when there is no file or no line. Throws when the last line cannot be read. */
function lastHash(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch (err) {
    if (err.code === "ENOENT") return GENESIS;
    throw err;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return GENESIS;
    let span = Math.min(size, TAIL_BYTES), text;
    for (;;) {
      const buffer = Buffer.alloc(span);
      fs.readSync(fd, buffer, 0, span, size - span);
      text = buffer.toString("utf8");
      const body = text.endsWith("\n") ? text.slice(0, -1) : text;
      const cut = body.lastIndexOf("\n");
      if (cut !== -1 || span === size) { text = body.slice(cut + 1); break; }
      span = Math.min(size, span * 2);
    }
    let last;
    try { last = JSON.parse(text); } catch { throw new Error(`the last line of ${file} is not JSON`); }
    if (!last || typeof last.hash !== "string") throw new Error(`the last line of ${file} has no hash`);
    return last.hash;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Appends one decision to the log at `file`, creating the folder and the file as needed, under
 * the lock. Returns the line written. Throws when the log cannot be written; the hook turns that
 * into a G17 block, because a guard that cannot keep its record is not guarding.
 */
function append(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return withLock(`${file}.lock`, () => {
      const record = line(entry, lastHash(file));
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
      return record;
    });
  } catch (err) {
    const why = err && err.message ? err.message : String(err);
    throw new Error(why.includes(file) ? why : `${file}: ${why}`);
  }
}

/** The lines of a log file, parsed, or a thrown error. */
function readLines(file) {
  const text = fs.readFileSync(file, "utf8");
  const rows = text.split("\n");
  if (rows.length && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

/**
 * Walks the chain. Returns { ok: true, lines, tip } when every line holds, else
 * { ok: false, line, reason } naming the first line that does not. With `tip`, the chain must
 * also end at that hash.
 */
function verify(file, { tip } = {}) {
  let rows;
  try {
    rows = readLines(file);
  } catch (err) {
    return { ok: false, line: 0, reason: `could not read ${file}: ${err.code || err.message}` };
  }
  let prev = GENESIS;
  for (let n = 1; n <= rows.length; n++) {
    const bad = (reason) => ({ ok: false, line: n, reason });
    let o;
    try { o = JSON.parse(rows[n - 1]); } catch { return bad("not JSON"); }
    if (!o || typeof o !== "object" || Array.isArray(o)) return bad("not an object");
    for (const f of REQUIRED) if (!(f in o)) return bad(`missing ${f}`);
    for (const k of Object.keys(o)) if (!FIELDS.includes(k) && k !== "hash") return bad(`unknown field ${k}`);
    if (o.v !== VERSION) return bad(`v is ${JSON.stringify(o.v)}, not ${VERSION}`);
    if (o.prev !== prev) return bad(n === 1 ? "prev is not genesis" : `prev is not the hash of line ${n - 1}`);
    if (o.hash !== sha256(canonical(o))) return bad("hash does not match the line");
    prev = o.hash;
  }
  if (tip !== undefined && prev !== tip) return { ok: false, line: rows.length, reason: `the chain ends at ${prev}, not at the tip ${tip}` };
  return { ok: true, lines: rows.length, tip: prev };
}

/** Counts by decision, rule, day, session and tool, the size, the tip, and whether the chain holds. */
function summary(file) {
  const size = fs.statSync(file).size;
  const rows = readLines(file);
  const count = (key) => {
    const out = {};
    for (const row of rows) {
      let o; try { o = JSON.parse(row); } catch { continue; }
      const k = key(o);
      if (k === undefined || k === null) continue;
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  };
  return {
    file,
    lines: rows.length,
    size,
    chain: verify(file),
    byDecision: count((o) => o.decision),
    byRule: count((o) => o.rule),
    byDay: count((o) => (typeof o.t === "string" ? o.t.slice(0, 10) : undefined)),
    bySession: count((o) => o.session),
    byTool: count((o) => o.tool),
  };
}

module.exports = { VERSION, GENESIS, FIELDS, WAIT_MS, STALE_MS, sha256, logPath, canonical, line, append, verify, summary };
