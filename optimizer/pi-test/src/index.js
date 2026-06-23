// CSV to JSON converter library

/**
 * Split a CSV line into fields, respecting quoted strings
 * @param {string} line - A single CSV line
 * @returns {Array<string>} Array of field values
 */
function splitCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (double quote)
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  // Add the last field
  fields.push(current.trim());

  return fields;
}

/**
 * Parse CSV string into array of objects
 * @param {string} csv - CSV content
 * @returns {Array<Object>} Array of row objects
 */
export function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length === 0) return [];

  const headers = splitCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Convert parsed CSV data to JSON string
 * @param {Array<Object>} data - Parsed CSV data
 * @returns {string} JSON string
 */
export function csvToJson(data) {
  return JSON.stringify(data, null, 2);
}
