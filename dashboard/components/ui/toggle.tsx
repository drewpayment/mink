interface ToggleProps {
  on: boolean;
  onChange?: (v: boolean) => void;
  className?: string;
  ariaLabel?: string;
}

export function Toggle({ on, onChange, className = "", ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={`toggle ${on ? "on" : ""} ${className}`.trim()}
      onClick={() => onChange?.(!on)}
    />
  );
}
