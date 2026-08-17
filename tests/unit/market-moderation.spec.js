import { test, expect } from '@playwright/test';
import {
  MODERATION_ACTIONS,
  resolveModeration,
  canModerate,
  validateModeration,
  describeModeration,
} from '../../lib/market-moderation';

/** Вещь, готовая к публикации: фото, описание, цена. */
const ready = {
  status: 'pending',
  brand: 'Max Mara',
  title: 'Пальто',
  description_ru: 'Носилось два сезона.',
  price_rappen: 59000,
  photos: ['a/b.jpg'],
};

test.describe('решения модератора', () => {
  test('четыре решения, и ничего сверх них', () => {
    expect(MODERATION_ACTIONS).toEqual(['approve_online', 'approve_market', 'reject', 'price']);
    expect(resolveModeration('approve_market')).toEqual({ known: true, target: 'approved_market' });
    expect(resolveModeration('price')).toEqual({ known: true, target: null });
    expect(resolveModeration('delete')).toEqual({ known: false, target: null });
    expect(resolveModeration(undefined).known).toBe(false);
  });

  test('чужой черновик не одобряем: продавец мог не закончить', () => {
    expect(canModerate('draft', 'approved_online')).toBe(false);
    expect(canModerate('draft', 'rejected')).toBe(false);
    expect(canModerate('draft', null)).toBe(false);
  });

  test('присланное на проверку можно одобрить или отклонить', () => {
    expect(canModerate('pending', 'approved_online')).toBe(true);
    expect(canModerate('pending', 'approved_market')).toBe(true);
    expect(canModerate('pending', 'rejected')).toBe(true);
  });

  test('решение по уже опубликованной вещи можно поменять', () => {
    expect(canModerate('approved_online', 'approved_market')).toBe(true);
    expect(canModerate('approved_market', 'approved_online')).toBe(true);
    expect(canModerate('approved_market', 'rejected')).toBe(true);
  });

  test('проданное не трогаем — на нём считалась комиссия', () => {
    expect(canModerate('sold', 'approved_online')).toBe(false);
    expect(canModerate('sold', 'rejected')).toBe(false);
    expect(canModerate('sold', null)).toBe(false); // даже рекомендованную цену
  });
});

test.describe('проверка решения', () => {
  test('одобрение готовой вещи проходит и ставит дату публикации', () => {
    const res = validateModeration({ action: 'approve_market' }, ready);
    expect(res.ok).toBe(true);
    expect(res.patch.status).toBe('approved_market');
    expect(res.patch.published_at).toBeTruthy();
  });

  test('нельзя одобрить вещь без фото или описания — в каталог уедет пустышка', () => {
    const noPhoto = validateModeration({ action: 'approve_online' }, { ...ready, photos: [] });
    expect(noPhoto.ok).toBe(false);
    expect(noPhoto.errors.join(' ')).toMatch(/фото/i);

    const noDesc = validateModeration({ action: 'approve_online' }, { ...ready, description_ru: null });
    expect(noDesc.ok).toBe(false);
    expect(noDesc.errors.join(' ')).toMatch(/[Оо]пиши/);
  });

  test('отказ без причины не проходит: письмо «нам не подошло» бесполезно', () => {
    const res = validateModeration({ action: 'reject' }, ready);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/причин/i);

    const withNote = validateModeration({ action: 'reject', note: 'Масс-маркет, не наш формат.' }, ready);
    expect(withNote.ok).toBe(true);
    expect(withNote.patch.moderation_note).toContain('Масс-маркет');
    expect(withNote.patch.status).toBe('rejected');
  });

  test('комментарий можно оставить и при одобрении', () => {
    const res = validateModeration({ action: 'approve_online', note: 'Взяли, но фото переснимите.' }, ready);
    expect(res.ok).toBe(true);
    expect(res.patch.moderation_note).toContain('переснимите');
  });

  test('рекомендованная цена: принимаем число, отбиваем мусор и крайности', () => {
    expect(validateModeration({ action: 'price', recommendedPrice: '450' }, ready).patch
      .recommended_price_rappen).toBe(45000);
    expect(validateModeration({ action: 'price', recommendedPrice: '450,50' }, ready).patch
      .recommended_price_rappen).toBe(45050);
    expect(validateModeration({ action: 'price', recommendedPrice: 'дорого' }, ready).ok).toBe(false);
    expect(validateModeration({ action: 'price', recommendedPrice: '1' }, ready).ok).toBe(false);
    expect(validateModeration({ action: 'price' }, ready).ok).toBe(false); // без цены нечего сохранять
  });

  test('цену можно проставить вместе с одобрением — одним действием', () => {
    const res = validateModeration({ action: 'approve_market', recommendedPrice: '500' }, ready);
    expect(res.ok).toBe(true);
    expect(res.patch.status).toBe('approved_market');
    expect(res.patch.recommended_price_rappen).toBe(50000);
  });

  test('неизвестное решение не проходит', () => {
    expect(validateModeration({ action: 'sell' }, ready).ok).toBe(false);
    expect(validateModeration(null, ready).ok).toBe(false);
  });

  test('решения называются словами — для письма продавцу', () => {
    expect(describeModeration('approve_market')).toContain('маркет');
    expect(describeModeration('reject')).toContain('не приняли');
    expect(describeModeration('чушь')).toBe(null);
  });
});
