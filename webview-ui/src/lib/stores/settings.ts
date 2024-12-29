import { atom } from 'nanostores';

export const isDebugMode = atom<boolean>(false);
export const isEventLogsEnabled = atom<boolean>(false);
export const isLocalModelsEnabled = atom<boolean>(false);
export const latestBranchStore = atom<boolean>(false);
export const promptStore = atom<string>('');
export const providersStore = atom<Record<string, any>>({});

export const LOCAL_PROVIDERS = ['ollama', 'lmstudio'];