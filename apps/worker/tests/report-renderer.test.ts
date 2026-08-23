import { describe, expect, it } from 'vitest';
import { renderCsv, renderXlsx } from '../src/reports/processor.js';

const report = {
  title: 'Arrears / المتأخرات',
  columns: ['invoice', 'tenant', 'amount'],
  rows: [
    ['INV-1', 'أحمد', '450000'],
    ['INV-2', 'Company, LLC', '9007199254740993001'],
  ],
};

describe('report renderers', () => {
  it('renders UTF-8 CSV with safe quoting and exact monetary strings', () => {
    const csv = Buffer.from(renderCsv(report)).toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Company, LLC"');
    expect(csv).toContain('"9007199254740993001"');
    expect(csv).toContain('أحمد');
  });

  it('renders an actual Office Open XML zip rather than renaming CSV as XLSX', () => {
    const xlsx = Buffer.from(renderXlsx(report));
    expect(xlsx.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(xlsx.includes(Buffer.from('[Content_Types].xml'))).toBe(true);
    expect(xlsx.includes(Buffer.from('Company, LLC'))).toBe(true);
  });
});
