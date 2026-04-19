"use client";

import { Icon } from "@/components/ui/icon";
import { useRailEvents } from "@/hooks/use-rail-events";

export function Rail() {
  const events = useRailEvents(24);

  return (
    <aside className="rail">
      <div className="rail-head">
        <Icon name="activity" size={13} />
        <h4>Live activity</h4>
        <span className="live">
          <span className="d" /> streaming
        </span>
      </div>
      <div>
        {events.length === 0 && (
          <div className="empty">
            <h4>Waiting for events</h4>
            <span>activity will stream here as the daemon reports hook events.</span>
          </div>
        )}
        {events.map((e, i) => (
          <div key={e.id} className={`evt ${i < 2 ? "fresh" : ""}`.trim()}>
            <span className="t">{e.t}</span>
            <span className="c">
              <b>{e.msg}</b> <code>{e.tgt}</code>
              {e.meta && (
                <div
                  className={e.flavor === "hit" ? "hit" : "muted"}
                  style={{ marginTop: 2, fontSize: 10.5, fontFamily: "var(--font-mono), monospace" }}
                >
                  {e.meta}
                </div>
              )}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
