import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Пустой список и «список не загрузился» — разные вещи.
 *
 * Обе страницы кабинета глотали ошибку базы и показывали пустое состояние:
 * продавец с десятью вещами видел «Пока ни одной вещи. Заведи первую» и заводил
 * их заново, модератор видел «все вещи разобраны» и уходил. Ни один из двоих не
 * узнавал, что что-то сломалось.
 *
 * Проверяем по исходникам: поведение серверных страниц иначе не достать без
 * живой базы, а без теста этот возврат к `return []` не заметит никто.
 */
const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test.describe('сбой базы не притворяется пустотой', () => {
  test('кабинет продавца различает пустоту и поломку', () => {
    const page = read('app', 'market', 'page.jsx');
    expect(page).toContain('failed: true');
    expect(page).toContain('const { items, failed }');
    // Ошибку запроса больше не игнорируем: supabase отдаёт её полем error,
    // а не исключением, и раньше она просто терялась.
    expect(page).toContain('const { data, error }');
  });

  test('очередь модерации различает пустоту и поломку', () => {
    const page = read('app', 'market', 'admin', 'page.jsx');
    expect(page).toContain('failed: true');
    expect(page).toContain('const { items, failed }');
    expect(page).toContain('supabase select items');
  });

  test('текст поломки не выглядит как «работы нет»', () => {
    const admin = read('app', 'market', 'admin', 'page.jsx');
    const seller = read('app', 'market', 'page.jsx');
    expect(admin).toContain('не загрузилась');
    expect(seller).toContain('Не получилось загрузить');
    // И не обещает, что данные пропали.
    expect(seller).toContain('Ничего не пропало');
  });
});
