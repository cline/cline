#!/bin/bash
source /etc/profile
source /devdata/miniforge3/etc/profile.d/conda.sh
conda activate unsloth_env2
cd /devdata/code/testAssistant
exec uvicorn main:app --host 0.0.0.0 --port 8900 --workers 8   --timeout-keep-alive 120  >> /devdata/code/testAssistant/app.log 2>&1
