// Logotipo en matriz de puntos (5×7), dibujado como SVG: negro con detalles de proceso C, M y Y.

const GLYPHS: Record<string, string[]> = {
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
};

/** Onda de la Ñ (dos filas sobre la N). */
const TILDE = ["01001", "10110"];

export function wordmark(height = 44): string {
  const cell = 10;
  const r = 3.4;
  const dots: string[] = [];
  let x = 0;
  const letter = (ch: string, color = "var(--k)") => {
    GLYPHS[ch].forEach((row, y) =>
      [...row].forEach((bit, i) => bit === "1" && dots.push(`<rect x="${x + i * cell}" y="${(y + 3) * cell}" width="${r * 2}" height="${r * 2}" rx="1" fill="${color}"/>`)),
    );
    x += 6 * cell;
  };
  for (const ch of "DISE") letter(ch);
  TILDE.forEach((row, y) => [...row].forEach((bit, i) => bit === "1" && dots.push(`<rect x="${x + i * cell}" y="${y * cell}" width="${r * 2}" height="${r * 2}" rx="1" fill="var(--m)"/>`)));
  letter("N");
  letter("O");
  // Separador: un punto de cada tinta de proceso.
  ["var(--c)", "var(--m)", "var(--y)"].forEach((c, i) => dots.push(`<rect x="${x + i * cell * 0.9}" y="${9 * cell}" width="${r * 2}" height="${r * 2}" rx="1" fill="${c}"/>`));
  x += 3 * cell;
  letter("I");
  letter("A");
  const w = x - cell;
  const h = 10 * cell;
  return `<svg class="wordmark" viewBox="0 0 ${w} ${h}" height="${height}" role="img" aria-label="DiseñoIA">${dots.join("")}</svg>`;
}

/** Marca compacta para el riel: cuatro puntos C, M, Y, K. */
export const mark = () =>
  `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="6" cy="6" r="3.2" fill="var(--c)"/><circle cx="14" cy="6" r="3.2" fill="var(--m)"/><circle cx="6" cy="14" r="3.2" fill="var(--y)"/><circle cx="14" cy="14" r="3.2" fill="#fff"/></svg>`;
