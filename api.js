// Feather Vote API: shared ballots for the flock, with options and votes.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA = path.join(__dirname, 'data');
try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {}
const db = new Database(path.join(DATA, 'votes.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS ballots (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    bird TEXT NOT NULL DEFAULT 'gurt',
    options TEXT NOT NULL,
    created TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ballot_id TEXT NOT NULL,
    option TEXT NOT NULL,
    bird TEXT NOT NULL DEFAULT 'gurt',
    at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS votes_ballot ON votes(ballot_id);
`);

const stmt = {
  list: db.prepare('SELECT * FROM ballots ORDER BY created DESC LIMIT 200'),
  get: db.prepare('SELECT * FROM ballots WHERE id = ?'),
  insert: db.prepare('INSERT INTO ballots (id,title,bird,options,created,closed) VALUES (@id,@title,@bird,@options,@created,@closed)'),
  close: db.prepare('UPDATE ballots SET closed = 1 WHERE id = ?'),
  remove: db.prepare('DELETE FROM ballots WHERE id = ?'),
  votesAll: db.prepare('SELECT * FROM votes ORDER BY id ASC LIMIT 5000'),
  votesFor: db.prepare('SELECT * FROM votes WHERE ballot_id = ? ORDER BY id ASC'),
  voteAdd: db.prepare('INSERT INTO votes (ballot_id,option,bird,at) VALUES (?,?,?,?)'),
  voteDel: db.prepare('DELETE FROM votes WHERE ballot_id = ? AND bird = ?')
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 100000) req.destroy(); });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch (e) { body = {}; }
    cb(body);
  });
}
function publicBallot(r, votes) {
  const options = JSON.parse(r.options || '[]');
  const counts = {};
  options.forEach(o => { counts[o] = 0; });
  let total = 0;
  votes.filter(v => v.ballot_id === r.id).forEach(v => {
    if (counts[v.option] === undefined) counts[v.option] = 0;
    counts[v.option]++; total++;
  });
  return {
    id: r.id, title: r.title, bird: r.bird, options, created: r.created,
    closed: !!r.closed, counts, total
  };
}

module.exports = function handler(req, res, seg) {
  const route = seg[0];

  if (req.method === 'GET' && route === 'ballots') {
    const rows = stmt.list.all();
    const votes = stmt.votesAll.all();
    const ballots = rows.map(r => publicBallot(r, votes));
    return json(res, 200, {
      ballots,
      total: ballots.length,
      votes: votes.length,
      birds: new Set(votes.map(v => v.bird)).size
    });
  }

  if (req.method === 'POST' && route === 'ballots' && seg[1] === 'new') {
    readBody(req, body => {
      const title = String(body.title || '').trim().slice(0, 120);
      const options = (Array.isArray(body.options) ? body.options : [])
        .map(o => String(o || '').trim().slice(0, 80)).filter(Boolean).slice(0, 10);
      if (!title) return json(res, 400, { error: 'title required' });
      if (options.length < 2) return json(res, 400, { error: 'at least two options' });
      const ballot = {
        id: 'fb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        title, bird: String(body.bird || 'gurt').trim().slice(0, 40) || 'gurt',
        options: JSON.stringify(options), created: new Date().toISOString(), closed: 0
      };
      stmt.insert.run(ballot);
      return json(res, 200, { ok: true, ballot: publicBallot(ballot, []) });
    });
    return true;
  }

  if (req.method === 'POST' && route === 'ballots' && seg[2] === 'vote') {
    const row = stmt.get.get(seg[1]);
    if (!row) return json(res, 404, { error: 'no such ballot' });
    if (row.closed) return json(res, 400, { error: 'ballot is closed' });
    readBody(req, body => {
      const option = String(body.option || '').trim().slice(0, 80);
      const options = JSON.parse(row.options || '[]');
      if (options.indexOf(option) < 0) return json(res, 400, { error: 'bad option' });
      const bird = String(body.bird || 'gurt').trim().slice(0, 40) || 'gurt';
      stmt.voteDel.run(row.id, bird);
      stmt.voteAdd.run(row.id, option, bird, new Date().toISOString());
      const votes = stmt.votesFor.all(row.id);
      return json(res, 200, { ok: true, ballot: publicBallot(stmt.get.get(row.id), votes) });
    });
    return true;
  }

  if (req.method === 'POST' && route === 'ballots' && seg[2] === 'close') {
    const row = stmt.get.get(seg[1]);
    if (!row) return json(res, 404, { error: 'no such ballot' });
    stmt.close.run(seg[1]);
    return json(res, 200, { ok: true, ballot: publicBallot(stmt.get.get(seg[1]), stmt.votesFor.all(seg[1])) });
  }

  if (req.method === 'POST' && route === 'ballots' && seg[2] === 'delete') {
    const row = stmt.get.get(seg[1]);
    if (!row) return json(res, 404, { error: 'no such ballot' });
    stmt.remove.run(seg[1]);
    return json(res, 200, { ok: true, removed: seg[1] });
  }

  return false;
};
