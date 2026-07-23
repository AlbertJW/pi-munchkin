// Data layer: parses raw lines from data/records.csv
// (id,category,amount,status — one header line, then one record per line).

// Parses one CSV line into a record object.
export function parseRecord(line) {
  const [id, category, amount, status] = line.split(",");
  return { id, category, amount, status };
}
