import { test, expect } from '@playwright/test';
import { escapeHtml } from '../../lib/ticket';

test.describe('escapeHtml', () => {
  test('экранирует HTML-спецсимволы из пользовательского ввода', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
    expect(escapeHtml(`Va&sya "the" O'Brien`)).toBe(
      'Va&amp;sya &quot;the&quot; O&#39;Brien'
    );
  });

  test('обычные имена не меняет', () => {
    expect(escapeHtml('Иванна Смоляна')).toBe('Иванна Смоляна');
  });
});
