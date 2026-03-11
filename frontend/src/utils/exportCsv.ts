/**
 * 导出数据为 CSV 文件
 */
export function exportToCsv<T extends object>(
  data: T[],
  columns: { key: keyof T | string; title: string; render?: (v: unknown, row: T) => string }[],
  filename: string
) {
  if (!data.length) return;
  const BOM = '\uFEFF';
  const header = columns.map(c => `"${c.title}"`).join(',');
  const rows = data.map(row =>
    columns.map(col => {
      const val = (row as Record<string, unknown>)[col.key as string];
      const str = col.render ? col.render(val, row) : (val == null ? '' : String(val));
      return `"${String(str).replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv = BOM + [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
