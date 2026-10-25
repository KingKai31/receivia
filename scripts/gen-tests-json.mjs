// Writes src/generated/tests.json for the /how-it-works page: live test counts, the backtest WAPE on the demo
// story and the demo forecast band. Runs before every build (npm run build). Never fails the build: when a step
// cannot run it keeps the last value in the committed file. Skip the test runs with TESTS_JSON=skip.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = 'src/generated/tests.json';
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const out = { ...prev, generatedAt: new Date().toISOString() };
const sh = (cmd, args, timeout) =>
  spawnSync(cmd, args, { encoding: 'utf8', shell: true, timeout, maxBuffer: 1 << 28 });

function vitestCount(args) {
  const file = path.join(os.tmpdir(), `vitest-${Date.now()}-${Math.random()}.json`);
  const r = sh(
    'npx',
    ['vitest', 'run', ...args, '--reporter=json', `--outputFile="${file}"`],
    600000,
  );
  if (!fs.existsSync(file)) return null;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(file, { force: true });
  void r;
  return {
    passed: j.numPassedTests,
    failed: j.numFailedTests,
    total: j.numTotalTests,
    files: j.numTotalTestSuites,
  };
}

if (process.env.TESTS_JSON !== 'skip') {
  const unit = vitestCount(['--exclude', '"tests/db/**"']);
  if (unit) out.unit = unit;
  const db = vitestCount(['--config', 'vitest.db.config.ts']);
  // Local PGlite run of the real migrations. The real-Postgres run (npm run test:db:remote) is recorded by hand.
  if (db && db.total > 0) out.dbLocal = db;
  const list = sh('npx', ['playwright', 'test', '--list'], 120000);
  const m = /Total: (\d+) tests? in (\d+) files?/.exec(list.stdout ?? '');
  if (m) out.e2e = { total: Number(m[1]), files: Number(m[2]) };
}

try {
  const story = await import(pathToFileURL(path.resolve('supabase/seed/demo-story.mjs')).href);
  const lib = await import(pathToFileURL(path.resolve('supabase/seed/forecast.bundle.js')).href);
  const today = story.istToday();
  const opening = story.calibrateOpening(lib, today);
  const d = story.forecastInput(lib, today, opening);
  const bt = lib.backtest({ history: d.hist, customers: d.customers, today });
  const f = lib.simulate(d.input);
  // Monthly = blocks of 4 weeks (same rule as backtest.ts wapeMonthly; the committed bundle may be older).
  let errM = 0;
  for (let i = 0; i < bt.weeks.length; i += 4)
    errM += Math.abs(bt.weeks.slice(i, i + 4).reduce((a, r) => a + r.actual - r.forecast, 0));
  const actual = bt.weeks.reduce((a, r) => a + r.actual, 0);
  out.backtest = {
    wape: bt.wape,
    wapeMonthly: actual > 0 ? errM / actual : null,
    weeks: bt.weeks.length,
    asOf: bt.asOf,
    today,
  };
  out.demoBand = {
    runs: f.runs,
    bufferPaise: f.bufferPaise,
    weeks: f.weeks.map((w) => ({
      week: w.week,
      p10: w.closing.p10,
      p50: w.closing.p50,
      p90: w.closing.p90,
    })),
  };
} catch (e) {
  console.warn('gen-tests-json: backtest skipped:', e.message);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(
  'wrote',
  OUT,
  JSON.stringify({ unit: out.unit, dbLocal: out.dbLocal, e2e: out.e2e, wape: out.backtest?.wape }),
);
