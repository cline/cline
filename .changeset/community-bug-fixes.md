---
"cline": patch
---

## Bug Fixes (Community Reported Issues)

### API Provider Fixes
- **DeepSeek V3.2**: Handle XML tool call patterns in `reasoning_content` to prevent infinite loops ([#8365](https://github.com/cline/cline/issues/8365))
- **Cline API**: Show zero cost for free models with `:free` suffix ([#8182](https://github.com/cline/cline/issues/8182))
- **LM Studio**: Try v1/models endpoint first, fallback to api/v0/models ([#8030](https://github.com/cline/cline/issues/8030))

### UI/UX Fixes
- **Input Parsing**: Add safe parsing functions for decimal inputs to prevent NaN crashes ([#8129](https://github.com/cline/cline/issues/8129))
- **Persistence**: Add rate limiting for persistence errors to prevent error spam ([#8004](https://github.com/cline/cline/issues/8004))
- **Null Safety**: Fix potential null reference in capabilities provider info
