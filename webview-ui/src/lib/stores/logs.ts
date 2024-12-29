import { atom } from 'nanostores';

export const logStore = {
  logSystem: (message: string) => {
    console.log('[System]', message);
  }
};