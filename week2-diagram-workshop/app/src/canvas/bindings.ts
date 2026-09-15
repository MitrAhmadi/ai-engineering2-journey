// Arrows that point at shapes drawn in an EARLIER call.
//
// `convertToExcalidrawElements` resolves `start`/`end` ids only within the
// batch you hand it. That is fine for "draw me a diagram" — shapes and arrows
// arrive together. It breaks the moment someone says "now add a cache between
// the API and the database": the new arrow names two shapes that are already
// on the canvas, the helper cannot see them, and you get an arrow lying
// unattached across the scene.
//
// The symptom is subtle and the cause is not obvious, which is exactly why it
// is worth its own file rather than four lines buried in a click handler.
//
// The fix is two-sided, because Excalidraw stores every binding twice:
//   - the arrow knows its endpoints        (startBinding / endBinding)
//   - each shape knows its arrows          (boundElements)
// Miss the second half and the arrow attaches, but dragging the box leaves it
// behind.

interface Bindable {
  id: string;
  startBinding?: unknown;
  endBinding?: unknown;
}

export interface PendingBinding {
  id: string;
  type: "arrow";
}

/**
 * Patch arrows in `converted` that reference ids in `existingIds`, and report
 * which existing shapes need a back-reference adding.
 */
export function bindAcrossCalls(
  raw: Record<string, unknown>[],
  converted: Bindable[],
  existingIds: Set<string>
): Map<string, PendingBinding[]> {
  const backRefs = new Map<string, PendingBinding[]>();

  const remember = (shapeId: string, arrowId: string) => {
    const list = backRefs.get(shapeId) ?? [];
    list.push({ id: arrowId, type: "arrow" });
    backRefs.set(shapeId, list);
  };

  for (const el of raw) {
    if (el.type !== "arrow") continue;
    const arrow = converted.find((c) => c.id === el.id);
    if (!arrow) continue;

    for (const [end, key] of [
      ["start", "startBinding"],
      ["end", "endBinding"],
    ] as const) {
      const target = (el[end] as { id?: string } | undefined)?.id;
      // Only fill in what the helper left empty, and only for shapes that are
      // genuinely on the canvas — an id nobody ever created stays unbound so
      // the mistake is visible instead of silently repaired.
      if (!target || !existingIds.has(target) || arrow[key]) continue;
      (arrow as unknown as Record<string, unknown>)[key] = { elementId: target, focus: 0, gap: 4 };
      remember(target, el.id as string);
    }
  }

  return backRefs;
}

/** Merge new arrow references into a shape's existing boundElements. */
export function mergeBoundElements(
  existing: readonly { id: string; type: string }[] | null | undefined,
  incoming: PendingBinding[]
): { id: string; type: string }[] {
  const merged = [...(existing ?? [])];
  for (const binding of incoming) {
    if (!merged.some((b) => b.id === binding.id)) merged.push(binding);
  }
  return merged;
}
