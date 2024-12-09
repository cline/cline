#!/bin/bash

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use the Node.js version specified in .nvmrc
nvm use

# Install dependencies and build
npm run install:all

# Install vsce if not already installed
if ! command -v vsce &> /dev/null; then
    npm install -g @vscode/vsce
fi

# Package the extension into .vsix
vsce package
