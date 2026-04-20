import type { ReactNode, CSSProperties } from "react";

interface CardProps {
  title?: ReactNode;
  sub?: ReactNode;
  tools?: ReactNode;
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Card({ title, sub, tools, flush, className = "", style, children }: CardProps) {
  const hasHead = title != null || tools != null;
  return (
    <div className={`card ${className}`.trim()} style={style}>
      {hasHead && (
        <div className="card-head">
          {title != null && (typeof title === "string" ? <h3>{title}</h3> : title)}
          {sub != null && <span className="sub">{sub}</span>}
          {tools != null && <div className="tools">{tools}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? "flush" : ""}`.trim()}>{children}</div>
    </div>
  );
}
