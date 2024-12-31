import React from 'react';

declare module '@vscode/webview-ui-toolkit/react' {
    export const VSCodeCheckbox: React.FC<any>;
    export const VSCodeDropdown: React.FC<any>;
    export const VSCodeLink: React.FC<any>;
    export const VSCodeOption: React.FC<any>;
    export const VSCodeRadio: React.FC<any>;
    export const VSCodeRadioGroup: React.FC<any>;
    export const VSCodeTextField: React.FC<any>;
}
