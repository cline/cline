#!/bin/bash

# Get the directory of this script to make paths robust
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
# The 'evals' directory is the parent of the script's directory
EVALS_DIR=$(dirname "$SCRIPT_DIR")

# Navigate to the evals directory to ensure npm commands run correctly
cd "$EVALS_DIR"

# Re-install dependencies and build the CLI
echo "Ensuring dependencies are up to date and building CLI..."
npm install && npm run build:cli

# Check if the build was successful before proceeding
if [ $? -ne 0 ]; then
    echo "CLI build failed. Aborting evaluation."
    exit 1
fi

# Run the evaluation script, passing all arguments from the command line
echo "Running evaluation..."
node ./cli/dist/index.js run-diff-eval "$@"

# Check the exit code of the evaluation script
if [ $? -eq 0 ]; then
  # If the script succeeded, open the dashboard in the background
  echo "Evaluation complete. Starting dashboard..."
  (cd "$SCRIPT_DIR/dashboard" && streamlit run app.py &)
else
  # If the script failed, print an error message and exit
  echo "Evaluation failed. Dashboard will not be started."
  exit 1
fi
