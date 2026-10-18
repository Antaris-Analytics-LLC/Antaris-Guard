/*
 * Antaris-Guard: the decision log. One JSON line per decision, allows included, hash-chained.
 *
 *   {"v":1,"t":"...","session":"...","tool":"Bash","decision":"deny","rule":"G07","reason":"...","cmd_sha256":"...","prev":"...","hash":"..."}
 *
 * v is the shape of the line, 1 for now. The command itself is never stored, only its SHA-256, so
 * the log holds no secret a command carried. An Agent line carries model after tool. hash is the
 * SHA-256 of the line's JSON text without hash, keys in the order above; prev is the hash of the
 * line before, or the word genesis on the first line. verify() recomputes every hash and follows
 * every prev, names every line that does not hold, and marks a break where two lines share one
 * prev, which is how a fork reads.
 *
 * Hook processes run at the same time when a session makes parallel tool calls, and two lines
 * must never share a prev. So the tail is read and the line appended under a lock: a file beside
 * the log, created with the wx flag (the operating system makes that atomic) and holding the
 * writer's pid and a random token. A writer that finds the lock held waits in 5 ms steps for up to
 * 15 seconds. A lock whose pid is no longer alive is cleared at once; one older than 60 seconds is
 * cleared as well, against a reused pid. The critical section is about a millisecond, so ordinary
 * contention never comes near the limit; a lock held that long means the log is stuck, and the
 * hook says so.
 *
 * A lock is removed only while it is still the one that was read: a writer clearing a stale lock
 * reads it again just before removing it and leaves it if it changed, and a writer releasing its
 * own lock leaves it if it no longer holds this writer's token. That narrows a race it cannot
 * close. If a hook dies holding the lock and two writers clear it at the same moment, a few
 * microseconds remain between the second look and the removal, in which a fresh lock can be
 * removed. And a hook that stalls inside its write for longer than 60 seconds has its lock cleared
 * as stale while it still runs. Either way two hooks can write at once and the chain forks: two
 * lines share a prev, and verify() reports the second. The README names the limit.
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

/** What a lock says and which file it is: its text, device, inode and modification time. null when it is gone or cannot be read. */
function readLock(lock) {
  try {
    const st = fs.statSync(lock);
    return { text: fs.readFileSync(lock, "utf8"), dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** Removes the lock if it is still the one `seen` describes: the same file with the same text. Whether it removed it. */
function removeIfUnchanged(lock, seen) {
  const now = readLock(lock);
  if (seen === null || now === null) return false;
  if (now.text !== seen.text || now.dev !== seen.dev || now.ino !== seen.ino || now.mtimeMs !== seen.mtimeMs) return false;
  try {
    fs.unlinkSync(lock);
    return true;
  } catch {
    return false; // another writer got there first
  }
}

/** Removes a lock whose holder is dead, or which is older than STALE_MS, if it is still that lock when it is removed. */
function clearIfStale(lock) {
  const seen = readLock(lock);
  if (seen === null) return; // gone already
  const holder = Number.parseInt(seen.text, 10);
  const dead = Number.isInteger(holder) && holder > 0 && !alive(holder);
  const stale = Date.now() - seen.mtimeMs > STALE_MS;
  if (dead || stale) removeIfUnchanged(lock, seen);
}

/** Runs fn with the log's lock held. Throws when the lock cannot be taken within WAIT_MS. */
function withLock(lock, fn) {
  const start = Date.now();
  const token = `${process.pid} ${crypto.randomBytes(8).toString("hex")}`;
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
      fs.writeSync(fd, token);
      fs.closeSync(fd);
    } catch (err) {
      // The lock was made a moment ago and holds no live pid yet, so no other writer has removed it: it is this writer's to remove.
      try { fs.closeSync(fd); } catch { /* closed already */ }
      try { fs.unlinkSync(lock); } catch { /* gone already */ }
      throw err;
    }
    try {
      return fn();
    } finally {
      // Released only while it is still this writer's: a lock cleared as stale while this writer stalled belongs to another writer now.
      const now = readLock(lock);
      if (now !== null && now.text === token) { try { fs.unlinkSync(lock); } catch { /* gone already */ } }
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
 * The first thing wrong with one line, as { o, reason, fork }: o is the line parsed, or null;
 * reason is null when the line holds. `expected` is the prev the line must carry, or null when the
 * line before could not be read. On a prev that does not match, fork is the earlier line that
 * carries the same prev, or 0: two lines sharing one prev is what two hooks appending at once leave.
 */
function check(text, n, expected, firstWithPrev) {
  let o;
  try { o = JSON.parse(text); } catch { return { o: null, reason: "not JSON", fork: 0 }; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { o: null, reason: "not an object", fork: 0 };
  for (const f of REQUIRED) if (!(f in o)) return { o, reason: `missing ${f}`, fork: 0 };
  for (const k of Object.keys(o)) if (!FIELDS.includes(k) && k !== "hash") return { o, reason: `unknown field ${k}`, fork: 0 };
  if (o.v !== VERSION) return { o, reason: `v is ${JSON.stringify(o.v)}, not ${VERSION}`, fork: 0 };
  if (expected !== null && o.prev !== expected) {
    return { o, reason: n === 1 ? "prev is not genesis" : `prev is not the hash of line ${n - 1}`, fork: firstWithPrev.get(o.prev) ?? 0 };
  }
  if (o.hash !== sha256(canonical(o))) return { o, reason: "hash does not match the line", fork: 0 };
  return { o, reason: null, fork: 0 };
}

/**
 * Walks the whole chain and lists every line that does not hold. Returns
 * { ok, lines, tip, breaks }, and line and reason for the first break when there is one. tip is
 * the hash of the last line that has one. Each break is { line, reason, fork }; fork is the
 * earlier line that shares this line's prev, or 0. After a break the walk goes on from that line's
 * own hash, so a fork, a changed line or a removed line each break the chain once and every line
 * after them is still checked.
 *
 * With `tip`, a hash the operator noted earlier: tipLine is the line that carries it, or 0. The tip
 * holds when a line carries it and no line up to that one breaks, which proves every line up to it
 * is as it was when the tip was noted; lines after it are the log growing since. tipReason is null
 * when the tip holds and says why when it does not, and a tip that does not hold makes ok false.
 */
function verify(file, { tip } = {}) {
  let rows;
  try {
    rows = readLines(file);
  } catch (err) {
    const reason = `could not read ${file}: ${err.code || err.message}`;
    const result = { ok: false, lines: 0, tip: null, breaks: [{ line: 0, reason, fork: 0 }], line: 0, reason };
    if (tip !== undefined) { result.tipLine = 0; result.tipReason = "the tip given is not the hash of any line: the log could not be read"; }
    return result;
  }
  const breaks = [];
  const firstWithPrev = new Map();
  let expected = GENESIS, last = GENESIS, tipLine = 0;
  for (let n = 1; n <= rows.length; n++) {
    const { o, reason, fork } = check(rows[n - 1], n, expected, firstWithPrev);
    if (reason !== null) breaks.push({ line: n, reason, fork });
    if (o && typeof o.prev === "string" && !firstWithPrev.has(o.prev)) firstWithPrev.set(o.prev, n);
    expected = o && typeof o.hash === "string" ? o.hash : null;
    if (expected !== null) last = expected;
    if (tip !== undefined && tipLine === 0 && expected === tip) tipLine = n;
  }
  const result = { ok: breaks.length === 0, lines: rows.length, tip: last, breaks };
  if (tip !== undefined) {
    const before = breaks.find((b) => b.line <= tipLine);
    let tipReason = null;
    if (tipLine === 0) tipReason = "the tip given is not the hash of any line: the chain up to it was rewritten or cut, or the tip is from another log";
    else if (before && before.line === tipLine) tipReason = `the tip given is line ${tipLine}, but that line does not hold, so the lines up to it are not proven`;
    else if (before) tipReason = `the tip given is line ${tipLine}, but the chain breaks at line ${before.line}, before it, so the lines up to the tip are not proven`;
    result.tipLine = tipLine;
    result.tipReason = tipReason;
    if (tipReason !== null) result.ok = false;
  }
  if (breaks.length) { result.line = breaks[0].line; result.reason = breaks[0].reason; }
  else if (result.tipReason) { result.line = result.tipLine; result.reason = result.tipReason; }
  return result;
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

module.exports = { VERSION, GENESIS, FIELDS, WAIT_MS, STALE_MS, sha256, logPath, canonical, line, append, verify, summary, readLock, removeIfUnchanged, withLock };
