// App.tsx — the shell. Two ways to use the same four practitioners and the
// same memory on disk: one at a time, or all of them in a room together.
import { useState } from "react";
import Solo from "./Solo";
import Room from "./Room";

export default function App() {
  // #room deep-links straight into the panel — handy for a demo, and for
  // opening the thing you actually want to show someone.
  const [view, setView] = useState<"solo" | "room">(
    typeof location !== "undefined" && location.hash === "#room" ? "room" : "solo",
  );

  return (
    <div className="shell">
      <nav className="views">
        <button className={view === "solo" ? "on" : ""} onClick={() => { setView("solo"); location.hash = ""; }}>
          one to one
        </button>
        <button className={view === "room" ? "on" : ""} onClick={() => { setView("room"); location.hash = "#room"; }}>
          the room
        </button>
      </nav>
      {view === "solo" ? <Solo /> : <Room />}
    </div>
  );
}
