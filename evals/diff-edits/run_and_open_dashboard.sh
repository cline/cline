#!/bin/bash

# First, build the CLI
npm run build:cli

# Run the evaluation script, passing all arguments from the command line
node cli/dist/index.js run-diff-eval "$@"

# After the eval is done, open the dashboard in the background
echo "Evaluation complete. Starting dashboard..."
(cd ./diff-edits/dashboard && streamlit run app.py &)
