# 🚀 Multi-Model Diff Evaluation Workflow

This document explains how to use the enhanced multi-model diff evaluation system that supports running multiple models in a single benchmark run with proper retry logic for valid attempts.

## 🎯 Key Concepts

### **Benchmark Run**
- **One per CLI execution** - when you run the script once
- Contains multiple models, multiple cases
- All results stored in SQLite database for analysis

### **Test Case** 
- **Specific test scenario** from your JSON files
- Each case gets tested by ALL models in the run
- Example: "case_001.json", "case_002.json"

### **Result**
- **Every single attempt** by any model on any case
- Includes invalid attempts (wrong file, no tool call, etc.)
- System keeps attempting until N **valid** attempts per model per case

### **Valid Attempt**
A valid attempt is one where the model:
- Made a tool call (not `no_tool_calls` error)
- Used the correct tool (`replace_in_file`, not `wrong_tool_call` error)  
- Attempted to edit the correct file (not `wrong_file_edited` error)

## 🔧 CLI Usage

### **Basic Multi-Model Command**
```bash
node cli/dist/index.js run-diff-eval \
  --model-ids "anthropic/claude-3-5-sonnet-20241022,anthropic/claude-3-haiku-20240307" \
  --max-cases 5 \
  --valid-attempts-per-case 10 \
  --verbose
```

### **Parameters Explained**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `--model-ids` | Comma-separated list of models to test | `"claude-sonnet,gpt-4o,claude-haiku"` |
| `--max-cases` | Number of test cases to load | `5` (loads first 5 JSON files) |
| `--valid-attempts-per-case` | Target valid attempts per model per case | `10` |
| `--system-prompt-name` | System prompt to use | `basicSystemPrompt` |
| `--parsing-function` | Parsing function version | `parseAssistantMessageV2` |
| `--diff-edit-function` | Diff editing function version | `constructNewFileContentV2` |
| `--parallel` | Run tests in parallel | `--parallel` |
| `--verbose` | Enable detailed logging | `--verbose` |

## 📊 Example Workflow

### **Step 1: Run Multi-Model Evaluation**
```bash
# Compare Claude Sonnet vs Haiku with 5 cases, 10 valid attempts each
node cli/dist/index.js run-diff-eval \
  --model-ids "anthropic/claude-3-5-sonnet-20241022,anthropic/claude-3-haiku-20240307" \
  --max-cases 5 \
  --valid-attempts-per-case 10 \
  --verbose
```

**What happens:**
- **1 Benchmark Run** created
- **5 Test Cases** loaded from JSON files
- **Each model attempts each case until 10 valid attempts achieved**
- **All attempts stored** (valid and invalid) in SQLite database

### **Step 2: View Results in Dashboard**
```bash
cd diff-edits/dashboard
streamlit run app.py
```

**Dashboard Features:**
- **Hero Section**: Overview of current run with key metrics and model count
- **Model Performance Cards**: Individual cards for each model with:
  - Success rate percentage and letter grade (A-F)
  - Average latency to first token and first edit
  - Average cost per attempt
  - Total attempts and success count
- **Interactive Charts**: 
  - Success rate comparison bar chart
  - Latency vs Cost scatter plot with model clustering
  - Performance metrics visualization
- **Result Explorer**: Detailed drill-down with:
  - Individual result selection and filtering
  - Side-by-side file content comparison (original vs edited)
  - Raw model output viewing
  - Parsed tool call JSON inspection
  - Timing and cost metrics per attempt
  - Error analysis and categorization
- **Run Selection**: Browse and compare different evaluation runs
- **Real-time Updates**: Automatically refreshes with new evaluation data

**Dashboard URL**: http://localhost:8502 (opens automatically)

## 🎯 Data Storage Logic

### **Database Structure**
```
1 RUN
├── 5 CASES (case_001, case_002, case_003, case_004, case_005)
└── ~100+ RESULTS
    ├── Claude Sonnet on Case 1: 10+ attempts (until 10 valid)
    ├── Claude Sonnet on Case 2: 10+ attempts (until 10 valid)
    ├── ...
    ├── Claude Haiku on Case 1: 10+ attempts (until 10 valid)
    └── Claude Haiku on Case 2: 10+ attempts (until 10 valid)
```

### **Fair Comparison Logic**
- **All attempts stored** for debugging and analysis
- **Dashboard filters to valid attempts** for fair comparison
- **Success rates calculated** only from valid attempts
- **Bonus metrics** show attempt efficiency (how often models try correct file)

## 🔍 Query Examples

### **Valid Attempts Only**
```sql
SELECT * FROM results 
WHERE run_id = ? 
  AND error_enum NOT IN (1, 6, 7)  -- Exclude invalid attempts
```

### **Success Rate by Model**
```sql
SELECT 
  model_id,
  COUNT(*) as valid_attempts,
  AVG(CASE WHEN succeeded THEN 1.0 ELSE 0.0 END) as success_rate
FROM results 
WHERE run_id = ? 
  AND error_enum NOT IN (1, 6, 7)  -- Only valid attempts
GROUP BY model_id
```

## 🚀 Quick Start

1. **Build CLI:**
   ```bash
   cd cli && npm run build
   ```

2. **Run test script:**
   ```bash
   ./test-multi-model.sh
   ```

3. **View results:**
   ```bash
   cd diff-edits/dashboard && streamlit run app.py
   ```

## 🎯 Benefits

✅ **Fair Benchmarking** - Guaranteed N valid attempts per model per case  
✅ **Complete Data** - All attempts preserved for analysis  
✅ **Multi-Model Comparison** - Single run compares multiple models  
✅ **Rich Analytics** - Success rates, costs, latencies, error patterns  
✅ **Scalable Storage** - SQLite database with proper indexing  
✅ **Interactive Dashboard** - Streamlit-based visualization and drill-down
