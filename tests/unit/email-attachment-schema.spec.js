/**
 * Схема вложений в письмах должна совпадать с той, что понимает SDK Resend.
 *
 * Почему это отдельный тест, а не «и так видно». В resend 6 поля вложения
 * переехали на camelCase (`contentId`, `contentType`). Старый snake_case SDK
 * не ругается — он его просто **выбрасывает**: письмо уходит, вложение
 * перестаёт быть inline, ошибки нет нигде. Такую поломку не видно ни в CI
 * (письма в тестах не отправляются), ни в логах — только глазами в почте,
 * и только если знать, куда смотреть.
 *
 * Тест читает исходник, а не вызывает отправку: поднимать Resend ради формы
 * одного объекта незачем, а регресс ловится тем же движением.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const TICKET_LIB = path.join(process.cwd(), 'lib', 'ticket.js');
const source = fs.readFileSync(TICKET_LIB, 'utf8');

test('вложения объявлены в camelCase — snake_case resend 6 молча игнорирует', () => {
  expect(source, 'найден content_id: resend 6 такое поле выбросит').not.toMatch(/\bcontent_id\s*:/);
  expect(source, 'найден content_type: resend 6 такое поле выбросит').not.toMatch(
    /\bcontent_type\s*:/
  );
});

test('у каждого вложения есть contentId — иначе QR не встанет в тело письма', () => {
  // Вложение с QR — запасной путь на случай, если почтовик режет внешние
  // картинки. Без contentId на него нельзя сослаться через cid: в HTML.
  const attachmentBlocks = source.match(/attachments:\s*\[[\s\S]*?\]/g) || [];
  expect(attachmentBlocks.length, 'вложений в письмах не найдено вовсе').toBeGreaterThan(0);
  for (const block of attachmentBlocks) {
    expect(block).toMatch(/contentId\s*:/);
    expect(block).toMatch(/filename\s*:/);
  }
});

test('reply-to тоже в camelCase', () => {
  // Тот же класс ошибки: snake_case `reply_to` в новых версиях SDK не читается,
  // и ответ заявителя ушёл бы в noreply-ящик, откуда его никто не достанет.
  expect(source).not.toMatch(/\breply_to\s*:/);
});
