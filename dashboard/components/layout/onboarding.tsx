"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Btn } from "@/components/ui/btn";

const STEPS = [
  { done: true,  t: "Install mink",           d: "bun add -g @drewpayment/mink" },
  { done: true,  t: "Initialize project",     d: "mink init in your repo — registers Claude Code hooks" },
  { done: false, t: "Start the daemon",       d: "Runs scheduled tasks and streams live events to this UI" },
  { done: false, t: "Optional — set up sync", d: "Git-backed sync of ~/.mink across machines" },
  { done: false, t: "Optional — Discord bot", d: "DM your bot to capture, search, summarize from anywhere" },
];

export function Onboarding() {
  const [copied, setCopied] = useState(false);

  function copyCmd() {
    navigator.clipboard?.writeText("mink daemon start").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="sb-logo" style={{ width: 28, height: 28, fontSize: 14 }}>M</div>
          <div style={{ marginLeft: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-0)" }}>Mink</div>
            <div className="muted" style={{ fontSize: 11 }}>command center</div>
          </div>
          <span style={{ marginLeft: "auto" }} className="chip">daemon · offline</span>
        </div>

        <h2>Welcome back</h2>
        <p className="sub">
          The daemon isn&apos;t running. Start it to unlock the full command center — live sessions,
          scheduler, activity feed, and sync.
        </p>

        <button
          type="button"
          className="cmd"
          onClick={copyCmd}
          title="Click to copy"
          style={{ textAlign: "left", width: "100%" }}
        >
          <span className="prompt">$</span>
          <span>mink daemon start</span>
          <span className="copy">{copied ? "copied!" : "click to copy"}</span>
        </button>

        <div className="row tight" style={{ marginBottom: 14 }}>
          <Btn variant="primary" icon="play" onClick={copyCmd}>Copy start command</Btn>
          <Btn variant="ghost" icon="book" onClick={() => window.open("https://github.com/drewpayment/mink", "_blank")}>
            Read docs
          </Btn>
        </div>

        <div>
          {STEPS.map((s, i) => (
            <div key={i} className={`onboard-step ${s.done ? "done" : ""}`.trim()}>
              <div className="n">{s.done ? <Icon name="check" size={11} /> : i + 1}</div>
              <div className="body">
                <div className="t">{s.t}</div>
                <div className="d">{s.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
