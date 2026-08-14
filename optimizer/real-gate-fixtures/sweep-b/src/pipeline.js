export function parse(text) {
  return text.split('\n').map((line) => {
    const [id, category, rawAmount] = line.split(',');
    if (!id || !category || rawAmount === undefined) throw new Error(`malformed line: ${line}`);
    return { id, category, amount: Number(rawAmount) };
  });
}

export function validate(records) {
  const KNOWN = ['goods', 'services'];
  for (const record of records) {
    if (!KNOWN.includes(record.category)) throw new Error(`unknown category: ${record.category}`);
  }
  return records;
}

export function transform(records) {
  return records.filter((record) => record.amount !== 0)
    .map((record) => ({ ...record, zero: false }));
}

export function summarize(records) {
  const categories = [...new Set(records.map((record) => record.category))].sort();
  const total = records.reduce((sum, record) => sum + record.amount, 0);
  const average = Math.round((total / records.length) * 100) / 100;
  return { categories, total, average };
}

export function run(text) {
  const kept = transform(validate(parse(text)));
  return { records: kept, ...summarize(kept) };
}
