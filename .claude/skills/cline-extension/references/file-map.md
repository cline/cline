# Cline Extension File Map

Complete directory structure with descriptions.

## Source Code (`src/`)

```
src/
├── extension.ts                    # Extension entry point, activation
│
├── core/
│   ├── controller/
│   │   ├── index.ts                # Main Controller class
│   │   ├── grpc-handler/           # RPC method implementations
│   │   │   ├── task/               # Task-related handlers
│   │   │   └── ui/                 # UI-related handlers
│   │   └── modules/                # Controller submodules
│   │
│   ├── task/
│   │   ├── index.ts                # Task runner - main execution loop
│   │   ├── TaskState.ts            # Per-task state container
│   │   ├── message-state.ts        # Message history persistence
│   │   └── tools/
│   │       ├── handlers/           # Individual tool handlers
│   │       └── ToolExecutor.ts     # Tool execution orchestration
│   │
│   ├── prompts/
│   │   ├── system-prompt/
│   │   │   ├── components/         # Reusable prompt sections
│   │   │   │   ├── rules.ts
│   │   │   │   ├── capabilities.ts
│   │   │   │   └── editing_files.ts
│   │   │   ├── variants/           # Model-specific configurations
│   │   │   │   ├── generic/        # Default fallback
│   │   │   │   ├── next-gen/       # Claude 4, GPT-5, Gemini 2.5
│   │   │   │   ├── xs/             # Small/local models
│   │   │   │   ├── gpt-5/
│   │   │   │   ├── gemini-3/
│   │   │   │   └── hermes/
│   │   │   ├── tools/              # Tool definitions
│   │   │   │   ├── init.ts         # Tool registration
│   │   │   │   └── *.ts            # Individual tool specs
│   │   │   └── __tests__/          # Prompt snapshot tests
│   │   └── commands.ts             # Slash command prompts
│   │
│   ├── storage/
│   │   ├── disk.ts                 # File-based persistence
│   │   └── utils/
│   │       └── state-helpers.ts    # State read/write utilities
│   │
│   ├── api/
│   │   ├── index.ts                # Provider factory
│   │   ├── anthropic.ts            # Anthropic Claude
│   │   ├── openai.ts               # OpenAI
│   │   └── ollama.ts               # Local models
│   │
│   └── ignore/
│       └── ClineIgnoreController.ts # .clineignore handling
│
├── shared/
│   ├── ExtensionMessage.ts         # ClineAsk, ClineSay, ExtensionState
│   ├── HistoryItem.ts              # Task history schema
│   ├── tools.ts                    # Tool enums
│   ├── api.ts                      # Provider types, model definitions
│   ├── storage/
│   │   └── state-keys.ts           # Settings/state schema (proto source)
│   └── proto-conversions/
│       ├── cline-message.ts        # ClineAsk/Say conversions
│       └── models/
│           └── api-configuration-conversion.ts
│
├── integrations/
│   ├── terminal/
│   │   └── CommandExecutor.ts      # Shell command execution
│   ├── checkpoints/
│   │   └── TaskCheckpointManager.ts # Git-based snapshots
│   └── browser/
│       └── BrowserManager.ts       # Browser automation
│
├── services/                       # Background services (NEW)
│   └── dag/                        # DAG analysis service
│       ├── DagBridge.ts            # Python subprocess bridge
│       ├── DagStore.ts             # Graph caching
│       └── DagWatcher.ts           # File change monitoring
│
└── generated/                      # Auto-generated (gitignored)
    ├── grpc-js/                    # Proto service implementations
    ├── nice-grpc/                  # Promise-based clients
    └── hosts/                      # Handler scaffolding
```

## Webview UI (`webview-ui/src/`)

```
webview-ui/src/
├── index.tsx                       # React entry point
├── App.tsx                         # Main app component
│
├── components/
│   ├── chat/
│   │   ├── ChatRow.tsx             # Message rendering (key file)
│   │   ├── ChatInput.tsx           # User input
│   │   └── task-header/
│   │       └── TaskHeader.tsx      # Task status display
│   │
│   ├── settings/
│   │   ├── ApiOptions.tsx          # Provider configuration
│   │   ├── FeatureSettingsSection.tsx
│   │   └── utils/
│   │       └── providerUtils.ts    # Provider helpers
│   │
│   ├── beads/                      # Bead UI (NEW)
│   │   ├── BeadReviewPanel.tsx
│   │   └── BeadTimeline.tsx
│   │
│   └── dag/                        # DAG UI (NEW)
│       ├── DagPanel.tsx
│       └── GraphCanvas.tsx
│
├── context/
│   └── ExtensionStateContext.tsx   # React state from extension
│
├── hooks/
│   └── useVSCode.ts                # VS Code API hook
│
├── services/
│   └── grpc-client.ts              # Generated gRPC client
│
└── utils/
    ├── slash-commands.ts           # Autocomplete
    └── validate.ts                 # Input validation
```

## Proto Files (`proto/`)

```
proto/cline/
├── task.proto          # Task operations, bead RPCs
├── ui.proto            # ClineAsk, ClineSay enums
├── models.proto        # ApiConfiguration, etc.
├── account.proto       # Authentication
├── state.proto         # Generated from state-keys.ts
└── common.proto        # Empty, StringRequest, etc.
```

## Configuration Files

```
.clinerules/
├── general.md          # Codebase patterns, gotchas
└── network.md          # Proxy/fetch guidelines

.claude/
├── skills/             # Agent skills
├── commands/           # Slash commands (legacy)
└── settings.json       # Claude Code settings
```

## Key File Relationships

```
state-keys.ts ──generates──► state.proto ──generates──► shared/proto/*
                                                              │
                                                              ▼
ExtensionMessage.ts ◄────uses──── proto-conversions/* ◄────uses
        │
        ▼
Controller.getStateToPostToWebview() ──sends──► webview ExtensionStateContext
```
