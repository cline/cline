import type { ReactNode } from "react";
export interface SearchComboboxOption {
    description?: string;
    icon?: ReactNode;
    label: string;
    value: string;
}
export interface SearchComboboxProps {
    ariaLabel: string;
    className?: string;
    disabled?: boolean;
    emptyText?: string;
    loading?: boolean;
    onValueChange: (value: string) => void;
    options: SearchComboboxOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    value?: string;
}
export declare function SearchCombobox({ ariaLabel, className, disabled, emptyText, loading, onValueChange, options, placeholder, searchPlaceholder, value, }: SearchComboboxProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=search-combobox.d.ts.map