#!/bin/bash

# Install roo-cline
echo "Installing roo-cline..."
npm install roo-cline

# Get version of installed roo-cline
VERSION=$(npm list roo-cline | grep roo-cline@ | cut -d'@' -f2 | tail -n1)
echo "Installed version: $VERSION"

# Install extension in Cursor
echo "Installing Cursor extension..."
echo $VERSION
cursor --install-extension "node_modules/roo-cline/bin/roo-cline-$VERSION.vsix"

# Uninstall roo-cline
echo "Cleaning up..."
npm uninstall roo-cline

echo "Done!"
