#!/bin/bash

# Diff Edits Evaluation Dashboard Launcher
echo "🚀 Starting Diff Edits Evaluation Dashboard..."

# Check if we're in the right directory
if [ ! -f "app.py" ]; then
    echo "❌ Error: app.py not found. Please run this script from the dashboard directory."
    exit 1
fi

# Check if database exists
if [ ! -f "../evals.db" ]; then
    echo "⚠️  Warning: Database file ../evals.db not found."
    echo "   Make sure you've run some evaluations first to populate the database."
    echo "   You can run: node ../cli/dist/index.js run-diff-eval --model-id anthropic/claude-sonnet-4 --max-cases 1"
    echo ""
fi

# Check if requirements are installed
echo "📦 Checking Python dependencies..."
if ! python -c "import streamlit, plotly, pandas" 2>/dev/null; then
    echo "📥 Installing required packages..."
    pip install -r requirements.txt
fi

echo "🌐 Launching Streamlit dashboard..."
echo "   Dashboard will open in your browser at http://localhost:8501"
echo "   Press Ctrl+C to stop the dashboard"
echo ""

# Launch Streamlit
streamlit run app.py
