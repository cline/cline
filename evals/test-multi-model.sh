#!/bin/bash

echo "🚀 Testing Multi-Model Diff Evaluation System"
echo "============================================="

# Build CLI first
echo "📦 Building CLI..."
cd cli && npm run build && cd ..

echo ""
echo "🧪 Running multi-model evaluation with 2 models, 2 cases, 1 valid attempt per case per model"
echo ""

# Test command with multiple models
node cli/dist/index.js run-diff-eval \
  --model-ids "anthropic/claude-sonnet-4,x-ai/grok-3-beta" \
  --max-cases 2 \
  --valid-attempts-per-case 1 \
  --verbose

echo ""
echo "✅ Test completed! Check the database and dashboard for results."
echo ""
echo "🎯 To view results:"
echo "   cd diff-edits/dashboard && streamlit run app.py"
