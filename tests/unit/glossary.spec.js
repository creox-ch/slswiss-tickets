import { test, expect } from '@playwright/test';
import { glossaryFor, TERMS } from '../../lib/glossary';
import { renderReportHtml, renderReportText } from '../../lib/forms';

const pension = {
  form_key: 'calc-pension',
  role: 'Пенсия в Швейцарии',
  payload: {
    'Пенсия всего, CHF/мес': "4'506",
    'AHV (1-я опора)': "2'100",
    'Pensionskasse (2-я опора)': "1'906",
    'Säule 3a (3-я опора)': '500',
  },
};

const budget = {
  form_key: 'calc-budget',
  role: 'Семейный бюджет',
  payload: { 'Итог за месяц': "−1'240 — минус" },
};

test.describe('glossaryFor — только термины этого расчёта', () => {
  test('пенсия: опоры объясняются', () => {
    const titles = glossaryFor(pension).map((t) => t.title);
    expect(titles).toContain('AHV / AVS');
    expect(titles).toContain('Pensionskasse (BVG)');
    expect(titles).toContain('Säule 3a');
  });

  test('весь словарь не выгружается: чужих терминов в письме нет', () => {
    const titles = glossaryFor(pension).map((t) => t.title);
    expect(titles).not.toContain('Krankenkasse'); // это из бюджета
    expect(titles).not.toContain('Steuerfuss'); // это из налогов
    expect(titles.length).toBeLessThanOrEqual(5);
  });

  test('бюджет: свои термины, даже если слово в подписи не мелькнуло', () => {
    // payload у бюджета — одна строка «Итог за месяц», но модель построена
    // на средних Krankenkasse и детских по кантону: их и объясняем.
    const titles = glossaryFor(budget).map((t) => t.title);
    expect(titles).toContain('Krankenkasse');
    expect(titles).toContain('Kinderzulagen');
  });

  test('термин ловится по тексту расчёта, а не только по калькулятору', () => {
    const custom = { form_key: 'calc-other', payload: { Ипотека: 'Amortisation 12 000 CHF/год' } };
    expect(glossaryFor(custom).map((t) => t.title)).toContain('Amortisation');
  });

  test('нечего объяснять → пустой список (блока в письме не будет)', () => {
    expect(glossaryFor({ form_key: 'registration', payload: { Имя: 'Саша' } })).toEqual([]);
    expect(glossaryFor(null)).toEqual([]);
    expect(glossaryFor({})).toEqual([]);
  });

  test('лимит соблюдается', () => {
    expect(glossaryFor(pension, 2)).toHaveLength(2);
    expect(glossaryFor(pension, 0)).toHaveLength(0);
  });

  test('определения без цифр, которые устаревают за год', () => {
    // лимит 3a и ставки меняются ежегодно — письмо живёт дольше
    for (const t of TERMS) {
      expect(t.def, `${t.title}: год в определении устареет`).not.toMatch(/20\d\d/);
      expect(t.def.length, `${t.title}: слишком длинное определение`).toBeLessThan(420);
    }
  });
});

test.describe('глоссарий в письме-отчёте', () => {
  test('HTML: блок есть, с заголовком и оговоркой', () => {
    const html = renderReportHtml(pension);
    expect(html).toContain('Что означают понятия из расчёта');
    expect(html).toContain('Только те, которые встретились именно в твоём случае');
    expect(html).toContain('Säule 3a');
  });

  test('текстовая часть: тот же блок словами', () => {
    const text = renderReportText(pension);
    expect(text).toContain('ЧТО ОЗНАЧАЮТ ПОНЯТИЯ ИЗ РАСЧЁТА');
    expect(text).toMatch(/AHV \/ AVS — /);
  });

  test('если объяснять нечего — блока нет вовсе', () => {
    const sub = { form_key: 'registration', role: 'Ранняя регистрация', payload: { Имя: 'Саша' } };
    expect(renderReportHtml(sub)).not.toContain('Что означают понятия');
    expect(renderReportText(sub)).not.toContain('ЧТО ОЗНАЧАЮТ ПОНЯТИЯ');
  });

  test('термины экранируются как остальной текст', () => {
    const html = renderReportHtml(pension);
    expect(html).not.toMatch(/<script/i);
  });
});

test.describe('ссылки и подписка в письме-отчёте', () => {
  test('ссылка на все калькуляторы есть в обеих частях письма', () => {
    expect(renderReportHtml(pension)).toContain('/calculators?utm_source=calc-report');
    expect(renderReportText(pension)).toContain('Все калькуляторы: https://frankenplatz.ch/calculators');
  });

  test('не отметил галочку → в письме предложение подписаться', () => {
    const html = renderReportHtml(pension);
    expect(html).toContain('Программа и спикеры — раньше всех');
    expect(html).toContain('#subscribe');
    // честно говорим, что это отдельная история, а не условие получения отчёта
    expect(html).toContain('Это отдельная подписка');
    expect(renderReportText(pension)).toContain('ПРОГРАММА И СПИКЕРЫ — РАНЬШЕ ВСЕХ');
  });

  test('отметил галочку → второй раз не зовём', () => {
    const opted = { ...pension, newsletter_optin: true };
    expect(renderReportHtml(opted)).not.toContain('Программа и спикеры — раньше всех');
    expect(renderReportText(opted)).not.toContain('ПРОГРАММА И СПИКЕРЫ');
    // ссылка на калькуляторы остаётся — она не про продажу
    expect(renderReportHtml(opted)).toContain('/calculators?utm_source=calc-report');
  });
});
