import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

type Variant = "primary" | "danger" | "ghost";
type Size = "sm" | "md";

interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  icon?: IconName;
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

export function Btn({ icon, variant, size, className = "", children, ...rest }: BtnProps) {
  const classes = ["btn"];
  if (variant) classes.push(variant);
  if (size) classes.push(size);
  if (className) classes.push(className);
  return (
    <button className={classes.join(" ")} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
