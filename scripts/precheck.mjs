#!/usr/bin/env node
/**
 * Локальный гейт перед push — то же, что гоняет CI, только на машине.
 *
 * Зачем он появился (2026-09-05): все GitHub-аккаунты заблокированы, PR открыть
 * некому, а push в веткуCI не запускает вовсе — проверки на GitHub сейчас не
 * происходит НИ РАЗУ. Пока это так, единственная проверка — здесь.
 *
 *   npm run precheck
 *
 * Шаги идут от быстрых к медленным и падают на первом красном: смысл гейта в
 * том, чтобы узнать о поломке за секунды, а не через две минуты сборки.
 *
 *   1. рабочее дерево      — что именно уедет в push
 *   2. секреты             — ключи в отслеживаемых файлах
 *   3. package-lock         — не отстал ли от package.json (в CI это `npm ci`)
 *   4. npm run audit:gate  — уязвимости зависимостей
 *   5. npm run build       — синтаксис всех роутов без env
 *   6. npx playwright test — весь набор тестов
 *
 * ⚠ Чего он НЕ заменяет: gitleaks в CI сканирует всю историю репозитория, а
 * здесь проверяется только текущее состояние файлов. Ключ, закоммиченный и
 * удалённый следующим коммитом, отсюда не виден — из публичного репозитория он
 * при этом никуда не делся.
 */
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

const t0 = Date.now();
const args = process.argv.slice(2);
const skipTests = args.includes('--no-tests');
const results = [];
const NL = String.fromCharCode(10);

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
};

function step(name, fn) {
  process.stdout.write(`${c.dim('▸')} ${name}… `);
  const started = Date.now();
  try {
    const note = fn();
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${c.ok('ок')} ${c.dim(`(${secs} с)`)}${note ? ` ${c.dim(note)}` : ''}`);
    results.push({ name, ok: true });
  } catch (e) {
    console.log(c.bad('ПРОВАЛ'));
    console.log(`\n${c.bad('┌─ ' + name)}`);
    console.log(String(e.message || e).split('\n').map((l) => `${c.bad('│')} ${l}`).join('\n'));
    console.log(c.bad('└─'));
    results.push({ name, ok: false });
    summary(1);
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

function summary(code) {
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('');
  if (code === 0) {
    console.log(c.ok(`✔ Всё зелёное за ${secs} с — можно пушить.`));
    console.log(c.dim('  Напомню: на GitHub эту ветку никто не проверит, пока не открыт PR.'));
  } else {
    console.log(c.bad(`✘ Гейт не пройден (${secs} с). Push не делаем, пока не почините.`));
  }
  process.exit(code);
}

// ─── 1. рабочее дерево ───────────────────────────────────────────────────────
step('рабочее дерево', () => {
  const dirty = run('git status --porcelain').trim();
  if (!dirty) return 'чисто';
  const files = dirty.split('\n').length;
  return `${files} файл(ов) с изменениями — они и уедут`;
});

// ─── 2. секреты ──────────────────────────────────────────────────────────────
// Паттерны — только те, у которых есть узнаваемая форма. Гейт, который врёт,
// перестают читать: лучше пропустить бесформенный секрет, чем краснеть впустую.
const SECRET_PATTERNS = [
  [/\bre_[A-Za-z0-9_]{16,}/, 'ключ Resend (re_…)'],
  [/\beyJhbGciOi[A-Za-z0-9_.\-]{20,}/, 'JWT — похоже на ключ Supabase'],
  [/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, 'приватный ключ'],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}/, 'секретный ключ платёжной системы'],
  [/\bwhsec_[A-Za-z0-9]{16,}/, 'ключ подписи вебхука'],
  [/\bghp_[A-Za-z0-9]{30,}/, 'токен GitHub (ghp_…)'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, 'токен GitHub (github_pat_…)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'ключ AWS'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'токен Slack'],
];
// .env.example — плейсхолдеры по назначению файла; lock-файл состоит из хешей.
const SECRET_SKIP = [/^\.env\.example$/, /^package-lock\.json$/];

step('секреты в файлах', () => {
  const files = run('git ls-files').split('\n').filter(Boolean)
    .filter((f) => !SECRET_SKIP.some((re) => re.test(f)));
  const hits = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue; // бинарник
    text.split('\n').forEach((line, i) => {
      for (const [re, what] of SECRET_PATTERNS) {
        if (re.test(line)) hits.push(`${f}:${i + 1} — ${what}`);
      }
    });
  }
  const env = run('git ls-files').split('\n').filter((f) => /^\.env(\.|$)/.test(f) && f !== '.env.example');
  if (env.length) hits.push(`${env.join(', ')} — файл с переменными окружения под контролем версий`);
  if (hits.length) {
    // Сам секрет не печатаем — только где он: вывод может попасть в лог или в чат.
    throw new Error(`Похоже на секреты (значения намеренно не показаны):\n${hits.join('\n')}`);
  }
  return `${files.length} файлов`;
});

// ─── 3. package-lock ─────────────────────────────────────
// В CI первым шагом идёт `npm ci`: он падает, если lock разошёлся с package.json.
// Локально это дорого (сносит node_modules), поэтому сверяем сами — и не время
// правки файла (оно шумит от любой правки скриптов), а сами диапазоны версий.
step('package-lock', () => {
  if (!fs.existsSync('package-lock.json')) {
    throw new Error('package-lock.json отсутствует — CI встанет на npm ci');
  }
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const root = (lock.packages && lock.packages['']) || {};
  const bad = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const want = pkg[field] || {};
    const have = root[field] || {};
    for (const [name, range] of Object.entries(want)) {
      if (have[name] !== range) {
        bad.push(name + ": package.json «" + range + "», lock «" + (have[name] || "нет") + "»");
      }
    }
    for (const name of Object.keys(have)) {
      if (!(name in want)) bad.push(name + ': есть в lock, нет в package.json');
    }
  }
  if (bad.length) {
    throw new Error(
      ['package-lock.json разошёлся с package.json — CI упадёт на npm ci.',
       'Почините: npm install', ''].concat(bad).join(NL)
    );
  }
  return Object.keys(root.dependencies || {}).length + ' зависимостей сходятся';
});

// ─── 4-6. то же, что в CI ────────────────────────────────────────────────────
function npmStep(label, cmd) {
  step(label, () => {
    const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stdout || '') + (r.stderr || ''));
    return null;
  });
}

npmStep('уязвимости зависимостей (audit:gate)', 'npm run audit:gate --silent');
npmStep('сборка (next build)', 'npm run build');
if (skipTests) {
  console.log(`${c.dim('▸')} тесты… ${c.warn('пропущены (--no-tests)')}`);
} else {
  npmStep('тесты (playwright)', 'npx playwright test');
}

summary(0);
