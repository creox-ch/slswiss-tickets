/**
 * Решение гейта безопасности: что роняет сборку, а что принято.
 *
 * Смысл этих проверок — чтобы «принято» не превратилось в «заглушено навсегда».
 * Поэтому здесь три сценария, каждый из которых однажды случается: новая
 * уязвимость, истёкший срок принятия и новая дыра в уже принятом пакете.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  collectVulnerabilities,
  evaluate,
  validateAllowlistEntry,
  GATED_SEVERITIES,
} from '../../lib/audit-gate.js';

const NOW = new Date('2026-08-17T00:00:00.000Z');

const auditJson = {
  vulnerabilities: {
    next: {
      name: 'next',
      severity: 'high',
      range: '9.5.0 - 15.5.20',
      via: [{ title: 'SSRF' }, { title: 'DoS' }],
    },
    lodash: { name: 'lodash', severity: 'moderate', range: '<4.17.21', via: [{ title: 'proto' }] },
  },
};

test('в гейт попадают только high и critical', () => {
  const vulns = collectVulnerabilities(auditJson);
  expect(vulns.map((v) => v.name)).toEqual(['next']);
  expect(GATED_SEVERITIES).toEqual(['high', 'critical']);
});

test('уязвимость без записи в allowlist роняет сборку', () => {
  const { blocking } = evaluate({
    vulnerabilities: collectVulnerabilities(auditJson),
    allowlist: [],
    now: NOW,
  });
  expect(blocking).toHaveLength(1);
  expect(blocking[0].why).toContain('решения по ней нет');
});

test('принятая уязвимость в срок — сборка зелёная', () => {
  const { blocking, accepted } = evaluate({
    vulnerabilities: collectVulnerabilities(auditJson),
    allowlist: [{ package: 'next', advisories: 2, until: '2026-10-01', reason: 'x' }],
    now: NOW,
  });
  expect(blocking).toHaveLength(0);
  expect(accepted).toHaveLength(1);
});

test('истёкший срок принятия роняет сборку', () => {
  // Это главный предохранитель: «примем на месяц» без него живёт годами.
  const { blocking } = evaluate({
    vulnerabilities: collectVulnerabilities(auditJson),
    allowlist: [{ package: 'next', advisories: 2, until: '2026-08-01', reason: 'x' }],
    now: NOW,
  });
  expect(blocking).toHaveLength(1);
  expect(blocking[0].why).toContain('срок принятия истёк');
});

test('новая дыра в уже принятом пакете роняет сборку', () => {
  // Иначе одна принятая запись молча накрывала бы всё будущее этого пакета.
  const { blocking } = evaluate({
    vulnerabilities: collectVulnerabilities(auditJson),
    allowlist: [{ package: 'next', advisories: 1, until: '2026-10-01', reason: 'x' }],
    now: NOW,
  });
  expect(blocking).toHaveLength(1);
  expect(blocking[0].why).toContain('дыр стало больше');
});

test('запись, которой больше ничего не соответствует, помечается как мусор', () => {
  const { blocking, stale } = evaluate({
    vulnerabilities: [],
    allowlist: [{ package: 'next', advisories: 2, until: '2026-10-01', reason: 'x' }],
    now: NOW,
  });
  expect(blocking).toHaveLength(0);
  expect(stale.map((s) => s.package)).toEqual(['next']);
});

test('запись без причины или срока считается неверной', () => {
  expect(validateAllowlistEntry({ package: 'x', advisories: 0, until: '2026-10-01' })).toContain(
    'нет reason — почему приняли'
  );
  expect(validateAllowlistEntry({ package: 'x', advisories: 0, reason: 'y' })).toContain(
    'нет until — до какой даты принято'
  );
  expect(validateAllowlistEntry({ package: 'x', advisories: 0, reason: 'y', until: 'скоро' })[0])
    .toContain('until не дата');
});

test('боевой .audit-allowlist.json заполнен по правилам', () => {
  const file = path.join(process.cwd(), '.audit-allowlist.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(Array.isArray(parsed.entries)).toBe(true);
  for (const entry of parsed.entries) {
    expect(validateAllowlistEntry(entry), `запись ${entry.package}`).toEqual([]);
    // Причина «потому что» никого не спасёт — требуем внятного объяснения.
    expect(entry.reason.length, `у ${entry.package} слишком короткая причина`).toBeGreaterThan(40);
  }
});
