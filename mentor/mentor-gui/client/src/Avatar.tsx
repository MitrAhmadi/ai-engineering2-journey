// Avatar.tsx — a portrait for each practitioner, drawn as the thing they
// actually look for. Not decoration: the glyph is the theory.
//
//   Iris  (CBT)         a lattice of thoughts, one node ringed and tested
//   Marek (ISTDP)       the triangle of conflict, pressure rising from below
//   Sylvia (Analytical) the circle half in shadow, with the split-off piece outside it
//   Theo  (Behavioral)  three steps and the loop that keeps paying for them
//
// Inline SVG, no assets, no network. They inherit currentColor, so a voice's
// colour only has to be set once in CSS.

import type { ReactElement } from "react";

const GLYPH: Record<string, ReactElement> = {
  user: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="20" cy="20" r="10.5" opacity=".45" />
      <circle cx="20" cy="20" r="4" fill="currentColor" stroke="none" opacity=".8" />
    </g>
  ),
  cbt: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M12 28 L12 15 L24 15" opacity=".5" />
      <path d="M12 21 L27 21" opacity=".5" />
      <path d="M19 28 L19 12" opacity=".5" />
      <circle cx="12" cy="28" r="1.6" fill="currentColor" stroke="none" opacity=".6" />
      <circle cx="27" cy="21" r="1.6" fill="currentColor" stroke="none" opacity=".6" />
      <circle cx="19" cy="15" r="4.2" />
      <path d="M15.6 11.6 L22.4 18.4" />
    </g>
  ),
  istdp: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 9 L30.5 28 L9.5 28 Z" opacity=".55" />
      <circle cx="20" cy="9" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="30.5" cy="28" r="1.9" fill="currentColor" stroke="none" opacity=".55" />
      <circle cx="9.5" cy="28" r="1.9" fill="currentColor" stroke="none" opacity=".55" />
      <path d="M20 25.5 L20 15.5" />
      <path d="M17.2 18 L20 15 L22.8 18" />
    </g>
  ),
  analytical: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="18.5" cy="20" r="10.5" opacity=".55" />
      <path d="M18.5 9.5 A10.5 10.5 0 0 1 18.5 30.5 Z" fill="currentColor" stroke="none" opacity=".32" />
      <circle cx="18.5" cy="20" r="2.6" />
      <circle cx="31" cy="10.5" r="2.4" fill="currentColor" stroke="none" opacity=".85" />
    </g>
  ),
  behavioral: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 28 L15 28 L15 22 L21 22 L21 16 L27 16" opacity=".85" />
      <circle cx="27" cy="16" r="1.9" fill="currentColor" stroke="none" />
      <path d="M30 18.5 C33 25 27 31 20 30.6" opacity=".5" />
      <path d="M22.6 28.6 L19.6 30.8 L21.4 33.4" opacity=".5" />
    </g>
  ),
};

export default function Avatar({ id, size = 38 }: { id: string; size?: number }) {
  return (
    <span className={`avatar ${id}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        {GLYPH[id] ?? null}
      </svg>
    </span>
  );
}
