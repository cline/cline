export type Change = {
  type: 'context' | 'add' | 'remove';
  content: string;
  indent: string;
  originalLine?: string;
};

export type Hunk = {
  changes: Change[];
};

export type Diff = {
  hunks: Hunk[];
}; 