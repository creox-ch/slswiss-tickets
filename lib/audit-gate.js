/**
 * Гейт по уязвимостям зависимостей: что считается «новым», а что мы уже приняли.
 *
 * Голый `npm audit --audit-level=high` на этом репо не работает как гейт: в нём
 * есть известная и пока не устранимая уязвимость (см. .audit-allowlist.json),
 * значит красное горело бы всегда — а гейт, который горит всегда, через неделю
 * перестают читать. Обратное решение (`|| true`) не гейт вовсе.
 *
 * Поэтому: принятое перечислено поимённо, с причиной и СРОКОМ. Всё остальное
 * роняет сборку. Просроченная запись роняет тоже — иначе «примем на месяц»
 * незаметно превращается в «примем навсегда».
 */

/** Уровни, на которых гейт срабатывает. moderate/low — не наш случай. */
export const GATED_SEVERITIES = ['high', 'critical'];

/**
 * Плоский список уязвимых пакетов из `npm audit --json`.
 * @param {object} auditJson разобранный вывод npm audit
 */
export function collectVulnerabilities(auditJson) {
  const raw = auditJson?.vulnerabilities || {};
  return Object.values(raw)
    .filter((v) => GATED_SEVERITIES.includes(v?.severity))
    .map((v) => ({
      name: v.name,
      severity: v.severity,
      range: v.range || '',
      // Сколько разных advisory сейчас числится за пакетом. Число нужно, чтобы
      // заметить НОВУЮ дыру в уже принятом пакете: перечислять два десятка
      // GHSA поимённо никто не будет, а рост счётчика виден сразу.
      advisories: (v.via || []).filter((x) => typeof x === 'object').length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Запись allowlist валидна, если есть пакет, причина, срок и счётчик. */
export function validateAllowlistEntry(entry) {
  const problems = [];
  if (!entry || typeof entry !== 'object') return ['запись не объект'];
  if (!entry.package) problems.push('нет package');
  if (!entry.reason) problems.push('нет reason — почему приняли');
  if (!entry.until) problems.push('нет until — до какой даты принято');
  else if (Number.isNaN(Date.parse(entry.until))) problems.push(`until не дата: ${entry.until}`);
  if (!Number.isInteger(entry.advisories) || entry.advisories < 0) {
    problems.push('advisories должно быть целым числом');
  }
  return problems;
}

/**
 * Сверяет находки со списком принятого.
 *
 * @returns {{blocking: object[], accepted: object[], stale: object[]}}
 *   blocking — из-за чего падаем (с полем `why`), stale — записи allowlist,
 *   которым больше ничего не соответствует: их пора удалить.
 */
export function evaluate({ vulnerabilities = [], allowlist = [], now = new Date() } = {}) {
  const byPackage = new Map(allowlist.map((e) => [e.package, e]));
  const seen = new Set();
  const blocking = [];
  const accepted = [];

  for (const vuln of vulnerabilities) {
    const entry = byPackage.get(vuln.name);
    if (!entry) {
      blocking.push({ ...vuln, why: 'новая уязвимость, решения по ней нет' });
      continue;
    }
    seen.add(entry.package);

    if (Date.parse(entry.until) < now.getTime()) {
      blocking.push({
        ...vuln,
        why: `срок принятия истёк ${entry.until} — пересмотреть решение`,
        entry,
      });
      continue;
    }
    if (vuln.advisories > entry.advisories) {
      blocking.push({
        ...vuln,
        why: `дыр стало больше: принято ${entry.advisories}, сейчас ${vuln.advisories}`,
        entry,
      });
      continue;
    }
    accepted.push({ ...vuln, entry });
  }

  const stale = allowlist.filter((e) => !seen.has(e.package));
  return { blocking, accepted, stale };
}
