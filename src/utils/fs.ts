import * as fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';

export const createDirectoriesForFile = async (filePath: string): Promise<string[]> => {
  console.debug(`Creating directories for file: ${filePath}`);
  const dirPath = path.posix.dirname(filePath); // Use path.posix to ensure consistent path separators
  console.debug(`Directory path: ${dirPath}`);
  const directories = dirPath.split(path.posix.sep).filter(dir => dir !== '');
  console.debug(`Split directories: ${directories}`);
  const createdDirectories: string[] = [];

  let currentPath = '';
  for (const dir of directories) {
    currentPath = path.posix.join('/', currentPath, dir); // Use path.posix to ensure consistent path separators and ensure starting from root
    console.debug(`Checking directory: ${currentPath}`);
    if (!vol.existsSync(currentPath)) {
      vol.mkdirSync(currentPath); // Use mkdirSync to create the directory
      createdDirectories.push(dir); // Push directory name instead of full path
      console.debug(`Created directory: ${currentPath}`);
    }
  }

  console.debug(`Created directories: ${createdDirectories}`);
  return createdDirectories;
};

export const fileExistsAtPath = async (filePath: string): Promise<boolean> => {
  return vol.existsSync(filePath);
};
