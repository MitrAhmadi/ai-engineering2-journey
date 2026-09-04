// ToolReceipt.tsx — what a tool call looks like when it happens.
//
// Watching the write is the point of the interface: a commitment becoming a
// record, a claim being checked. A search that shows no sources is just the
// model asserting things again, so the links are part of the receipt rather
// than a detail tucked away in the model's context.
import type { JSX } from "react";

interface Source { title: string; url: string }

export interface ToolEvent {
  name: string;
  args: Record<string, any>;
  label: string;
  sources?: Source[];
}

// A magnifier drawn rather than typed: the Unicode one (U+2315) renders as an
// illegible dot at this size in most fonts.
const MAGNIFIER = (
  <svg viewBox="0 0 14 14" width="12" height="12" fill="none"
       stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="6" cy="6" r="4" />
    <path d="M9 9 L12.5 12.5" />
  </svg>
);

const ICON: Record<string, JSX.Element | string> = {
  record_goal: "\u25ce",
  update_goal: "\u2713",
  flag_limiting_belief: "\u25b3",
  web_search: MAGNIFIER,
  find_support: MAGNIFIER,
};

/** update_goal is coloured by outcome, not by which tool ran. */
function variant(t: ToolEvent): string {
  if (t.name !== "update_goal") return t.name;
  return `update_goal ${t.args.status ?? ""}`;
}

export default function ToolReceipt({ event }: { event: ToolEvent }) {
  return (
    <div className={`tool ${variant(event)}`}>
      <div className="tool-line">
        <span className="tool-icon">{ICON[event.name] ?? "\u2022"}</span>
        {event.label}
      </div>
      {!!event.sources?.length && (
        <div className="sources">
          {event.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer noopener" title={s.url}>
              {s.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
