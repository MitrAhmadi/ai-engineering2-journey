// RichText.tsx — the small amount of markup a language model actually emits.
//
// Bodies are rendered as plain text with pre-wrap, which is right for a
// transcript. But a model that has just searched the web writes its citations
// as [label](url), and telling it not to is a rule it will forget by the third
// turn. Linkifying on the way out is the fix that stays fixed.
import type { ReactNode } from "react";

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()\[\]]+)/g;

export default function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  LINK.lastIndex = 0;
  while ((m = LINK.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const url = m[2] ?? m[3];
    const label = m[1] ?? m[3].replace(/^https?:\/\//, "").replace(/\/$/, "");
    out.push(
      <a key={m.index} href={url} target="_blank" rel="noreferrer noopener" title={url}>
        {label}
      </a>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));

  return <>{out}</>;
}
