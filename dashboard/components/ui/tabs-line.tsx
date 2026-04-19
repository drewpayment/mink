import type { ReactNode } from "react";

interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
  count?: number;
}

interface TabsProps<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

export function TabsLine<T extends string>({ tabs, active, onChange, className = "" }: TabsProps<T>) {
  return (
    <div className={`tabs ${className}`.trim()}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tab ${active === t.id ? "on" : ""}`.trim()}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && (
            <span className="muted mono" style={{ marginLeft: 6, fontSize: 10 }}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
