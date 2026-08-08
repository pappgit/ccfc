/**
 * ISO 216 papirstørrelser (mm). Brukes både til forhåndsvisning og senere trykkfil.
 */
export const PAPER_FORMATS = {
  A5: { id: "A5", label: "A5", widthMm: 148, heightMm: 210 },
  A4: { id: "A4", label: "A4", widthMm: 210, heightMm: 297 },
  A3: { id: "A3", label: "A3", widthMm: 297, heightMm: 420 },
  A2: { id: "A2", label: "A2", widthMm: 420, heightMm: 594 },
};

export function paperDimensions(formatId, orientation = "portrait") {
  const format = PAPER_FORMATS[formatId];
  if (!format) throw new Error(`Ukjent format: ${formatId}`);
  const portrait = orientation !== "landscape";
  return {
    formatId: format.id,
    label: format.label,
    orientation,
    widthMm: portrait ? format.widthMm : format.heightMm,
    heightMm: portrait ? format.heightMm : format.widthMm,
  };
}
