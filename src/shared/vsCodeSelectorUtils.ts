import * as vscode from 'vscode';
import equal from "fast-deep-equal";

export const SELECTOR_SEPARATOR: string = " / ";


export function isVsCodeLmModelSelectorEqual(a: any, b: any): boolean {

    return equal(a, b);
}

export function stringifyVsCodeLmModelSelector(selector: vscode.LanguageModelChatSelector): string {

    if (!selector.vendor || !selector.family) {

        return selector.id || "";
    }

    return `${selector.vendor}${SELECTOR_SEPARATOR}${selector.family}`;
}

export function parseVsCodeLmModelSelector(stringifiedSelector: string): vscode.LanguageModelChatSelector {

    if (!stringifiedSelector.includes(SELECTOR_SEPARATOR)) {

        return { id: stringifiedSelector };
    }

    const parts: string[] = stringifiedSelector.split(SELECTOR_SEPARATOR);
    if (parts.length !== 2) {
        
        return { id: stringifiedSelector };
    }

    return { vendor: parts[0], family: parts[1] };
}