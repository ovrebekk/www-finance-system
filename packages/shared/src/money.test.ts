import { describe, expect, it } from 'vitest';
import { formatNok, parseAmount } from './money.js';
import { buildCategoryTree, descendantIds, flattenTree } from './categories.js';

describe('parseAmount', () => {
  it.each([
    ['1234', 123400],
    ['1 234,50', 123450],
    ['1234.5', 123450],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['kr 99', 9900],
    ['-12,3', -1230],
    ['0,05', 5],
    [' 7 ', 700],
  ])('parses %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,234,5x', '12,345.678'])('rejects %s', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('formatNok', () => {
  it('formats øre as NOK', () => {
    expect(formatNok(123456)).toMatch(/1 234,56/);
  });
});

describe('category tree', () => {
  const cats = [
    { id: 1, name: 'Bolig', kind: 'expense' as const, parentId: null, archived: false, sortOrder: 0, usageCount: 0 },
    { id: 2, name: 'Strøm', kind: 'expense' as const, parentId: 1, archived: false, sortOrder: 0, usageCount: 0 },
    { id: 3, name: 'Husleie', kind: 'expense' as const, parentId: 1, archived: false, sortOrder: 0, usageCount: 0 },
    { id: 4, name: 'Nettleie', kind: 'expense' as const, parentId: 2, archived: false, sortOrder: 0, usageCount: 0 },
  ];

  it('builds paths and sorts siblings by name', () => {
    const flat = flattenTree(buildCategoryTree(cats));
    expect(flat.map((c) => c.path)).toEqual(['Bolig', 'Bolig > Husleie', 'Bolig > Strøm', 'Bolig > Strøm > Nettleie']);
    expect(flat.map((c) => c.depth)).toEqual([0, 1, 1, 2]);
  });

  it('finds descendants', () => {
    expect([...descendantIds(cats, 1)].sort()).toEqual([1, 2, 3, 4]);
    expect([...descendantIds(cats, 2)].sort()).toEqual([2, 4]);
  });
});
