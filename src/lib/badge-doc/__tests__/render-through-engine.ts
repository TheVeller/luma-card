// Test bridge: runs the production render path (renderToCanvas) against the
// stubbed browser globals and hands back what would have been drawn.

import { renderToCanvas } from "../render";
import { CLASSIC_BADGE_DOC } from "../presets/classic";
import type { StyleSpec } from "@/lib/style-spec";
import type { TraceEntry } from "./fake-canvas";

export type LegacyInputs = {
  theme: { name: string; subtitle: string; url: string; coverUrl: string | null; dateLine: string };
  spec: StyleSpec;
  photoDataUrl: string;
  firstName: string;
  role: string;
};

export async function renderToCanvasTrace(inputs: LegacyInputs): Promise<TraceEntry[]> {
  const canvas = (await renderToCanvas({
    doc: CLASSIC_BADGE_DOC,
    spec: inputs.spec,
    event: {
      name: inputs.theme.name,
      subtitle: inputs.theme.subtitle,
      dateLine: inputs.theme.dateLine,
      url: inputs.theme.url,
      coverUrl: inputs.theme.coverUrl,
    },
    user: {
      firstName: inputs.firstName,
      // No default here: the "CREATOR" fallback lives in the editor, so both
      // sides of the comparison must see exactly the role they were given.
      role: inputs.role,
      photo: inputs.photoDataUrl,
    },
  })) as unknown as { getContext: () => { trace: TraceEntry[] } };
  return canvas.getContext().trace;
}
