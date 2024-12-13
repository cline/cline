export interface CodeBlock {
    filename: string;
    original: string;
    new: string;
}

export interface MergeResult {
    success: boolean;
    error?: string;
    content?: string;
}

export const MERGE_MARKERS = {
  HEAD: "<<<<<<< SEARCH",
  DIVIDER: "=======",
  TAIL: ">>>>>>> REPLACE"
} as const;
