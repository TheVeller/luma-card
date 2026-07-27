// Shape of the generated font metric tables (scripts/gen-font-metrics.ts).
// Kept in a hand-written file so both the generator and the runtime import it.

export type WeightMetrics = {
  ascender: number;
  descender: number;
  lineGap: number;
  /** codepoint -> advance width, in font units */
  advances: Record<number, number>;
  /** advance used for codepoints missing from the table */
  fallbackAdvance: number;
};

export type FamilyMetrics = {
  family: string;
  unitsPerEm: number;
  /** Only the weights the family actually ships. */
  weights: Record<number, WeightMetrics>;
};
