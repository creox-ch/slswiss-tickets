/**
 * Сверка фактически оплаченной суммы с той, что мы записали в заказ.
 *
 * Цену считает только сервер, но до 20.08 вебхук не смотрел, сколько денег
 * реально пришло: он верил статусу `confirmed` и выдавал билет. Любая скидка,
 * выданная на стороне Payrexx (купон в его интерфейсе, ручная правка суммы),
 * прошла бы незаметно — в базе осталась бы полная цена, на счёте оказалось бы
 * меньше, и расхождение всплыло бы только при сверке выручки руками.
 *
 * Что делаем при расхождении: билет всё равно выдаём. Деньги получены, человек
 * ни при чём, а отказ на этом шаге означал бы оплаченную покупку без билета.
 * Но факт фиксируем — в логе и в самом заказе, — чтобы учёт не разъезжался молча.
 *
 * Чистый модуль: сравнение чисел, без сети и БД.
 */

/**
 * Сумма транзакции Payrexx в рапенах.
 *
 * У транзакции сумма лежит в `amount` (наименьшая единица валюты — как мы её и
 * отправляли в createGateway). Поле может отсутствовать у нестандартных
 * транзакций; тогда сверять нечего — это не расхождение, а незнание.
 */
export function transactionAmount(tx) {
  const raw = tx && tx.amount != null ? tx.amount : tx && tx.invoice ? tx.invoice.amount : null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Валюта транзакции (или null). */
export function transactionCurrency(tx) {
  const raw = tx && (tx.currency || (tx.invoice && tx.invoice.currency));
  return raw ? String(raw).toUpperCase() : null;
}

/**
 * Сверка. Возвращает разбор, а не бросает: решение принимает вебхук.
 *
 * status:
 *   'match'    — сошлось (или нечего сверять: суммы нет в транзакции)
 *   'underpaid'— пришло меньше ожидаемого: чаще всего скидка мимо нас
 *   'overpaid' — пришло больше: чужая транзакция, правка суммы, доплата
 *   'currency' — валюта не та, что в заказе
 */
// Number(null) === 0, поэтому «суммы нет» пришлось бы отличать от «оплатили
// ноль» отдельно — иначе каждая транзакция без суммы выглядела бы недоплатой.
function toRappen(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function compareAmounts({ expected, paid, expectedCurrency, paidCurrency }) {
  const exp = toRappen(expected);
  const got = toRappen(paid);

  if (exp == null || got == null) {
    return { status: 'match', mismatch: false, expected: exp, paid: got, delta: 0, unknown: true };
  }

  const expCur = expectedCurrency ? String(expectedCurrency).toUpperCase() : null;
  const gotCur = paidCurrency ? String(paidCurrency).toUpperCase() : null;
  if (expCur && gotCur && expCur !== gotCur) {
    return {
      status: 'currency',
      mismatch: true,
      expected: exp,
      paid: got,
      delta: got - exp,
      expectedCurrency: expCur,
      paidCurrency: gotCur,
    };
  }

  if (got === exp) {
    return { status: 'match', mismatch: false, expected: exp, paid: got, delta: 0 };
  }

  return {
    status: got < exp ? 'underpaid' : 'overpaid',
    mismatch: true,
    expected: exp,
    paid: got,
    delta: got - exp,
  };
}

/** Строка для лога: одна и та же форма, по ней потом ищут в логах Vercel. */
export function describeMismatch(result, referenceId) {
  if (!result || !result.mismatch) return '';
  const chf = (n) => (Math.round(Number(n) || 0) / 100).toFixed(2);
  if (result.status === 'currency') {
    return `[webhook] amount currency mismatch ${referenceId}: заказ ${chf(result.expected)} ${result.expectedCurrency}, оплата ${chf(result.paid)} ${result.paidCurrency}`;
  }
  return `[webhook] amount ${result.status} ${referenceId}: ожидали ${chf(result.expected)}, пришло ${chf(result.paid)} (разница ${chf(result.delta)})`;
}
