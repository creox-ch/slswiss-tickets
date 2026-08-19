import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { canModerate, resolveModeration, MODERATION_ACTIONS } from '../../lib/market-moderation';

/**
 * Пакет «Под ключ» (249 CHF): коробку разбирает и заводит организатор, продавец
 * не делает ничего.
 *
 * До 19.08 исполнить пакет было нельзя, и держали это три замка сразу — снятие
 * одного ничего не меняло. Тесты стерегут каждый, потому что вернуть любой из
 * них можно одной строкой, а заметить это будет некому: продавцов «Под ключ»
 * пока нет, и тупик всплывёт на первом же оплаченном пакете.
 */

const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test.describe('пакет «Под ключ»: вещь заводит модератор', () => {
  test('замок 1: заведённая вещь идёт в очередь, а не в черновики', () => {
    const route = read('app', 'api', 'market', 'admin', 'items', 'route.js');
    expect(route).toContain("status: 'pending'");
    // Черновик здесь означал тупик: модерации он недоступен целиком.
    expect(route).not.toContain("status: 'draft'");
  });

  test('замок 1 подтверждён правилом: черновик модерации по-прежнему закрыт', () => {
    // Правило не меняли — вместо него поменяли статус при заведении. Черновик
    // продавца остаётся его личным делом, как и было решено.
    expect(canModerate('draft', 'approved_online')).toBe(false);
    expect(canModerate('draft', null)).toBe(false);
    expect(canModerate('pending', 'approved_online')).toBe(true);
  });

  test('замок 2: фото вещи может грузить модератор, а не только владелец', () => {
    const photos = read('app', 'api', 'market', 'items', '[id]', 'photos', 'route.js');
    expect(photos).toContain('isAdminEmail');
    // Правила по статусу общие для обоих: проданное и забронированное не трогаем.
    expect(photos).toContain('sellerEditRule');
  });

  test('замок 2 не открыл дверь посторонним', () => {
    const photos = read('app', 'api', 'market', 'items', '[id]', 'photos', 'route.js');
    // Продавец по-прежнему сверяется с владельцем вещи.
    expect(photos).toContain('item.seller_id !== seller.id');
    // Чужая и несуществующая вещь отвечают одинаково — иначе перебором можно
    // узнать, что у соседа в каталоге.
    expect(photos).toContain('notFound');
  });

  test('замок 3: есть экран заведения, и он закрыт от посторонних', () => {
    const page = read('app', 'market', 'admin', 'new', 'page.jsx');
    expect(page).toContain('isAdminEmail');
    expect(page).toContain('notFound()');
    expect(page).toContain('mode="admin"');
  });

  test('на экран заведения можно попасть из очереди', () => {
    // Роут заведения существовал и раньше — но позвать его было неоткуда,
    // и поэтому пакет не исполнялся.
    const admin = read('app', 'market', 'admin', 'page.jsx');
    expect(admin).toContain('/market/admin/new');
  });

  test('форма заведения спрашивает адрес продавца и шлёт его в админский роут', () => {
    const form = read('app', 'market', 'item-form.jsx');
    expect(form).toContain('sellerEmail');
    expect(form).toContain('/api/market/admin/items');
    // Поля вещи общие с формой продавца: две почти одинаковые формы разъезжаются,
    // и продавец с модератором начинают видеть разные вещи.
    expect(form).toContain("mode = 'seller'");
  });

  test('в очереди у вещи без фото есть загрузчик — иначе одобрить нельзя', () => {
    const list = read('app', 'market', 'admin', 'moderation-list.jsx');
    expect(list).toContain('PhotoUploader');
    expect(list).toContain('!photos.length');
  });
});

test.describe('«Под ключ»: модератор ведёт вещь как продавец', () => {
  test('правка полей модератором — отдельное действие, статус не меняет', () => {
    expect(resolveModeration('edit')).toEqual({ known: true, target: null });
    // Действие есть в списке — интерфейс и тесты берут его оттуда.
    expect(MODERATION_ACTIONS).toContain('edit');
  });

  test('правка модератором не отправляет вещь на повторную проверку', () => {
    // У продавца правка опубликованной вещи возвращает её в очередь. У
    // модератора — нет: он и есть проверяющий, отправлять вещь к самому себе
    // это театр. Роут поэтому не трогает статус при action='edit'.
    const route = read('app', 'api', 'market', 'admin', 'items', '[id]', 'route.js');
    expect(route).toContain("body.action === 'edit'");
    expect(route).toContain('validateItem');
    // Границы всё же есть: проданное и забронированное заперты для обоих.
    expect(route).toContain('sellerEditRule');
  });

  test('экран правки закрыт от посторонних и переиспользует общую форму', () => {
    const page = read('app', 'market', 'admin', 'items', '[id]', 'edit', 'page.jsx');
    expect(page).toContain('isAdminEmail');
    expect(page).toContain('notFound()');
    expect(page).toContain('mode="admin"');
    // Фотографии правятся там же: по «Под ключ» снимает модератор.
    expect(page).toContain('PhotoUploader');
  });

  test('на правку можно попасть из очереди', () => {
    const list = read('app', 'market', 'admin', 'moderation-list.jsx');
    expect(list).toContain('/market/admin/items/');
  });

  test('приоритет в каталоге проставляется пакету «Под ключ»', () => {
    // Поле priority было в базе с самого начала и не выставлялось нигде —
    // обещание пакета висело пустым (находка ревизии).
    const route = read('app', 'api', 'market', 'admin', 'items', 'route.js');
    expect(route).toContain("package === 'turnkey'");
    // Мало посчитать — надо записать. На этом и провалился первый заход:
    // переменная priority вычислялась, но до insert не доезжала, а тест по
    // слову «priority» проходил. Поэтому смотрим именно на строку записи.
    const insert = route.split('\n').find((l) => l.includes('.insert('));
    expect(insert).toContain('priority');
  });
});
