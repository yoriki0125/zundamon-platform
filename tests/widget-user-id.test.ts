import { describe, expect, test } from 'vitest';
import { normalizeHumanId, resolveWidgetUserId } from '@/lib/widget-user-id';

describe('normalizeHumanId', () => {
  test('50文字のhumanidは有効として扱う', () => {
    const value = 'a'.repeat(50);
    expect(normalizeHumanId(value)).toBe(value);
  });

  test('51文字のhumanidは無効として破棄する', () => {
    expect(normalizeHumanId('a'.repeat(51))).toBeUndefined();
  });

  test('空文字や空白のみは無効として破棄する', () => {
    expect(normalizeHumanId('')).toBeUndefined();
    expect(normalizeHumanId('   ')).toBeUndefined();
  });
});

describe('resolveWidgetUserId', () => {
  test('humanidが有効ならuserIdより優先される', () => {
    expect(resolveWidgetUserId('human-001', 'legacy-user')).toBe('human-001');
  });

  test('humanidが未指定なら既存userIdを利用する', () => {
    expect(resolveWidgetUserId(undefined, 'legacy-user')).toBe('legacy-user');
  });

  test('humanidが不正なら既存userIdへフォールバックする', () => {
    expect(resolveWidgetUserId(' '.repeat(51), 'legacy-user')).toBe('legacy-user');
  });
});
