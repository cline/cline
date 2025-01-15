export const codeMode = 'code' as const;
export const architectMode = 'architect' as const;
export const askMode = 'ask' as const;

export type Mode = typeof codeMode | typeof architectMode | typeof askMode;