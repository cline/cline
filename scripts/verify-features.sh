#!/bin/bash
# Verify all custom features are present after rebuild

echo "🔍 Verifying Custom Features"
echo "=============================="
echo ""

ERRORS=0
WARNINGS=0

# Check MessageQueueService
echo "Checking Message Queue System..."
if [ ! -f "src/services/MessageQueueService.ts" ]; then
    echo "  ❌ MessageQueueService.ts MISSING"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ MessageQueueService.ts present"

    # Check if properly initialized in extension.ts
    if grep -q "MessageQueueService" "src/extension.ts"; then
        echo "  ✅ MessageQueueService initialized in extension.ts"
    else
        echo "  ⚠️  MessageQueueService not found in extension.ts"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check Grok support
echo ""
echo "Checking Grok Model Support..."
if [ ! -d "src/core/prompts/system-prompt/variants/grok" ]; then
    echo "  ❌ Grok variant directory MISSING"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ Grok variant directory present"

    if [ -f "src/core/prompts/system-prompt/variants/grok/config.ts" ]; then
        echo "  ✅ Grok config.ts present"
    else
        echo "  ❌ Grok config.ts MISSING"
        ERRORS=$((ERRORS + 1))
    fi

    if [ -f "src/core/prompts/system-prompt/variants/grok/template.ts" ]; then
        echo "  ✅ Grok template.ts present"
    else
        echo "  ❌ Grok template.ts MISSING"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Check Python CLI tools
echo ""
echo "Checking CLI Tools..."
for file in message_sender.py message_listener.py interactive_cli.py; do
    if [ ! -f "$file" ]; then
        echo "  ❌ $file MISSING"
        ERRORS=$((ERRORS + 1))
    else
        echo "  ✅ $file present"

        # Check if executable
        if [ -x "$file" ]; then
            echo "     ✅ Executable"
        else
            echo "     ⚠️  Not executable (chmod +x $file)"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
done

# Check cost tracking in export
echo ""
echo "Checking Cost Tracking..."
if [ ! -f "src/integrations/misc/export-markdown.ts" ]; then
    echo "  ❌ export-markdown.ts MISSING"
    ERRORS=$((ERRORS + 1))
else
    if grep -q "downloadTask" "src/integrations/misc/export-markdown.ts"; then
        echo "  ✅ downloadTask function present"
    else
        echo "  ❌ downloadTask function MISSING"
        ERRORS=$((ERRORS + 1))
    fi

    if grep -q "totalCost" "src/integrations/misc/export-markdown.ts"; then
        echo "  ✅ Cost tracking code present"
    else
        echo "  ❌ Cost tracking code MISSING"
        ERRORS=$((ERRORS + 1))
    fi

    if grep -q "tokensIn\|tokensOut" "src/integrations/misc/export-markdown.ts"; then
        echo "  ✅ Token tracking present"
    else
        echo "  ❌ Token tracking MISSING"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Check controller integration
echo ""
echo "Checking Controller Integration..."
if grep -q "downloadTask.*from.*export-markdown" "src/core/controller/index.ts"; then
    echo "  ✅ downloadTask imported in controller"
else
    echo "  ⚠️  downloadTask import not found"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "exportTaskWithId" "src/core/controller/index.ts"; then
    echo "  ✅ exportTaskWithId method present"
else
    echo "  ⚠️  exportTaskWithId method not found"
    WARNINGS=$((WARNINGS + 1))
fi

# Check documentation
echo ""
echo "Checking Documentation..."
for doc in MESSAGE_QUEUE_SYSTEM.md QUICK_START_GUIDE.md MAINTENANCE_GUIDE.md; do
    if [ ! -f "$doc" ]; then
        echo "  ⚠️  $doc missing"
        WARNINGS=$((WARNINGS + 1))
    else
        echo "  ✅ $doc present"
    fi
done

# Check message queue directory structure
echo ""
echo "Checking Message Queue Runtime..."
if [ ! -d ".message-queue" ]; then
    echo "  ⚠️  .message-queue directory missing (will be created at runtime)"
    WARNINGS=$((WARNINGS + 1))
else
    echo "  ✅ .message-queue directory present"

    for dir in inbox outbox responses; do
        if [ -d ".message-queue/$dir" ]; then
            echo "     ✅ $dir/ present"
        else
            echo "     ⚠️  $dir/ missing (will be created at runtime)"
        fi
    done
fi

# Summary
echo ""
echo "=============================="
echo "📊 Verification Summary"
echo "=============================="
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "🎉 Perfect! All features verified!"
    echo ""
    echo "✅ 0 errors, 0 warnings"
    echo ""
    echo "Ready for:"
    echo "  - VSIX installation"
    echo "  - Message queue testing"
    echo "  - Production use"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "✅ All critical features present"
    echo "⚠️  $WARNINGS non-critical warnings"
    echo ""
    echo "Warnings are typically:"
    echo "  - Missing documentation (not required for functionality)"
    echo "  - File permissions (easily fixed)"
    echo "  - Runtime directories (created automatically)"
    echo ""
    echo "Safe to proceed with testing"
    exit 0
else
    echo "❌ CRITICAL: $ERRORS feature(s) missing!"
    echo "⚠️  $WARNINGS warning(s)"
    echo ""
    echo "Action required:"
    echo "  1. Check if features were properly cherry-picked"
    echo "  2. Review merge conflicts"
    echo "  3. Manually restore missing files from backup"
    echo ""
    echo "DO NOT deploy until all features are restored!"
    exit 1
fi
