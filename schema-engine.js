(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SqlLab = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const THRESHOLD = 1; // ponytail: seluruh kasus uji wajib lulus; ambang 70% RPS dinilai dosen pada tugas live
  const VERSION = "8.4.0-simulasi-lokal";
  const DEFAULT_DB = "praktikum_sbd_p05";
  const CLOCK = "2026-01-15 08:00:00";
  const LIMITATIONS = "Engine SQL lokal ini menjalankan subset DML dan DDL dasar (CREATE TABLE, INSERT, UPDATE, DELETE, TRUNCATE, SELECT satu tabel, transaksi) pada memori peramban. Ia bukan server MySQL, tidak mendukung JOIN, subquery, atau trigger, dan tidak menggantikan verifikasi pada MySQL Community Server 8.4 LTS atau MariaDB.";

  class SqlError extends Error {
    constructor(errno, message, sqlstate) { super(message); this.errno = errno; this.sqlstate = sqlstate || STATES[errno] || "HY000"; }
  }

  // ---------- pemecah pernyataan dan tokenizer ----------
  function splitStatements(source) {
    const src = String(source || ""), out = [];
    let start = 0, quote = "";
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === "\\" && quote !== "`") i++;
        else if (c === quote) { if (src[i + 1] === quote) i++; else quote = ""; }
        continue;
      }
      if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
      if (c === "#" || (c === "-" && src[i + 1] === "-" && (i + 2 >= src.length || /\s/.test(src[i + 2])))) { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 1; continue; }
      if (c === ";") { const part = src.slice(start, i).trim(); if (part) out.push(part); start = i + 1; }
    }
    const tail = src.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }

  function syntaxError(src, tok) {
    const near = tok && tok.t !== "eof" ? src.slice(tok.pos, tok.pos + 50) : "";
    return new SqlError(1064, `You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '${near}' at line 1`, "42000");
  }

  const ESCAPES = { n: "\n", t: "\t", r: "\r", "0": "\0", b: "\b", Z: "\x1a" };
  function tokenize(src) {
    const toks = []; let i = 0;
    const eat = (re) => { re.lastIndex = i; const m = re.exec(src); return m && m.index === i ? m[0] : null; };
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "#" || (c === "-" && src[i + 1] === "-" && (i + 2 >= src.length || /\s/.test(src[i + 2])))) { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
      const pos = i;
      const num = eat(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y);
      if (num) { i += num.length; toks.push({ t: "num", v: Number(num), pos, end: i }); continue; }
      if (c === "'" || c === '"') {
        let value = "", closed = false; i++;
        while (i < src.length) {
          const d = src[i];
          if (d === "\\" && i + 1 < src.length) { const e = src[i + 1]; value += ESCAPES[e] !== undefined ? ESCAPES[e] : e; i += 2; continue; }
          if (d === c) { if (src[i + 1] === c) { value += c; i += 2; continue; } closed = true; i++; break; }
          value += d; i++;
        }
        if (!closed) throw syntaxError(src, { t: "str", pos });
        toks.push({ t: "str", v: value, pos, end: i }); continue;
      }
      if (c === "`") {
        const e = src.indexOf("`", i + 1);
        if (e < 0) throw syntaxError(src, { t: "id", pos });
        toks.push({ t: "id", v: src.slice(i + 1, e), u: "", quoted: true, pos, end: e + 1 }); i = e + 1; continue;
      }
      const word = eat(/[A-Za-z_][\w$]*/y);
      if (word) { i += word.length; toks.push({ t: "id", v: word, u: word.toUpperCase(), pos, end: i }); continue; }
      if (c === "@") {
        const name = eat(/@[A-Za-z_][\w$.]*/y);
        if (!name) throw syntaxError(src, { t: "op", pos });
        i += name.length; toks.push({ t: "var", v: name.slice(1).toLowerCase(), pos, end: i }); continue;
      }
      const op = ["<=>", "<=", ">=", "<>", "!=", ":=", "||", "&&"].find(o => src.startsWith(o, i)) || (/[(),.*+\-/%=<>!;]/.test(c) ? c : null);
      if (!op) throw syntaxError(src, { t: "op", pos });
      i += op.length; toks.push({ t: "op", v: op, pos, end: i });
    }
    return toks;
  }

  // ---------- parser ----------
  const NOT_IDENT = new Set(["SELECT", "FROM", "WHERE", "GROUP", "ORDER", "BY", "LIMIT", "OFFSET", "INSERT", "INTO", "VALUES", "VALUE", "UPDATE", "SET", "DELETE", "AND", "OR", "AS", "IS", "IN", "LIKE", "BETWEEN", "ASC", "DESC", "HAVING", "JOIN", "ON", "UNION"]);

  class Parser {
    constructor(src) { this.src = src; this.toks = tokenize(src); this.i = 0; }
    peek(k = 0) { return this.toks[this.i + k] || { t: "eof", pos: this.src.length, end: this.src.length }; }
    next() { const t = this.peek(); this.i++; return t; }
    fail(tok) { throw syntaxError(this.src, tok || this.peek()); }
    kw(word, k = 0) { const t = this.peek(k); return t.t === "id" && !t.quoted && t.u === word; }
    acceptKw(word) { if (this.kw(word)) { this.i++; return true; } return false; }
    expectKw(word) { if (!this.acceptKw(word)) this.fail(); }
    op(o, k = 0) { const t = this.peek(k); return t.t === "op" && t.v === o; }
    acceptOp(o) { if (this.op(o)) { this.i++; return true; } return false; }
    expectOp(o) { if (!this.acceptOp(o)) this.fail(); }
    ident() { const t = this.peek(); if (t.t !== "id") this.fail(); this.i++; return t.v.toLowerCase(); }
    lastEnd() { return this.toks[this.i - 1].end; }
    done() { if (this.peek().t !== "eof") this.fail(); }
  }

  function parseExpr(p) { return parseOr(p); }
  function parseOr(p) { let l = parseAnd(p); while (p.acceptKw("OR") || p.acceptOp("||")) l = { k: "bin", op: "OR", l, r: parseAnd(p) }; return l; }
  function parseAnd(p) { let l = parseNot(p); while (p.acceptKw("AND") || p.acceptOp("&&")) l = { k: "bin", op: "AND", l, r: parseNot(p) }; return l; }
  function parseNot(p) { if (p.acceptKw("NOT")) return { k: "un", op: "NOT", e: parseNot(p) }; return parseCmp(p); }
  function parseCmp(p) {
    let l = parseAdd(p);
    for (;;) {
      const t = p.peek();
      if (t.t === "op" && ["=", "<>", "!=", "<", ">", "<=", ">=", "<=>"].includes(t.v)) { p.next(); l = { k: "bin", op: t.v === "!=" ? "<>" : t.v, l, r: parseAdd(p) }; continue; }
      if (p.acceptKw("IS")) { const not = p.acceptKw("NOT"); p.expectKw("NULL"); l = { k: "isnull", e: l, not }; continue; }
      let not = false;
      if (p.kw("NOT") && ["IN", "BETWEEN", "LIKE"].some(w => p.kw(w, 1))) { p.next(); not = true; }
      if (p.acceptKw("IN")) {
        p.expectOp("("); const list = [];
        do list.push(parseExpr(p)); while (p.acceptOp(","));
        p.expectOp(")"); l = { k: "in", e: l, list, not }; continue;
      }
      if (p.acceptKw("BETWEEN")) { const lo = parseAdd(p); p.expectKw("AND"); l = { k: "between", e: l, lo, hi: parseAdd(p), not }; continue; }
      if (p.acceptKw("LIKE")) { l = { k: "like", e: l, pat: parseAdd(p), not }; continue; }
      return l;
    }
  }
  function parseAdd(p) { let l = parseMul(p); while (p.op("+") || p.op("-")) { const o = p.next().v; l = { k: "bin", op: o, l, r: parseMul(p) }; } return l; }
  function parseMul(p) {
    let l = parseUnary(p);
    for (;;) {
      if (p.op("*") || p.op("/") || p.op("%")) { const o = p.next().v; l = { k: "bin", op: o, l, r: parseUnary(p) }; }
      else if (p.acceptKw("DIV")) l = { k: "bin", op: "DIV", l, r: parseUnary(p) };
      else if (p.acceptKw("MOD")) l = { k: "bin", op: "%", l, r: parseUnary(p) };
      else return l;
    }
  }
  function parseUnary(p) {
    if (p.acceptOp("-")) return { k: "un", op: "-", e: parseUnary(p) };
    if (p.acceptOp("+")) return parseUnary(p);
    return parsePrimary(p);
  }
  function parsePrimary(p) {
    const t = p.peek();
    if (t.t === "num" || t.t === "str") { p.next(); return { k: "lit", v: t.v }; }
    if (t.t === "var") { p.next(); return { k: "var", name: t.v }; }
    if (t.t === "op" && t.v === "(") { p.next(); const e = parseExpr(p); p.expectOp(")"); return e; }
    if (t.t !== "id") p.fail();
    if (!t.quoted) {
      if (t.u === "NULL") { p.next(); return { k: "lit", v: null }; }
      if (t.u === "TRUE") { p.next(); return { k: "lit", v: 1 }; }
      if (t.u === "FALSE") { p.next(); return { k: "lit", v: 0 }; }
      if (t.u === "DEFAULT") { p.next(); return { k: "default" }; }
      if (NOT_IDENT.has(t.u)) p.fail();
      if (p.op("(", 1)) {
        p.next(); p.next();
        const node = { k: "fn", name: t.u, args: [], star: false };
        if (p.acceptOp("*")) node.star = true;
        else if (!p.op(")")) do node.args.push(parseExpr(p)); while (p.acceptOp(","));
        p.expectOp(")");
        return node;
      }
      if (["CURRENT_TIMESTAMP", "CURRENT_DATE", "NOW", "CURDATE"].includes(t.u)) { p.next(); return { k: "fn", name: t.u, args: [], star: false }; }
    }
    p.next();
    if (p.op(".") && p.peek(1).t === "id") { p.next(); return { k: "col", table: t.v.toLowerCase(), name: p.next().v.toLowerCase() }; }
    return { k: "col", table: null, name: t.v.toLowerCase() };
  }

  function parseSelect(p) {
    p.expectKw("SELECT");
    const items = [];
    do {
      if (p.acceptOp("*")) { items.push({ star: true }); continue; }
      const start = p.peek().pos, expr = parseExpr(p), text = p.src.slice(start, p.lastEnd());
      let alias = null;
      if (p.acceptKw("AS")) alias = p.next().v; else if (p.peek().t === "id" && !NOT_IDENT.has(p.peek().u) && !p.peek().quoted) alias = p.next().v;
      items.push({ expr, alias: alias || text });
    } while (p.acceptOp(","));
    const q = { type: "select", items, table: null, alias: null, where: null, group: [], order: [], limit: null, offset: 0 };
    if (p.acceptKw("FROM")) {
      q.table = p.ident();
      if (p.acceptKw("AS")) q.alias = p.ident(); else if (p.peek().t === "id" && !NOT_IDENT.has(p.peek().u)) q.alias = p.ident();
    }
    if (p.acceptKw("WHERE")) q.where = parseExpr(p);
    if (p.acceptKw("GROUP")) { p.expectKw("BY"); do q.group.push(parseExpr(p)); while (p.acceptOp(",")); }
    if (p.acceptKw("ORDER")) {
      p.expectKw("BY");
      do { const e = parseExpr(p); const desc = p.acceptKw("DESC"); if (!desc) p.acceptKw("ASC"); q.order.push({ e, desc }); } while (p.acceptOp(","));
    }
    if (p.acceptKw("LIMIT")) {
      const a = p.next(); if (a.t !== "num") p.fail(a);
      q.limit = a.v;
      if (p.acceptOp(",")) { const b = p.next(); if (b.t !== "num") p.fail(b); q.offset = a.v; q.limit = b.v; }
      else if (p.acceptKw("OFFSET")) { const b = p.next(); if (b.t !== "num") p.fail(b); q.offset = b.v; }
    }
    p.done();
    return q;
  }

  function parseNameList(p) {
    p.expectOp("("); const out = [];
    do out.push(p.ident()); while (p.acceptOp(","));
    p.expectOp(")");
    return out;
  }

  function parseInsert(p) {
    p.expectKw("INSERT"); p.acceptKw("INTO");
    const q = { type: "insert", table: p.ident(), columns: null, rows: [] };
    if (p.op("(")) q.columns = parseNameList(p);
    if (!p.acceptKw("VALUES") && !p.acceptKw("VALUE")) p.fail();
    do {
      p.expectOp("("); const row = [];
      if (!p.op(")")) do row.push(parseExpr(p)); while (p.acceptOp(","));
      p.expectOp(")"); q.rows.push(row);
    } while (p.acceptOp(","));
    p.done();
    return q;
  }

  function parseUpdate(p) {
    p.expectKw("UPDATE");
    const q = { type: "update", table: p.ident(), sets: [], where: null };
    p.expectKw("SET");
    do { const col = p.ident(); p.expectOp("="); q.sets.push({ col, e: parseExpr(p) }); } while (p.acceptOp(","));
    if (p.acceptKw("WHERE")) q.where = parseExpr(p);
    p.done();
    return q;
  }

  function parseDelete(p) {
    p.expectKw("DELETE"); p.expectKw("FROM");
    const q = { type: "delete", table: p.ident(), where: null };
    if (p.acceptKw("WHERE")) q.where = parseExpr(p);
    p.done();
    return q;
  }

  const TYPES = new Set(["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT", "DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "BOOLEAN", "BOOL", "CHAR", "VARCHAR", "TEXT", "DATE", "TIME", "DATETIME", "TIMESTAMP", "YEAR", "ENUM"]);

  function parseType(p) {
    const tok = p.peek(), raw = p.ident().toUpperCase();
    if (!TYPES.has(raw)) p.fail(tok);
    const type = { INTEGER: "INT", NUMERIC: "DECIMAL", BOOL: "TINYINT", BOOLEAN: "TINYINT" }[raw] || raw;
    const col = { type, size: raw === "BOOL" || raw === "BOOLEAN" ? 1 : null, scale: null, unsigned: false, enumVals: null };
    if (p.acceptOp("(")) {
      if (type === "ENUM") { col.enumVals = []; do { const t = p.next(); if (t.t !== "str") p.fail(t); col.enumVals.push(t.v); } while (p.acceptOp(",")); }
      else { const a = p.next(); if (a.t !== "num") p.fail(a); col.size = a.v; if (p.acceptOp(",")) { const b = p.next(); if (b.t !== "num") p.fail(b); col.scale = b.v; } }
      p.expectOp(")");
    }
    if (type === "DECIMAL") { if (col.size === null) col.size = 10; if (col.scale === null) col.scale = 0; }
    if ((type === "CHAR") && col.size === null) col.size = 1;
    if (p.acceptKw("UNSIGNED")) col.unsigned = true;
    return col;
  }

  function typeText(c) {
    let s = c.type.toLowerCase();
    if (c.enumVals) s += `(${c.enumVals.map(v => `'${v}'`).join(",")})`;
    else if (c.type === "DECIMAL") s += `(${c.size},${c.scale})`;
    else if (["CHAR", "VARCHAR"].includes(c.type) || (c.type === "TINYINT" && c.size === 1)) s += `(${c.size})`;
    return c.unsigned ? `${s} unsigned` : s;
  }

  function parseAction(p) {
    if (p.acceptKw("RESTRICT")) return "RESTRICT";
    if (p.acceptKw("CASCADE")) return "CASCADE";
    if (p.acceptKw("NO")) { p.expectKw("ACTION"); return "NO ACTION"; }
    if (p.acceptKw("SET")) { p.expectKw("NULL"); return "SET NULL"; }
    return p.fail();
  }

  function parseTableItem(p, q) {
    let cname = null;
    if (p.acceptKw("CONSTRAINT") && !["PRIMARY", "UNIQUE", "FOREIGN", "CHECK"].some(w => p.kw(w))) cname = p.ident();
    if (p.acceptKw("PRIMARY")) { p.expectKw("KEY"); q.keys.push({ name: "PRIMARY", cols: parseNameList(p), primary: true }); return; }
    if (p.acceptKw("UNIQUE")) {
      if (!p.acceptKw("KEY")) p.acceptKw("INDEX");
      const iname = p.op("(") ? cname : p.ident(), cols = parseNameList(p);
      q.keys.push({ name: iname || cols[0], cols }); return;
    }
    if (p.acceptKw("FOREIGN")) {
      p.expectKw("KEY");
      const fname = p.op("(") ? cname : p.ident(), cols = parseNameList(p);
      p.expectKw("REFERENCES");
      const fk = { name: fname, cols, refTable: p.ident(), refCols: parseNameList(p), onDelete: "RESTRICT", onUpdate: "RESTRICT" };
      while (p.acceptKw("ON")) {
        if (p.acceptKw("DELETE")) fk.onDelete = parseAction(p);
        else { p.expectKw("UPDATE"); fk.onUpdate = parseAction(p); }
      }
      q.fks.push(fk); return;
    }
    if (p.acceptKw("CHECK")) { p.expectOp("("); const e = parseExpr(p); p.expectOp(")"); q.checks.push({ name: cname, e }); return; }
    if (p.kw("KEY") || p.kw("INDEX")) { p.next(); if (!p.op("(")) p.ident(); parseNameList(p); return; }
    const col = { name: p.ident(), ...parseType(p), notNull: false, hasDefault: false, def: null, autoInc: false };
    for (;;) {
      if (p.acceptKw("NOT")) { p.expectKw("NULL"); col.notNull = true; }
      else if (p.acceptKw("NULL")) col.notNull = false;
      else if (p.acceptKw("DEFAULT")) { col.hasDefault = true; col.def = parseUnary(p); }
      else if (p.acceptKw("AUTO_INCREMENT")) col.autoInc = true;
      else if (p.acceptKw("PRIMARY")) { p.expectKw("KEY"); q.keys.push({ name: "PRIMARY", cols: [col.name], primary: true }); }
      else if (p.acceptKw("UNIQUE")) { p.acceptKw("KEY"); q.keys.push({ name: col.name, cols: [col.name] }); }
      else if (p.acceptKw("CHECK")) { p.expectOp("("); const e = parseExpr(p); p.expectOp(")"); q.checks.push({ name: null, e }); }
      else if (p.acceptKw("COMMENT") || p.acceptKw("COLLATE")) p.next();
      else if (p.acceptKw("CHARACTER")) { p.expectKw("SET"); p.next(); }
      else break;
    }
    q.cols.push(col);
  }

  function parseCreate(p) {
    p.expectKw("CREATE");
    if (p.acceptKw("DATABASE") || p.acceptKw("SCHEMA")) {
      let ifNot = false;
      if (p.acceptKw("IF")) { p.expectKw("NOT"); p.expectKw("EXISTS"); ifNot = true; }
      const q = { type: "createDb", name: p.ident(), ifNot };
      p.i = p.toks.length;
      return q;
    }
    p.expectKw("TABLE");
    let ifNot = false;
    if (p.acceptKw("IF")) { p.expectKw("NOT"); p.expectKw("EXISTS"); ifNot = true; }
    const q = { type: "createTable", name: p.ident(), ifNot, cols: [], keys: [], fks: [], checks: [] };
    p.expectOp("(");
    do parseTableItem(p, q); while (p.acceptOp(","));
    p.expectOp(")");
    while (p.peek().t !== "eof") {
      if (p.acceptKw("AUTO_INCREMENT")) { p.acceptOp("="); q.autoStart = p.next().v; }
      else if (["ENGINE", "CHARSET", "COLLATE", "COMMENT"].some(w => p.acceptKw(w))) { p.acceptOp("="); p.next(); }
      else if (p.acceptKw("DEFAULT")) continue;
      else if (p.acceptKw("CHARACTER")) { p.expectKw("SET"); p.acceptOp("="); p.next(); }
      else p.fail();
    }
    return q;
  }

  function unsupported(what) { return new SqlError(1235, `Simulator lokal belum mendukung ${what}; jalankan pernyataan ini pada MySQL/MariaDB asli.`, "42000"); }

  function parseStatement(text) {
    const p = new Parser(text), t = p.peek();
    if (t.t !== "id") p.fail();
    switch (t.u) {
      case "SELECT": {
        const q = parseSelectChecked(p);
        return q;
      }
      case "INSERT": return parseInsert(p);
      case "UPDATE": return parseUpdate(p);
      case "DELETE": return parseDelete(p);
      case "TRUNCATE": { p.next(); p.acceptKw("TABLE"); const q = { type: "truncate", table: p.ident() }; p.done(); return q; }
      case "CREATE": { const q = parseCreate(p); p.done(); return q; }
      case "DROP": {
        p.next(); p.expectKw("TABLE");
        let ifExists = false;
        if (p.acceptKw("IF")) { p.expectKw("EXISTS"); ifExists = true; }
        const names = []; do names.push(p.ident()); while (p.acceptOp(","));
        p.done(); return { type: "dropTable", names, ifExists };
      }
      case "USE": { p.next(); const q = { type: "use", name: p.ident() }; p.done(); return q; }
      case "SHOW": { p.next(); p.expectKw("TABLES"); p.done(); return { type: "showTables" }; }
      case "DESCRIBE": case "DESC": { p.next(); const q = { type: "describe", table: p.ident() }; p.done(); return q; }
      case "START": { p.next(); p.expectKw("TRANSACTION"); p.done(); return { type: "tx", action: "begin" }; }
      case "BEGIN": { p.next(); p.acceptKw("WORK"); p.done(); return { type: "tx", action: "begin" }; }
      case "COMMIT": case "ROLLBACK": { p.next(); p.acceptKw("WORK"); p.done(); return { type: "tx", action: t.u.toLowerCase() }; }
      case "SET": return parseSet(p);
      case "ALTER": case "REPLACE": case "GRANT": case "CALL": case "WITH": case "LOCK": case "RENAME": case "LOAD": throw unsupported(`pernyataan ${t.u}`);
      default: return p.fail();
    }
  }

  function parseSelectChecked(p) {
    try { return parseSelect(p); }
    catch (err) {
      const near = p.peek();
      if (err instanceof SqlError && near.t === "id" && ["JOIN", "INNER", "LEFT", "RIGHT", "CROSS", "UNION"].includes(near.u)) throw unsupported(`${near.u} (materi pertemuan berikutnya)`);
      throw err;
    }
  }

  function parseSet(p) {
    p.expectKw("SET");
    if (p.peek().t === "var") {
      const name = p.next().v;
      if (!p.acceptOp("=") && !p.acceptOp(":=")) p.fail();
      const e = parseExpr(p); p.done();
      return { type: "setVar", name, e };
    }
    const name = p.ident().toUpperCase();
    if (name === "NAMES") { p.i = p.toks.length; return { type: "noop" }; }
    if (!["AUTOCOMMIT", "FOREIGN_KEY_CHECKS"].includes(name)) throw unsupported(`variabel ${name}`);
    p.expectOp("=");
    const e = parseExpr(p); p.done();
    return { type: "setFlag", name: name.toLowerCase(), e };
  }

  // ---------- nilai, ekspresi, koersi ----------
  const STATES = { 1062: "23000", 1048: "23000", 1451: "23000", 1452: "23000", 1054: "42S22", 1146: "42S02", 1136: "21S01", 1406: "22001", 1265: "01000", 1292: "22007", 1264: "22003", 1050: "42S01", 1051: "42S02", 1701: "42000", 1305: "42000", 1049: "42000", 1060: "42S21", 1072: "42000" };
  const norm = x => Number(x.toPrecision(15));
  const truthy = v => v !== null && v !== undefined && num(v) !== 0;
  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    const n = parseFloat(v); return Number.isNaN(n) ? 0 : n;
  }
  function cmp(a, b) {
    if (a === null || b === null || a === undefined || b === undefined) return null;
    if (typeof a === "number" || typeof b === "number") { const x = num(a), y = num(b); return x < y ? -1 : x > y ? 1 : 0; }
    const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0;
  }
  const same = (a, b) => (typeof a === "number" && typeof b === "number") ? Math.abs(a - b) < 1e-9 : a === b;
  const bool = v => v === null ? null : (v ? 1 : 0);
  const keyText = v => typeof v === "string" ? v.toLowerCase() : String(v);
  const q$ = name => `\`${name}\``;

  function likeRegex(pattern) {
    let out = "";
    for (const c of String(pattern)) out += c === "%" ? "[\\s\\S]*" : c === "_" ? "[\\s\\S]" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${out}$`, "i");
  }

  function hasAggregate(n) {
    if (!n || typeof n !== "object") return false;
    if (n.k === "fn" && ["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(n.name)) return true;
    return Object.values(n).some(v => Array.isArray(v) ? v.some(hasAggregate) : hasAggregate(v));
  }

  function evalNode(n, ctx) {
    switch (n.k) {
      case "lit": return n.v;
      case "var": { const v = ctx.sess.vars[n.name]; return v === undefined ? null : v; }
      case "default": throw new SqlError(1064, "You have an error in your SQL syntax; DEFAULT hanya boleh dipakai pada VALUES atau SET.", "42000");
      case "col": return evalColumn(n, ctx);
      case "un": {
        const v = evalNode(n.e, ctx);
        if (v === null) return null;
        return n.op === "NOT" ? (truthy(v) ? 0 : 1) : -num(v);
      }
      case "isnull": return (evalNode(n.e, ctx) === null) !== n.not ? 1 : 0;
      case "in": {
        const v = evalNode(n.e, ctx);
        if (v === null) return null;
        let sawNull = false;
        for (const item of n.list) { const c = cmp(v, evalNode(item, ctx)); if (c === 0) return n.not ? 0 : 1; if (c === null) sawNull = true; }
        return sawNull ? null : (n.not ? 1 : 0);
      }
      case "between": {
        const v = evalNode(n.e, ctx), lo = cmp(v, evalNode(n.lo, ctx)), hi = cmp(v, evalNode(n.hi, ctx));
        if (lo === null || hi === null) return null;
        return bool((lo >= 0 && hi <= 0) !== n.not);
      }
      case "like": {
        const v = evalNode(n.e, ctx), pat = evalNode(n.pat, ctx);
        if (v === null || pat === null) return null;
        return bool(likeRegex(pat).test(String(v)) !== n.not);
      }
      case "bin": return evalBinary(n, ctx);
      case "fn": return callFunction(n, ctx);
      default: throw new SqlError(1064, "Ekspresi tidak dikenali.", "42000");
    }
  }

  function evalColumn(n, ctx) {
    const t = ctx.table;
    const known = t && (!n.table || n.table === t.name || n.table === ctx.alias) && t.cols.some(c => c.name === n.name);
    if (!known) throw new SqlError(1054, `Unknown column '${n.table ? n.table + "." : ""}${n.name}' in '${ctx.clause || "field list"}'`, "42S22");
    const v = ctx.row[n.name];
    return v === undefined ? null : v;
  }

  function evalBinary(n, ctx) {
    const a = evalNode(n.l, ctx), b = evalNode(n.r, ctx);
    switch (n.op) {
      case "AND": if (a !== null && !truthy(a)) return 0; if (b !== null && !truthy(b)) return 0; return a === null || b === null ? null : 1;
      case "OR": if (truthy(a) || truthy(b)) return 1; return a === null || b === null ? null : 0;
      case "<=>": return a === null || b === null ? (a === b ? 1 : 0) : bool(cmp(a, b) === 0);
      case "=": { const c = cmp(a, b); return c === null ? null : bool(c === 0); }
      case "<>": { const c = cmp(a, b); return c === null ? null : bool(c !== 0); }
      case "<": { const c = cmp(a, b); return c === null ? null : bool(c < 0); }
      case ">": { const c = cmp(a, b); return c === null ? null : bool(c > 0); }
      case "<=": { const c = cmp(a, b); return c === null ? null : bool(c <= 0); }
      case ">=": { const c = cmp(a, b); return c === null ? null : bool(c >= 0); }
      default: {
        if (a === null || b === null) return null;
        const x = num(a), y = num(b);
        if (n.op === "+") return norm(x + y);
        if (n.op === "-") return norm(x - y);
        if (n.op === "*") return norm(x * y);
        if (y === 0) return null;
        if (n.op === "/") return norm(x / y);
        if (n.op === "DIV") return Math.trunc(x / y);
        return norm(x % y);
      }
    }
  }

  function callFunction(n, ctx) {
    const sess = ctx.sess, arg = i => evalNode(n.args[i], ctx);
    if (["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(n.name)) {
      if (!ctx.agg) throw new SqlError(1111, "Invalid use of group function", "HY000");
      if (n.name === "COUNT" && n.star) return ctx.agg.length;
      const values = ctx.agg.map(row => evalNode(n.args[0], { ...ctx, row, agg: null })).filter(v => v !== null);
      if (n.name === "COUNT") return values.length;
      if (!values.length) return null;
      if (n.name === "SUM") return norm(values.reduce((s, v) => s + num(v), 0));
      if (n.name === "AVG") return norm(values.reduce((s, v) => s + num(v), 0) / values.length);
      return values.reduce((best, v) => { const c = cmp(v, best); return (n.name === "MIN" ? c < 0 : c > 0) ? v : best; });
    }
    switch (n.name) {
      case "LAST_INSERT_ID": return sess.lastInsertId;
      case "ROW_COUNT": return sess.rowCount;
      case "VERSION": return VERSION;
      case "DATABASE": return sess.state.dbName;
      case "NOW": case "CURRENT_TIMESTAMP": return CLOCK;
      case "CURDATE": case "CURRENT_DATE": return CLOCK.slice(0, 10);
      case "UPPER": { const v = arg(0); return v === null ? null : String(v).toUpperCase(); }
      case "LOWER": { const v = arg(0); return v === null ? null : String(v).toLowerCase(); }
      case "TRIM": { const v = arg(0); return v === null ? null : String(v).trim(); }
      case "LENGTH": { const v = arg(0); return v === null ? null : String(v).length; }
      case "ABS": { const v = arg(0); return v === null ? null : Math.abs(num(v)); }
      case "ROUND": { const v = arg(0); if (v === null) return null; const d = n.args.length > 1 ? num(arg(1)) : 0, f = 10 ** d; return Math.sign(num(v)) * Math.round(Math.abs(num(v)) * f) / f; }
      case "CONCAT": { const parts = n.args.map((_, i) => arg(i)); return parts.includes(null) ? null : parts.join(""); }
      case "COALESCE": case "IFNULL": { for (let i = 0; i < n.args.length; i++) { const v = arg(i); if (v !== null) return v; } return null; }
      default: throw new SqlError(1305, `FUNCTION ${sess.state.dbName}.${n.name} does not exist`, "42000");
    }
  }

  const INT_RANGE = { TINYINT: [-128, 127, 255], SMALLINT: [-32768, 32767, 65535], MEDIUMINT: [-8388608, 8388607, 16777215], INT: [-2147483648, 2147483647, 4294967295], BIGINT: [-9223372036854775808, 9223372036854775807, 18446744073709551615] };

  function validDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  function coerce(c, v, rowNo) {
    const at = `for column '${c.name}' at row ${rowNo}`;
    if (INT_RANGE[c.type]) {
      if (typeof v === "string" && !/^\s*[-+]?\d+(\.\d+)?\s*$/.test(v)) throw new SqlError(1366, `Incorrect integer value: '${v}' ${at}`);
      const x = num(v), r = Math.sign(x) * Math.round(Math.abs(x)), [lo, hi, uhi] = INT_RANGE[c.type];
      if (r < (c.unsigned ? 0 : lo) || r > (c.unsigned ? uhi : hi)) throw new SqlError(1264, `Out of range value ${at}`);
      return r;
    }
    switch (c.type) {
      case "DECIMAL": {
        if (typeof v === "string" && !/^\s*[-+]?\d+(\.\d+)?\s*$/.test(v)) throw new SqlError(1366, `Incorrect decimal value: '${v}' ${at}`);
        const f = 10 ** c.scale, r = Math.sign(num(v)) * Math.round(Math.abs(num(v)) * f + 1e-9) / f;
        if (Math.abs(r) >= 10 ** (c.size - c.scale) || (c.unsigned && r < 0)) throw new SqlError(1264, `Out of range value ${at}`);
        return r;
      }
      case "FLOAT": case "DOUBLE": return num(v);
      case "CHAR": case "VARCHAR": {
        const s = String(v);
        if (s.length > c.size) throw new SqlError(1406, `Data too long for column '${c.name}' at row ${rowNo}`);
        return s;
      }
      case "TEXT": return String(v);
      case "ENUM": {
        const hit = c.enumVals.find(e => e.toLowerCase() === String(v).toLowerCase());
        if (hit === undefined) throw new SqlError(1265, `Data truncated for column '${c.name}' at row ${rowNo}`);
        return hit;
      }
      case "DATE": {
        const s = String(v).slice(0, 10);
        if (!validDate(s)) throw new SqlError(1292, `Incorrect date value: '${v}' ${at}`);
        return s;
      }
      case "DATETIME": case "TIMESTAMP": {
        const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.exec(String(v));
        if (!m || !validDate(m[1]) || (m[2] && (+m[2] > 23 || +m[3] > 59 || +m[4] > 59))) throw new SqlError(1292, `Incorrect datetime value: '${v}' ${at}`);
        return `${m[1]} ${m[2] || "00"}:${m[3] || "00"}:${m[4] || "00"}`;
      }
      case "TIME": return String(v);
      case "YEAR": { const y = num(v); if (y < 1901 || y > 2155) throw new SqlError(1264, `Out of range value ${at}`); return y; }
      default: return v;
    }
  }

  const fkText = fk => `CONSTRAINT ${q$(fk.name)} FOREIGN KEY (${fk.cols.map(q$).join(", ")}) REFERENCES ${q$(fk.refTable)} (${fk.refCols.map(q$).join(", ")})` +
    (["CASCADE", "SET NULL"].includes(fk.onDelete) ? ` ON DELETE ${fk.onDelete}` : "") + (["CASCADE", "SET NULL"].includes(fk.onUpdate) ? ` ON UPDATE ${fk.onUpdate}` : "");

  // ---------- sesi: DDL, DML, SELECT, transaksi ----------
  const okResult = (extra) => ({ type: "ok", affectedRows: 0, message: "Query OK, 0 rows affected", ...extra });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  class Session {
    constructor() {
      this.state = { dbName: DEFAULT_DB, dbs: [DEFAULT_DB], tables: {} };
      this.lastInsertId = 0; this.rowCount = -1; this.vars = {};
      this.tx = null; this.autocommit = true; this.fkChecks = true;
    }

    clone() {
      const s = new Session();
      s.state = JSON.parse(JSON.stringify(this.state));
      s.lastInsertId = this.lastInsertId; s.rowCount = this.rowCount; s.vars = { ...this.vars };
      s.tx = this.tx; s.autocommit = this.autocommit; s.fkChecks = this.fkChecks;
      return s;
    }

    exec(sql) {
      const results = []; let failed = false;
      for (const text of splitStatements(sql)) {
        let res;
        try { res = { sql: text, ...this.run(text) }; }
        catch (err) {
          if (!(err instanceof SqlError)) throw err;
          this.rowCount = -1; failed = true;
          res = { type: "error", sql: text, errno: err.errno, sqlstate: err.sqlstate, text: err.message, message: `ERROR ${err.errno} (${err.sqlstate}): ${err.message}` };
        }
        results.push(res);
        if (failed) break;
      }
      return { results, failed };
    }

    table(name) {
      const t = this.state.tables[name];
      if (!t) throw new SqlError(1146, `Table '${this.state.dbName}.${name}' doesn't exist`, "42S02");
      return t;
    }
    column(t, name, clause) {
      const c = t.cols.find(col => col.name === name);
      if (!c) throw new SqlError(1054, `Unknown column '${name}' in '${clause}'`, "42S22");
      return c;
    }
    ctx(t, row, extra) { return { sess: this, table: t, alias: null, row, clause: "field list", agg: null, ...extra }; }

    snapshot() { return JSON.stringify(this.state.tables); }
    restore(snap) {
      const restored = JSON.parse(snap), current = this.state.tables;
      for (const name of Object.keys(restored)) if (current[name]) restored[name].autoInc = Math.max(restored[name].autoInc, current[name].autoInc);
      this.state.tables = restored;
    }

    run(text) {
      const q = parseStatement(text);
      if (["insert", "update", "delete"].includes(q.type)) return this.atomic(q);
      switch (q.type) {
        case "select": return this.select(q);
        case "truncate": return this.implicitCommit(() => this.truncate(q));
        case "createTable": return this.implicitCommit(() => this.createTable(q));
        case "dropTable": return this.implicitCommit(() => this.dropTable(q));
        case "createDb": {
          this.tx = null;
          if (this.state.dbs.includes(q.name)) { if (q.ifNot) return this.finish(okResult()); throw new SqlError(1007, `Can't create database '${q.name}'; database exists`, "HY000"); }
          this.state.dbs.push(q.name); return this.finish(okResult({ message: "Query OK, 1 row affected" }));
        }
        case "use": {
          if (!this.state.dbs.includes(q.name)) throw new SqlError(1049, `Unknown database '${q.name}'`, "42000");
          this.state.dbName = q.name; return okResult({ message: "Database changed" });
        }
        case "showTables": return this.rowsResult([`Tables_in_${this.state.dbName}`], Object.keys(this.state.tables).sort().map(n => [n]));
        case "describe": return this.describe(this.table(q.table));
        case "tx": return this.transaction(q.action);
        case "setVar": { this.vars[q.name] = evalNode(q.e, this.ctx(null, null)); return okResult({ message: "Query OK, 0 rows affected" }); }
        case "setFlag": return this.setFlag(q);
        default: return okResult();
      }
    }

    finish(result) { this.rowCount = result.affectedRows > 0 ? result.affectedRows : 0; return result; }
    implicitCommit(fn) { this.tx = null; return fn(); }
    rowsResult(columns, rows) { this.rowCount = -1; return { type: "rows", columns, rows, message: `${plural(rows.length, "row", "rows")} in set` }; }

    atomic(q) {
      const snap = this.snapshot();
      if (!this.autocommit && !this.tx) this.tx = snap;
      try { return this[q.type](q); }
      catch (err) { this.restore(snap); throw err; }
    }

    transaction(action) {
      if (action === "begin") this.tx = this.snapshot();
      else { if (action === "rollback" && this.tx) this.restore(this.tx); this.tx = null; }
      this.rowCount = -1;
      return okResult({ message: "Query OK, 0 rows affected" });
    }

    setFlag(q) {
      const on = truthy(evalNode(q.e, this.ctx(null, null)));
      if (q.name === "autocommit") { this.autocommit = on; if (on) this.tx = null; }
      else this.fkChecks = on;
      return okResult();
    }

    describe(t) {
      const primary = (t.keys.find(k => k.primary) || { cols: [] }).cols;
      const rows = t.cols.map(c => {
        const uniq = t.keys.find(k => !k.primary && k.cols[0] === c.name);
        const key = primary.includes(c.name) ? "PRI" : uniq ? (uniq.cols.length === 1 ? "UNI" : "MUL") : t.fks.some(f => f.cols[0] === c.name) ? "MUL" : "";
        let def = null;
        if (c.hasDefault && c.def && !(c.def.k === "lit" && c.def.v === null)) def = c.def.k === "fn" ? c.def.name : c.def.k === "un" ? String(-c.def.e.v) : (c.type === "DECIMAL" ? Number(c.def.v).toFixed(c.scale) : String(c.def.v));
        return [c.name, typeText(c), c.notNull ? "NO" : "YES", key, def, c.autoInc ? "auto_increment" : ""];
      });
      return this.rowsResult(["Field", "Type", "Null", "Key", "Default", "Extra"], rows);
    }

    createTable(q) {
      if (this.state.tables[q.name]) { if (q.ifNot) return this.finish(okResult()); throw new SqlError(1050, `Table '${q.name}' already exists`); }
      const names = new Set();
      for (const c of q.cols) { if (names.has(c.name)) throw new SqlError(1060, `Duplicate column name '${c.name}'`); names.add(c.name); }
      const keys = q.keys.map(k => ({ ...k }));
      if (keys.filter(k => k.primary).length > 1) throw new SqlError(1068, "Multiple primary key defined", "42000");
      for (const k of keys) for (const col of k.cols) if (!names.has(col)) throw new SqlError(1072, `Key column '${col}' doesn't exist in table`, "42000");
      for (const k of keys.filter(k => k.primary)) for (const col of k.cols) q.cols.find(c => c.name === col).notNull = true;
      const fks = q.fks.map((fk, i) => ({ ...fk, name: fk.name || `${q.name}_ibfk_${i + 1}` }));
      for (const fk of fks) {
        const parent = fk.refTable === q.name ? { cols: q.cols, keys } : this.state.tables[fk.refTable];
        if (!parent) throw new SqlError(1824, `Failed to open the referenced table '${fk.refTable}'`);
        const indexed = parent.keys.some(k => k.cols.join() === fk.refCols.join());
        if (!indexed || fk.cols.length !== fk.refCols.length || fk.cols.some(c => !names.has(c))) throw new SqlError(1822, `Failed to add the foreign key constraint. Missing index for constraint '${fk.name}' in the referenced table '${fk.refTable}'`);
        if ([fk.onDelete, fk.onUpdate].includes("SET NULL")) for (const c of fk.cols) if (q.cols.find(col => col.name === c).notNull) throw new SqlError(1830, `Column '${c}' cannot be NOT NULL: needed in a foreign key constraint '${fk.name}' SET NULL`);
      }
      let unnamed = 0;
      const checks = q.checks.map(c => ({ name: c.name || `${q.name}_chk_${++unnamed}`, e: c.e }));
      this.state.tables[q.name] = { name: q.name, cols: q.cols, keys, fks, checks, rows: [], autoInc: Number(q.autoStart) || 1 };
      return this.finish(okResult({ message: "Query OK, 0 rows affected" }));
    }

    dropTable(q) {
      for (const name of q.names) {
        if (!this.state.tables[name]) { if (q.ifExists) continue; throw new SqlError(1051, `Unknown table '${this.state.dbName}.${name}'`); }
        for (const other of Object.values(this.state.tables)) {
          const fk = other.fks.find(f => f.refTable === name && other.name !== name);
          if (fk && this.fkChecks) throw new SqlError(3730, `Cannot drop table '${name}' referenced by a foreign key constraint '${fk.name}' on table '${other.name}'.`);
        }
        delete this.state.tables[name];
      }
      return this.finish(okResult({ message: "Query OK, 0 rows affected" }));
    }

    truncate(q) {
      const t = this.table(q.table);
      if (this.fkChecks) for (const other of Object.values(this.state.tables)) {
        const fk = other.fks.find(f => f.refTable === t.name && other.name !== t.name);
        if (fk) throw new SqlError(1701, `Cannot truncate a table referenced in a foreign key constraint (${q$(this.state.dbName)}.${q$(other.name)}, ${fkText(fk).replace(/REFERENCES `/, `REFERENCES ${q$(this.state.dbName)}.\``)})`, "42000");
      }
      t.rows = []; t.autoInc = 1;
      return this.finish(okResult({ message: "Query OK, 0 rows affected" }));
    }

    // ----- constraint -----
    checkRow(t, row) {
      for (const c of t.checks) {
        const v = evalNode(c.e, this.ctx(t, row, { clause: "check constraint" }));
        if (v !== null && !truthy(v)) throw new SqlError(3819, `Check constraint '${c.name}' is violated.`);
      }
    }
    checkUnique(t, row, self) {
      for (const k of t.keys) {
        const vals = k.cols.map(c => row[c]);
        if (vals.some(v => v === null)) continue;
        const clash = t.rows.find(r => r !== self && k.cols.every((c, i) => keyText(r[c]) === keyText(vals[i])));
        if (clash) throw new SqlError(1062, `Duplicate entry '${vals.join("-")}' for key '${t.name}.${k.name}'`);
      }
    }
    checkParents(t, row) {
      if (!this.fkChecks) return;
      for (const fk of t.fks) {
        const vals = fk.cols.map(c => row[c]);
        if (vals.some(v => v === null)) continue;
        const parent = this.state.tables[fk.refTable];
        if (!parent.rows.some(pr => fk.refCols.every((c, i) => keyText(pr[c]) === keyText(vals[i])))) throw new SqlError(1452, `Cannot add or update a child row: a foreign key constraint fails (${q$(this.state.dbName)}.${q$(t.name)}, ${fkText(fk)})`);
      }
    }
    referencing(t) {
      const out = [];
      for (const ct of Object.values(this.state.tables)) for (const fk of ct.fks) if (fk.refTable === t.name) out.push({ ct, fk });
      return out;
    }
    childRows(ct, fk, row) { return ct.rows.filter(cr => fk.cols.every((c, i) => cr[c] !== null && keyText(cr[c]) === keyText(row[fk.refCols[i]]))); }
    parentBlock(ct, fk) { return new SqlError(1451, `Cannot delete or update a parent row: a foreign key constraint fails (${q$(this.state.dbName)}.${q$(ct.name)}, ${fkText(fk)})`); }

    deleteRow(t, row) {
      if (this.fkChecks) for (const { ct, fk } of this.referencing(t)) {
        const kids = this.childRows(ct, fk, row);
        if (!kids.length) continue;
        if (fk.onDelete === "CASCADE") kids.forEach(k => { if (ct.rows.includes(k)) this.deleteRow(ct, k); });
        else if (fk.onDelete === "SET NULL") kids.forEach(k => fk.cols.forEach(c => { k[c] = null; }));
        else throw this.parentBlock(ct, fk);
      }
      const at = t.rows.indexOf(row);
      if (at >= 0) t.rows.splice(at, 1);
    }

    propagateUpdate(t, before, after) {
      if (!this.fkChecks) return;
      for (const { ct, fk } of this.referencing(t)) {
        if (fk.refCols.every(c => keyText(before[c]) === keyText(after[c]))) continue;
        const kids = this.childRows(ct, fk, before);
        if (!kids.length) continue;
        if (fk.onUpdate === "CASCADE") kids.forEach(k => { const old = { ...k }; fk.cols.forEach((c, i) => { k[c] = after[fk.refCols[i]]; }); this.propagateUpdate(ct, old, k); });
        else if (fk.onUpdate === "SET NULL") kids.forEach(k => fk.cols.forEach(c => { k[c] = null; }));
        else throw this.parentBlock(ct, fk);
      }
    }

    defaultFor(c) {
      if (c.autoInc) return null;
      if (c.hasDefault) return evalNode(c.def, this.ctx(null, null));
      if (!c.notNull) return null;
      throw new SqlError(1364, `Field '${c.name}' doesn't have a default value`);
    }

    // ----- DML -----
    insert(q) {
      const t = this.table(q.table);
      const targets = q.columns ? q.columns.map(n => this.column(t, n, "field list")) : t.cols;
      let firstAuto = null;
      q.rows.forEach((exprs, ri) => {
        const rowNo = ri + 1;
        if (exprs.length !== targets.length) throw new SqlError(1136, `Column count doesn't match value count at row ${rowNo}`);
        const nodes = new Map(targets.map((c, i) => [c.name, exprs[i]]));
        const row = {};
        for (const c of t.cols) {
          const node = nodes.get(c.name);
          let v = !node || node.k === "default" ? this.defaultFor(c) : evalNode(node, this.ctx(null, null));
          if (c.autoInc && (v === null || num(v) === 0)) { v = t.autoInc++; if (firstAuto === null) firstAuto = v; }
          else if (v === null) { if (c.notNull) throw new SqlError(1048, `Column '${c.name}' cannot be null`); }
          else { v = coerce(c, v, rowNo); if (c.autoInc && v >= t.autoInc) t.autoInc = v + 1; }
          row[c.name] = v;
        }
        this.checkRow(t, row); this.checkUnique(t, row, null); this.checkParents(t, row);
        t.rows.push(row);
      });
      const n = q.rows.length;
      if (firstAuto !== null) this.lastInsertId = firstAuto;
      this.rowCount = n;
      return okResult({ affectedRows: n, insertId: firstAuto, message: `Query OK, ${plural(n, "row", "rows")} affected` + (n > 1 ? `\nRecords: ${n}  Duplicates: 0  Warnings: 0` : "") });
    }

    update(q) {
      const t = this.table(q.table);
      const sets = q.sets.map(s => ({ c: this.column(t, s.col, "field list"), e: s.e }));
      const targets = t.rows.filter(r => !q.where || truthy(evalNode(q.where, this.ctx(t, r, { clause: "where clause" }))));
      let changed = 0;
      for (const row of targets) {
        const next = { ...row };
        for (const s of sets) {
          let v = s.e.k === "default" ? this.defaultFor(s.c) : evalNode(s.e, this.ctx(t, next));
          if (v === null) { if (s.c.notNull) throw new SqlError(1048, `Column '${s.c.name}' cannot be null`); }
          else v = coerce(s.c, v, 1);
          next[s.c.name] = v;
        }
        if (t.cols.every(c => same(row[c.name], next[c.name]))) continue;
        this.checkRow(t, next); this.checkUnique(t, next, row);
        if (t.fks.some(fk => fk.cols.some(c => !same(row[c], next[c])))) this.checkParents(t, next);
        this.propagateUpdate(t, row, next);
        Object.assign(row, next); changed++;
      }
      this.rowCount = changed;
      return okResult({ affectedRows: changed, matched: targets.length, message: `Query OK, ${plural(changed, "row", "rows")} affected\nRows matched: ${targets.length}  Changed: ${changed}  Warnings: 0` });
    }

    delete(q) {
      const t = this.table(q.table);
      const targets = t.rows.filter(r => !q.where || truthy(evalNode(q.where, this.ctx(t, r, { clause: "where clause" }))));
      let n = 0;
      for (const row of targets) { if (!t.rows.includes(row)) continue; this.deleteRow(t, row); n++; }
      this.rowCount = n;
      return okResult({ affectedRows: n, message: `Query OK, ${plural(n, "row", "rows")} affected` });
    }

    // ----- SELECT (satu tabel) -----
    select(q) {
      const t = q.table ? this.table(q.table) : null;
      const base = t ? t.rows : [{}];
      const rows = q.where ? base.filter(r => truthy(evalNode(q.where, this.ctx(t, r, { alias: q.alias, clause: "where clause" })))) : base;
      const names = [], exprs = [];
      for (const item of q.items) {
        if (!item.star) { names.push(item.alias); exprs.push(item.expr); continue; }
        if (!t) throw new SqlError(1096, "No tables used", "HY000");
        t.cols.forEach(c => { names.push(c.name); exprs.push({ k: "col", table: null, name: c.name }); });
      }
      let units;
      if (q.group.length || exprs.some(hasAggregate)) {
        const groups = new Map();
        for (const r of rows) {
          const key = q.group.map(g => keyText(evalNode(g, this.ctx(t, r, { alias: q.alias, clause: "group statement" })))).join("");
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(r);
        }
        if (!q.group.length && !groups.size) groups.set("", []);
        units = [...groups.values()].map(g => ({ row: g[0] || {}, agg: g }));
      } else units = rows.map(r => ({ row: r, agg: null }));
      const mk = (u, extra) => this.ctx(t, u.row, { alias: q.alias, agg: u.agg, ...extra });
      let out = units.map(u => ({ u, values: exprs.map(e => evalNode(e, mk(u))) }));
      if (q.order.length) {
        const keyOf = (rec, o) => {
          if (o.e.k === "lit" && typeof o.e.v === "number") return rec.values[o.e.v - 1];
          const at = o.e.k === "col" && !o.e.table ? names.findIndex(n => n.toLowerCase() === o.e.name) : -1;
          return at >= 0 ? rec.values[at] : evalNode(o.e, mk(rec.u, { clause: "order clause" }));
        };
        out = out.map(rec => ({ ...rec, keys: q.order.map(o => keyOf(rec, o)) }));
        out.sort((a, b) => {
          for (let i = 0; i < q.order.length; i++) {
            const x = a.keys[i], y = b.keys[i];
            const c = x === null ? (y === null ? 0 : -1) : y === null ? 1 : cmp(x, y);
            if (c) return q.order[i].desc ? -c : c;
          }
          return 0;
        });
      }
      const from = q.offset || 0, page = q.limit === null ? out.slice(from) : out.slice(from, from + q.limit);
      return this.rowsResult(names, page.map(r => r.values));
    }
  }

  const createSession = () => new Session();

  // ---------- kasus uji ----------
  const sameRows = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Array.isArray(x) ? sameRows(x, b[i]) : same(x, b[i]));
  const show = value => JSON.stringify(value);

  function evaluateCase(c, session, script) {
    const e = c.expect || {};
    if (e.ok) {
      const bad = script.results.find(r => r.type === "error");
      return { pass: !script.failed, detail: bad ? bad.message : "Skrip berjalan tanpa error." };
    }
    if (e.script) {
      const hit = script.results.some(r => r.type === "rows" && sameRows(r.rows, e.script.rows));
      return { pass: hit, detail: hit ? "Keluaran verifikasi ditemukan pada skrip." : "Tidak ada keluaran SELECT pada skrip yang sesuai dengan hasil yang diminta." };
    }
    const out = session.exec(c.run), last = out.results[out.results.length - 1];
    if (!last) return { pass: false, detail: "Tidak ada hasil." };
    if (e.error !== undefined) return { pass: last.type === "error" && last.errno === e.error, detail: last.type === "error" ? last.message : `Diharapkan error ${e.error}, tetapi pernyataan berhasil.` };
    if (last.type === "error") return { pass: false, detail: last.message };
    if (e.rows) return { pass: last.type === "rows" && sameRows(last.rows, e.rows), detail: last.type === "rows" ? `Diperoleh: ${show(last.rows)}` : "Pernyataan verifikasi tidak menghasilkan baris." };
    if ("scalar" in e) {
      const ok = last.type === "rows" && last.rows.length === 1 && last.rows[0].length === 1 && same(last.rows[0][0], e.scalar);
      return { pass: ok, detail: last.type === "rows" ? `Diperoleh: ${show(last.rows)}` : "Pernyataan verifikasi tidak menghasilkan baris." };
    }
    if ("affected" in e) return { pass: last.type === "ok" && last.affectedRows === e.affected, detail: `Baris terpengaruh: ${last.affectedRows}` };
    return { pass: false, detail: "Kasus uji tidak dikenali." };
  }

  function runCases({ setup, sql, cases, threshold = THRESHOLD }) {
    const base = createSession();
    const prepared = base.exec(setup || "");
    if (prepared.failed) throw new Error(`Setup kasus uji gagal: ${prepared.results[prepared.results.length - 1].message}`);
    const script = base.exec(sql || "");
    const results = (cases || []).map(c => ({ label: c.label, ...evaluateCase(c, base.clone(), script) }));
    const passedCount = results.filter(r => r.pass).length, total = results.length;
    return { passed: total > 0 && passedCount / total >= threshold - 1e-9, passedCount, total, ratio: total ? passedCount / total : 0, results, script };
  }

  return { THRESHOLD, VERSION, LIMITATIONS, SqlError, createSession, runCases, splitStatements };
});
