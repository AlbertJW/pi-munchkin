// Helpers for rendering fixed-width plain-text tables.
//
// Every cell in a column occupies exactly the width configured for that
// column, so that columns line up when rows are printed one under another.

const PAD = " ";
const SEPARATOR = " | ";

/**
 * Render a single value so that it fits the given column width.
 *
 * Short values are padded on the right with spaces.
 */
export function fitCell(text, width) {
  const value = String(text);

  if (value.length > width) {
    return value.slice(0, width);
  }

  return value + PAD.repeat(width - value.length);
}

/**
 * Render one table row: each value is fitted to the matching column width
 * and the resulting cells are joined with " | ".
 */
export function formatRow(values, widths) {
  if (values.length !== widths.length) {
    throw new Error("values and widths must have the same length");
  }

  return values.map((value, index) => fitCell(value, widths[index])).join(SEPARATOR);
}
