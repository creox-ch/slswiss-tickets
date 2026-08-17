#!/usr/bin/env node
/**
 * Гейт безопасности зависимостей: `npm run audit:gate`.
 *
 * Запускает `npm audit --json`, сверяет находки уровня high/critical
 * с .audit-allowlist.json и падает на всём, что не принято явно.
 * Логика решения — lib/audit-gate.js (она же покрыта юнит-тестами).
 *
 * Печатает по-русски и без секретов: в выводе npm audit их нет, но и лишнего
 * сюда попасть не должно — логи Actions в public-репо читает кто угодно.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { collectVulnerabilities, evaluate, validateAllowlistEntry } from '../lib/audit-gate.js';

const ROOT = process.cwd();
const ALLOWLIST_PATH = path.join(ROOT, '.audit-allowlist.json');

function runNpmAudit() {
  // npm audit возвращает код 1 при находках — для нас это нормальный результат,
  // а не сбой. Сбоем считаем только пустой/неразбираемый stdout.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, ['audit', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (!res.stdout) {
    console.error('npm audit не дал вывода:', res.error || res.stderr);
    process.exit(2);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    console.error('не разобрали вывод npm audit:', e.message);
    process.exit(2);
  }
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  const entries = parsed.entries || [];
  const broken = entries.flatMap((e) => {
    const problems = validateAllowlistEntry(e);
    return problems.length ? [`${e?.package || '(без имени)'}: ${problems.join(', ')}`] : [];
  });
  if (broken.length) {
    console.error('❌ .audit-allowlist.json заполнен неверно:');
    broken.forEach((b) => console.error('   ·', b));
    process.exit(2);
  }
  return entries;
}

const audit = runNpmAudit();
const vulnerabilities = collectVulnerabilities(audit);
const { blocking, accepted, stale } = evaluate({
  vulnerabilities,
  allowlist: readAllowlist(),
  now: new Date(),
});

for (const a of accepted) {
  console.log(`⚪ ${a.name} (${a.severity}, ${a.advisories} шт.) — принято до ${a.entry.until}`);
  console.log(`   ${a.entry.issue || 'задача не указана'}`);
}
for (const s of stale) {
  // Не роняем: неактуальная запись безопасна. Но пусть мозолит глаза.
  console.log(`🧹 ${s.package} — уязвимости больше нет, запись из allowlist можно убрать`);
}

if (!blocking.length) {
  console.log(`\n✅ Новых уязвимостей уровня high/critical нет (принято: ${accepted.length}).`);
  process.exit(0);
}

console.error('\n❌ Гейт безопасности не пройден:\n');
for (const b of blocking) {
  console.error(`   ${b.name} — ${b.severity}, версии ${b.range}`);
  console.error(`   ${b.why}\n`);
}
console.error('Что делать: обновить пакет (npm audit fix / overrides) — или, если');
console.error('обновиться нельзя, добавить запись в .audit-allowlist.json с причиной,');
console.error('датой пересмотра и задачей. Молча заглушить не получится, и это намеренно.');
process.exit(1);
