import { test, expect } from '@playwright/test';
import {
  CATEGORIES,
  CONDITIONS,
  SEXES,
  ITEM_STATUSES,
  MIN_PHOTOS,
  MAX_PHOTOS,
  isValidStatus,
  canTransition,
  isVisibleInCatalog,
  isBookable,
  goesToMarket,
  formatItemNo,
  formatPrice,
  parsePriceToRappen,
  validateItem,
  canPublish,
  resolveAction,
  canApply,
  sellerEditRule,
  coveredByRefundGuarantee,
} from '../../lib/market-items';
import fs from 'fs';
import path from 'path';

test.describe('статусы вещи', () => {
  test('словарь статусов покрывает весь путь вещи', () => {
    expect(ITEM_STATUSES).toEqual([
      'draft',
      'pending',
      'approved_online',
      'approved_market',
      'rejected',
      'reserved',
      'sold',
      'withdrawn',
      'returned',
    ]);
    expect(isValidStatus('draft')).toBe(true);
    expect(isValidStatus('approved')).toBe(false); // такого статуса нет — их два
  });

  test('обычный путь: черновик → модерация → каталог → продано', () => {
    expect(canTransition('draft', 'pending')).toBe(true);
    expect(canTransition('pending', 'approved_online')).toBe(true);
    expect(canTransition('pending', 'approved_market')).toBe(true);
    expect(canTransition('approved_market', 'sold')).toBe(true);
  });

  test('через голову не прыгаем: черновик не попадает в каталог мимо модерации', () => {
    expect(canTransition('draft', 'approved_online')).toBe(false);
    expect(canTransition('draft', 'sold')).toBe(false);
  });

  test('проданное — конечный статус: на нём считается комиссия (AGB 5.6)', () => {
    for (const to of ITEM_STATUSES) {
      expect(canTransition('sold', to)).toBe(false);
    }
  });

  test('модератор вправе передумать про офлайн, не выбрасывая вещь из каталога', () => {
    expect(canTransition('approved_market', 'approved_online')).toBe(true);
    expect(canTransition('approved_online', 'approved_market')).toBe(true);
  });

  test('отклонённую вещь можно доработать и прислать снова', () => {
    expect(canTransition('rejected', 'draft')).toBe(true);
    expect(canTransition('rejected', 'approved_online')).toBe(false);
  });

  test('истёкшая бронь возвращает вещь в каталог (AGB 7.2)', () => {
    expect(canTransition('reserved', 'approved_online')).toBe(true);
    expect(canTransition('reserved', 'approved_market')).toBe(true);
    expect(canTransition('reserved', 'sold')).toBe(true);
  });

  test('неизвестный статус не проходит ни в одну сторону', () => {
    expect(canTransition('draft', 'опубликовано')).toBe(false);
    expect(canTransition('опубликовано', 'draft')).toBe(false);
    expect(canTransition(null, undefined)).toBe(false);
  });
});

test.describe('видимость в каталоге', () => {
  test('черновики и отклонённое наружу не показываем', () => {
    expect(isVisibleInCatalog('draft')).toBe(false);
    expect(isVisibleInCatalog('pending')).toBe(false);
    expect(isVisibleInCatalog('rejected')).toBe(false);
    expect(isVisibleInCatalog('withdrawn')).toBe(false);
  });

  test('проданное видно, но гаснет — обещание страницы «купленное сразу гаснет»', () => {
    expect(isVisibleInCatalog('sold')).toBe(true);
    expect(isBookable('sold')).toBe(false);
  });

  test('бронировать можно только свободную одобренную вещь', () => {
    expect(isBookable('approved_online')).toBe(true);
    expect(isBookable('approved_market')).toBe(true);
    expect(isBookable('reserved')).toBe(false);
    expect(isBookable('pending')).toBe(false);
  });

  test('на офлайн-маркет едет только approved_market (мидл — онлайн, но по отбору)', () => {
    expect(goesToMarket('approved_market')).toBe(true);
    expect(goesToMarket('approved_online')).toBe(false);
  });
});

test.describe('номер вещи и цена', () => {
  test('FM-2026-0042 — с ведущими нулями', () => {
    expect(formatItemNo(42)).toBe('FM-2026-0042');
    expect(formatItemNo(1)).toBe('FM-2026-0001');
    expect(formatItemNo(12345)).toBe('FM-2026-12345'); // за 4 знака не режем
  });

  test('мусор вместо номера → null, а не «FM-2026-NaN»', () => {
    expect(formatItemNo(0)).toBe(null);
    expect(formatItemNo(-3)).toBe(null);
    expect(formatItemNo('сорок два')).toBe(null);
    expect(formatItemNo(null)).toBe(null);
  });

  test('цена из рапенов — как в письмах', () => {
    expect(formatPrice(15900)).toBe('159.00 CHF');
    expect(formatPrice(45050)).toBe('450.50 CHF');
  });

  test('цену из формы принимаем в трёх видах записи', () => {
    expect(parsePriceToRappen('450')).toBe(45000);
    expect(parsePriceToRappen('450.50')).toBe(45050);
    expect(parsePriceToRappen('450,50')).toBe(45050); // запятая — обычное дело
    expect(parsePriceToRappen(' 1 200 ')).toBe(120000);
    expect(parsePriceToRappen(450)).toBe(45000);
  });

  test('не-цена → null (роут ответит 400, а не запишет мусор)', () => {
    expect(parsePriceToRappen('дорого')).toBe(null);
    expect(parsePriceToRappen('450.555')).toBe(null);
    expect(parsePriceToRappen('')).toBe(null);
    expect(parsePriceToRappen(null)).toBe(null);
  });
});

test.describe('валидация вещи', () => {
  const good = {
    brand: 'Max Mara',
    title: 'Пальто, шерсть-кашемир',
    category: 'clothes',
    sex: 'f',
    condition: 'ideal',
    price: '590',
    originalPrice: '1290',
    size: '38 (M)',
    material: 'шерсть + кашемир',
    color: 'кэмел',
    description: 'Носилось два сезона, без дефектов.',
    photos: ['items/a.jpg'],
    hasDocs: true,
  };

  test('полная вещь проходит и приводится к полям БД', () => {
    const res = validateItem(good, { forPublication: true });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.value.price_rappen).toBe(59000);
    expect(res.value.original_price_rappen).toBe(129000);
    expect(res.value.has_docs).toBe(true);
    expect(res.value.description_ru).toContain('Носилось');
  });

  test('черновик можно сохранить без описания — вещь заводят не за один присест', () => {
    const draft = { ...good, description: '' };
    expect(validateItem(draft).ok).toBe(true);
    const forPub = validateItem(draft, { forPublication: true });
    expect(forPub.ok).toBe(false);
    expect(forPub.errors.join(' ')).toMatch(/[Оо]пиши/);
  });

  // Баг, найденный вторым кругом ручного тестирования: форма не присылает фото
  // (они грузятся своим роутом), а валидатор возвращал photos:[] среди полей.
  // Это попадало в UPDATE — проверка публикации видела ноль фото при четырёх в
  // базе, а сохранение формы затёрло бы их совсем.
  test('в полях для БД нет фото — форма не должна ими управлять', () => {
    const res = validateItem({ ...good, photos: ['подсунутое.jpg'] });
    expect(res.ok).toBe(true);
    expect('photos' in res.value).toBe(false);
  });

  test('без бренда, категории и состояния не пускаем', () => {
    const res = validateItem({ ...good, brand: '', category: 'мех', condition: '' });
    expect(res.ok).toBe(false);
    expect(res.value).toBe(null);
    expect(res.errors).toHaveLength(3);
  });

  test('цена: ноль, мусор и лишний ноль ловятся', () => {
    expect(validateItem({ ...good, price: '0' }).ok).toBe(false);
    expect(validateItem({ ...good, price: 'договоримся' }).ok).toBe(false);
    expect(validateItem({ ...good, price: '600000' }).ok).toBe(false); // 600 000 CHF
  });

  test('цена в бутике ниже своей — бессмысленная «скидка»', () => {
    const res = validateItem({ ...good, price: '590', originalPrice: '400' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/выше твоей/);
  });

  test('лимит фото проверяется там, где их загружают, а не в форме', () => {
    // Шестое фото отбивает роут загрузки (проверено на проде: 409), форма же
    // о фото вообще не знает — и не должна.
    expect(MIN_PHOTOS).toBe(1);
    expect(MAX_PHOTOS).toBe(5);
    const res = canPublish({
      brand: 'X',
      title: 'Y',
      description_ru: 'Z',
      price_rappen: 100,
      photos: ['1', '2', '3', '4', '5', '6'],
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain(String(MAX_PHOTOS));
  });

  test('длинные поля обрезаются, а не роняют запись', () => {
    const res = validateItem({ ...good, brand: 'A'.repeat(500) });
    expect(res.ok).toBe(true);
    expect(res.value.brand).toHaveLength(80);
  });

  test('не-объект на входе не роняет валидатор', () => {
    expect(validateItem(null).ok).toBe(false);
    expect(validateItem('вещь').ok).toBe(false);
  });
});

// Тоже с первого живого теста: «Сохранить черновик» отвечало «Неизвестное
// действие» — форма слала action='save', а роут знал только submit/withdraw/draft.
// И «вернуть в черновики» для вещи, которая уже черновик, упиралось в таблицу
// переходов, хотя это не переход, а сохранение.
test.describe('действия формы', () => {
  test('save — сохранение без смены статуса', () => {
    expect(resolveAction('save')).toEqual({ known: true, target: null });
    expect(resolveAction(undefined)).toEqual({ known: true, target: null });
    expect(resolveAction('')).toEqual({ known: true, target: null });
  });

  test('остальные кнопки ведут в свои статусы', () => {
    expect(resolveAction('submit').target).toBe('pending');
    expect(resolveAction('withdraw').target).toBe('withdrawn');
    expect(resolveAction('draft').target).toBe('draft');
  });

  test('выдуманное действие не проходит', () => {
    expect(resolveAction('approve')).toEqual({ known: false, target: null });
    expect(resolveAction('delete').known).toBe(false);
  });

  test('сохранение черновика черновиком — не переход, а сохранение', () => {
    expect(canApply('draft', null)).toBe(true);
    expect(canApply('draft', 'draft')).toBe(true);
    expect(canApply('pending', null)).toBe(true);
  });

  test('запрещённые переходы остаются запрещёнными', () => {
    expect(canApply('draft', 'pending')).toBe(true);
    expect(canApply('sold', 'draft')).toBe(false);
    expect(canApply('sold', 'withdrawn')).toBe(false);
  });
});

// Поймано живьём при первом тесте кабинета: продавец загрузил фото, а форма
// на отправке ругалась «добавь хотя бы одно фото». Причина — проверяли тело
// запроса, а фото туда не попадают: они грузятся своим роутом и лежат в БД.
// Обратная сторона той же ошибки: кнопка «отправить» из списка шлёт только
// действие, и вещь совсем без фото уходила бы на модерацию.
test.describe('готовность к публикации — по сохранённой вещи, а не по форме', () => {
  const saved = {
    brand: 'Max Mara',
    title: 'Пальто',
    description_ru: 'Носилось два сезона.',
    price_rappen: 59000,
    photos: ['items/a.jpg'],
  };

  test('вещь с фото в базе публикуется, даже если форма фото не прислала', () => {
    expect(canPublish(saved)).toEqual({ ok: true, errors: [] });
  });

  test('без фото не публикуем — сколько бы полей ни прислала форма', () => {
    const res = canPublish({ ...saved, photos: [] });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/фото/i);
  });

  test('пустой список и мусор вместо фото — одно и то же', () => {
    expect(canPublish({ ...saved, photos: null }).ok).toBe(false);
    expect(canPublish({ ...saved, photos: [null, ''] }).ok).toBe(false);
  });

  test('незаполненные поля называются по одному, а не «что-то не так»', () => {
    const res = canPublish({ photos: ['a.jpg'] });
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(3); // бренд+название, описание, цена
  });

  test('не-объект не роняет проверку', () => {
    expect(canPublish(null).ok).toBe(false);
    expect(canPublish('вещь').ok).toBe(false);
  });
});

test.describe('гарантия возврата взноса (AGB 6.2–6.3)', () => {
  test('без документов подлинности гарантии нет', () => {
    expect(coveredByRefundGuarantee({ has_docs: false, price_rappen: 10000 })).toBe(false);
  });

  test('с документами и ценой по рекомендации — есть', () => {
    expect(
      coveredByRefundGuarantee({ has_docs: true, price_rappen: 50000, recommended_price_rappen: 60000 })
    ).toBe(true);
    expect(
      coveredByRefundGuarantee({ has_docs: true, price_rappen: 60000, recommended_price_rappen: 60000 })
    ).toBe(true); // ровно по рекомендации — тоже покрыто
  });

  test('цена выше рекомендованной снимает гарантию с этой позиции', () => {
    expect(
      coveredByRefundGuarantee({ has_docs: true, price_rappen: 90000, recommended_price_rappen: 60000 })
    ).toBe(false);
  });

  test('рекомендации не давали — по цене претензий быть не может', () => {
    expect(coveredByRefundGuarantee({ has_docs: true, price_rappen: 90000 })).toBe(true);
  });
});

test.describe('словари', () => {
  test('категории и состояния совпадают с фильтрами каталога', () => {
    expect(Object.keys(CATEGORIES)).toEqual(['clothes', 'shoes', 'bags', 'acc']);
    expect(Object.keys(CONDITIONS)).toEqual(['new', 'ideal', 'good', 'fair']);
    expect(Object.keys(SEXES)).toEqual(['f', 'm', 'u', 'k']);
  });
});

test.describe('правка вещи продавцом — «свой не может лишнего»', () => {
  test('пока вещь не опубликована, правка свободна и на проверку не отправляет', () => {
    for (const status of ['draft', 'pending', 'rejected', 'withdrawn', 'returned']) {
      const rule = sellerEditRule(status);
      expect(rule.allowed, status).toBe(true);
      expect(rule.backToPending, status).toBe(false);
    }
  });

  test('правка опубликованной вещи возвращает её на повторную проверку', () => {
    // Одобряли конкретную вещь с конкретным описанием. Без этого правила
    // продавец менял бренд сразу после одобрения, и право отбора (AGB 3.6)
    // обходилось молча.
    for (const status of ['approved_online', 'approved_market']) {
      const rule = sellerEditRule(status);
      expect(rule.allowed, status).toBe(true);
      expect(rule.backToPending, status).toBe(true);
    }
    expect(canApply('approved_online', 'pending')).toBe(true);
    expect(canApply('approved_market', 'pending')).toBe(true);
  });

  test('у забронированной и проданной поля заперты, и человеку сказано почему', () => {
    for (const status of ['reserved', 'sold']) {
      const rule = sellerEditRule(status);
      expect(rule.allowed, status).toBe(false);
      expect(rule.reason, status).toBeTruthy();
      // Служебное имя статуса в лицо продавцу не показываем.
      expect(rule.reason).not.toContain(status);
    }
    // Цена проданной вещи — основание для счёта на комиссию: её не должна
    // менять та сторона, которая по счёту платит.
    expect(sellerEditRule('sold').reason).toContain('комисси');
  });

  test('неизвестный статус закрыт, а не открыт по умолчанию', () => {
    const rule = sellerEditRule('чего-то новенькое');
    expect(rule.allowed).toBe(false);
    expect(rule.reason).toBeTruthy();
  });

  test('каждый статус вещи имеет правило правки', () => {
    // Заводя новый статус, легко забыть про правку — и он окажется либо
    // молча открытым, либо непонятно закрытым.
    for (const status of ITEM_STATUSES) {
      const rule = sellerEditRule(status);
      expect(typeof rule.allowed, status).toBe('boolean');
      if (!rule.allowed) expect(rule.reason, status).toBeTruthy();
    }
  });

  test('роуты правки и фото действительно спрашивают правило', () => {
    // Правило бесполезно, если роут его не зовёт: ровно так Р1 и дожил
    // до прода — проверка была, но статуса не касалась.
    const root = path.join(process.cwd(), 'app', 'api', 'market', 'items', '[id]');
    const item = fs.readFileSync(path.join(root, 'route.js'), 'utf8');
    const photos = fs.readFileSync(path.join(root, 'photos', 'route.js'), 'utf8');
    expect(item).toContain('sellerEditRule');
    expect(photos).toContain('sellerEditRule');
    // И удаление последнего фото у опубликованной вещи не проходит.
    expect(photos).toContain('MIN_PHOTOS');
  });
});
