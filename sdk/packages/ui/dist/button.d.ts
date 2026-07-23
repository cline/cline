import type { ButtonHTMLAttributes, HTMLAttributes, MouseEventHandler, ReactElement, RefAttributes } from "react";
interface ButtonStyleProps {
    disabled?: boolean;
    loading?: boolean;
    size?: "sm" | "md" | "lg";
    type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
    variant?: "primary" | "secondary" | "ghost" | "danger";
}
type IconAccessibility = {
    "aria-label": string;
    "aria-labelledby"?: string;
    iconOnly: true;
} | {
    "aria-label"?: string;
    "aria-labelledby": string;
    iconOnly: true;
} | {
    "aria-label"?: string;
    "aria-labelledby"?: string;
    iconOnly?: false;
};
export type NativeButtonProps = ButtonStyleProps & IconAccessibility & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-labelledby"> & {
    asChild?: false;
};
export type SlottedButtonProps = ButtonStyleProps & IconAccessibility & Omit<HTMLAttributes<HTMLElement>, "aria-label" | "aria-labelledby" | "children" | "onClick"> & {
    asChild: true;
    children: ReactElement;
    onClick?: MouseEventHandler<HTMLElement>;
};
export type ButtonProps = NativeButtonProps | SlottedButtonProps;
interface ButtonComponent {
    (props: SlottedButtonProps & RefAttributes<HTMLElement>): ReactElement | null;
    (props: NativeButtonProps & RefAttributes<HTMLButtonElement>): ReactElement | null;
    displayName?: string;
}
export declare const Button: ButtonComponent;
export {};
//# sourceMappingURL=button.d.ts.map