// Dynamic Google Fonts loader for canvas rendering.
// document.fonts.ready waits until all injected fonts have loaded before we render.

const loaded = new Set<string>();

function familyToUrl(family: string, weights: string): string {
  const q = family.trim().replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${q}:wght@${weights}&display=swap`;
}

export async function loadGoogleFontPair(heading: string, body: string): Promise<void> {
  const pairs: Array<[string, string]> = [
    [heading, "600;700;800;900"],
    [body, "400;500;700"],
  ];
  for (const [family, weights] of pairs) {
    const key = `${family}::${weights}`;
    if (loaded.has(key)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = familyToUrl(family, weights);
    document.head.appendChild(link);
    loaded.add(key);
  }
  // Force load of specific font-face descriptors so canvas can measure/paint them.
  try {
    await Promise.all([
      document.fonts.load(`900 90px "${heading}"`),
      document.fonts.load(`700 24px "${body}"`),
      document.fonts.load(`400 18px "${body}"`),
    ]);
    await document.fonts.ready;
  } catch {
    // ignore — canvas will fall back to system fonts
  }
}
