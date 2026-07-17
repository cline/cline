import type { ButtonHTMLAttributes } from "react";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    asChild?: boolean;
    iconOnly?: boolean;
    loading?: boolean;
    size?: "sm" | "md" | "lg";
    variant?: "primary" | "secondary" | "ghost" | "danger";
}
export declare const Button: import("react").ForwardRefExoticComponent<ButtonProps & import("react").RefAttributes<HTMLButtonElement>>;
//# sourceMappingURL=button.d.ts.map