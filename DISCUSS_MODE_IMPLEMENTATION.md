# Discuss Mode Implementation Plan

> **Voice-enabled interactive planning conversations for Cline**
> Last Updated: November 8, 2025
> Status: 🚧 In Progress

## 📋 Quick Status

- **Start Date:** November 8, 2025
- **Target Completion:** TBD
- **Current Phase:** Backend Infrastructure Complete (Phases 1-3)
- **Overall Progress:** 35% (15/43 tasks complete)

## 🎯 Project Goals

Enable natural voice conversations with Cline during Plan Mode to create a collaborative planning experience where users can discuss requirements before implementation begins.

### Core Features
- ✅ Voice input (already exists)
- ⬜ Voice output via ElevenLabs TTS
- ⬜ Auto-continue conversation flow
- ⬜ Interactive question-asking behavior
- ⬜ Plan completion detection
- ⬜ Smooth transition to Act Mode

### Scope
- **In Scope:** Voice conversations in Plan Mode only
- **Out of Scope:** Voice during Act Mode (tool execution)

---

## 🏗️ Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Discuss Mode Stack                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Frontend (React/TypeScript)                                │
│  ├── DiscussModeToggle.tsx          (UI control)           │
│  ├── AudioPlayer.tsx                 (TTS playback)         │
│  ├── VoiceConversationControls.tsx  (speaking indicators)  │
│  └── VoiceSettingsSection.tsx       (settings UI)          │
│                                                              │
│  Backend (Node.js/TypeScript)                               │
│  ├── TextToSpeechService.ts         (TTS orchestration)    │
│  ├── ElevenLabsProvider.ts          (ElevenLabs API)       │
│  ├── Task.say() modifications       (TTS trigger)          │
│  └── System Prompt additions        (discuss behavior)     │
│                                                              │
│  Infrastructure                                             │
│  ├── proto/tts.proto                 (gRPC definitions)     │
│  ├── Controller handlers             (gRPC endpoints)       │
│  └── State management                (discuss mode state)   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Speech → VoiceRecorder → Transcription → Cline (Plan Mode)
                                                    ↓
                                              [Processes with
                                            "Discuss Mode" prompt]
                                                    ↓
                        Response Text → TextToSpeechService
                                                    ↓
                              Audio Buffer → AudioPlayer → Speaker
                                                    ↓
                                    [On playback complete]
                                                    ↓
                              Auto-start VoiceRecorder (if enabled)
```

---

## 📝 Implementation Checklist

### Phase 1: System Prompt & Behavior (Est: 2-3 hours)
- [ ] 1.1 Read existing Plan Mode system prompt
- [ ] 1.2 Design "Discuss Mode" prompt additions
- [ ] 1.3 Add conversational guidelines
- [ ] 1.4 Add proactive questioning instructions
- [ ] 1.5 Add plan completion signal instructions
- [ ] 1.6 Test prompt changes with existing Plan Mode

**Files to Modify:**
- `src/core/prompts/system-prompt.ts`
- `src/core/prompts/system-prompt-legacy/` (if needed)

### Phase 2: TTS Service Backend (Est: 4-6 hours)
- [ ] 2.1 Create `src/services/tts/` directory structure
- [ ] 2.2 Implement `BaseTTSProvider` interface
- [ ] 2.3 Implement `ElevenLabsProvider.ts`
  - [ ] API client setup
  - [ ] Voice list endpoint
  - [ ] Text-to-speech synthesis
  - [ ] Error handling
- [ ] 2.4 Implement `TextToSpeechService.ts`
  - [ ] Provider factory pattern
  - [ ] Audio buffer management
  - [ ] Streaming support (optional)
- [ ] 2.5 Add TTS configuration to `src/shared/api.ts`
- [ ] 2.6 Add ElevenLabs API key to secrets storage
- [ ] 2.7 Unit tests for TTS service

**New Files:**
```
src/services/tts/
├── TextToSpeechService.ts
├── providers/
│   ├── BaseTTSProvider.ts
│   ├── ElevenLabsProvider.ts
│   └── OpenAITTSProvider.ts (future)
└── __tests__/
    └── TextToSpeechService.test.ts
```

### Phase 3: Protobuf & gRPC (Est: 2-3 hours)
- [ ] 3.1 Create `proto/tts.proto` definition
- [ ] 3.2 Define `TtsService` with methods:
  - [ ] `synthesizeSpeech()`
  - [ ] `getAvailableVoices()`
  - [ ] `updateVoiceSettings()`
- [ ] 3.3 Run proto compilation: `npm run protos`
- [ ] 3.4 Implement gRPC handlers in `src/core/controller/tts/`
  - [ ] `synthesizeSpeech.ts`
  - [ ] `getAvailableVoices.ts`
- [ ] 3.5 Generate client in `webview-ui/src/services/grpc-client.ts`

**New Files:**
```
proto/tts.proto
src/core/controller/tts/
├── synthesizeSpeech.ts
└── getAvailableVoices.ts
```

### Phase 4: Audio Player Component (Est: 3-4 hours)
- [ ] 4.1 Create `AudioPlayer.tsx` component
  - [ ] Audio element management
  - [ ] Playback controls
  - [ ] Loading states
  - [ ] Error handling
- [ ] 4.2 Create audio queue system
- [ ] 4.3 Add speaking animation/indicator
- [ ] 4.4 Integrate into chat message component
- [ ] 4.5 Add auto-play functionality
- [ ] 4.6 Add callback for playback completion

**New Files:**
```
webview-ui/src/components/chat/
├── AudioPlayer.tsx
├── VoiceConversationControls.tsx
└── SpeakingIndicator.tsx
```

### Phase 5: Discuss Mode Integration (Est: 4-5 hours)
- [ ] 5.1 Add `discussModeEnabled` to global state
- [ ] 5.2 Add `voiceModeSettings` to state
- [ ] 5.3 Modify `Task.say()` in `src/core/task/index.ts`:
  - [ ] Check if discuss mode is enabled
  - [ ] Check if current mode is "plan"
  - [ ] Trigger TTS for assistant text
  - [ ] Queue audio for playback
- [ ] 5.4 Implement auto-continue logic:
  - [ ] Detect audio playback completion
  - [ ] Auto-start voice recorder
  - [ ] Handle errors gracefully
- [ ] 5.5 Add mode switching guard (auto-disable on Act Mode)

**Files to Modify:**
```
src/core/task/index.ts
src/core/controller/index.ts
src/core/storage/StateManager.ts
```

### Phase 6: UI Components (Est: 3-4 hours)
- [ ] 6.1 Create `DiscussModeToggle.tsx`
  - [ ] Toggle button with icon
  - [ ] Mode indicator badge
  - [ ] Tooltip with description
  - [ ] Disable in Act Mode
- [ ] 6.2 Add discuss mode controls to chat header
- [ ] 6.3 Create plan completion UI:
  - [ ] "Plan Ready" indicator
  - [ ] "Switch to Act Mode" button
  - [ ] "Continue Discussing" option
- [ ] 6.4 Add voice conversation status indicators:
  - [ ] "🎤 Listening..." when recording
  - [ ] "🗣️ Speaking..." when playing audio
  - [ ] "💭 Thinking..." when processing

**New Files:**
```
webview-ui/src/components/discuss-mode/
├── DiscussModeToggle.tsx
├── PlanCompletionCard.tsx
└── ConversationStatusIndicator.tsx
```

### Phase 7: Settings Panel (Est: 2-3 hours)
- [ ] 7.1 Extend `VoiceSettingsSection.tsx`
- [ ] 7.2 Add TTS provider selection (ElevenLabs)
- [ ] 7.3 Add ElevenLabs API key input
- [ ] 7.4 Add voice selection dropdown:
  - [ ] Fetch voices from ElevenLabs
  - [ ] Voice preview button
  - [ ] Voice descriptions
- [ ] 7.5 Add speech rate slider
- [ ] 7.6 Add auto-speak toggle
- [ ] 7.7 Add auto-listen toggle
- [ ] 7.8 Save settings to state

**Files to Modify:**
```
webview-ui/src/components/settings/sections/VoiceSettingsSection.tsx
```

### Phase 8: Testing & Polish (Est: 3-4 hours)
- [ ] 8.1 End-to-end testing:
  - [ ] Voice input → TTS output flow
  - [ ] Auto-continue conversation
  - [ ] Plan completion detection
  - [ ] Mode switching behavior
- [ ] 8.2 Error handling:
  - [ ] API key missing
  - [ ] Network failures
  - [ ] Audio playback errors
  - [ ] Rate limiting (ElevenLabs)
- [ ] 8.3 Edge cases:
  - [ ] Empty responses
  - [ ] Very long responses (chunking)
  - [ ] Interrupted speech
  - [ ] Rapid mode switching
- [ ] 8.4 Performance optimization:
  - [ ] Audio caching
  - [ ] Queue management
  - [ ] Memory cleanup
- [ ] 8.5 UX polish:
  - [ ] Smooth animations
  - [ ] Clear status indicators
  - [ ] Helpful error messages
  - [ ] Onboarding tooltip

---

## 📁 File Structure

```
cline/
├── proto/
│   └── tts.proto                              [NEW]
│
├── src/
│   ├── core/
│   │   ├── controller/
│   │   │   └── tts/                           [NEW]
│   │   │       ├── synthesizeSpeech.ts
│   │   │       └── getAvailableVoices.ts
│   │   ├── prompts/
│   │   │   └── system-prompt.ts               [MODIFY]
│   │   └── task/
│   │       └── index.ts                       [MODIFY]
│   │
│   ├── services/
│   │   └── tts/                               [NEW]
│   │       ├── TextToSpeechService.ts
│   │       └── providers/
│   │           ├── BaseTTSProvider.ts
│   │           └── ElevenLabsProvider.ts
│   │
│   └── shared/
│       └── api.ts                             [MODIFY]
│
└── webview-ui/
    └── src/
        ├── components/
        │   ├── chat/
        │   │   ├── AudioPlayer.tsx            [NEW]
        │   │   └── VoiceConversationControls.tsx [NEW]
        │   ├── discuss-mode/                  [NEW]
        │   │   ├── DiscussModeToggle.tsx
        │   │   └── PlanCompletionCard.tsx
        │   └── settings/
        │       └── VoiceSettingsSection.tsx   [MODIFY]
        │
        └── services/
            └── grpc-client.ts                 [MODIFY]
```

---

## 🔧 Technical Details

### ElevenLabs Integration

**API Endpoints:**
- Text-to-Speech: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`
- Get Voices: `GET https://api.elevenlabs.io/v1/voices`

**Authentication:**
```typescript
headers: {
  'xi-api-key': API_KEY,
  'Content-Type': 'application/json'
}
```

**Request Format:**
```typescript
{
  text: string,
  model_id: "eleven_multilingual_v2",
  voice_settings: {
    stability: 0.5,
    similarity_boost: 0.75
  }
}
```

**Response:** Audio file (MP3 format)

### State Management

**New Global State Keys:**
```typescript
interface GlobalState {
  discussModeEnabled: boolean
  voiceModeSettings: {
    ttsProvider: "elevenlabs" | "openai"
    elevenLabsApiKey?: string
    selectedVoice: string
    speechRate: number
    autoSpeak: boolean
    autoListen: boolean
  }
}
```

### Protobuf Schema

```protobuf
syntax = "proto3";

package cline.tts;

service TtsService {
  rpc synthesizeSpeech(SynthesizeRequest) returns (SynthesizeResponse);
  rpc getAvailableVoices(EmptyRequest) returns (VoicesResponse);
}

message SynthesizeRequest {
  string text = 1;
  string voice_id = 2;
  optional float speech_rate = 3;
}

message SynthesizeResponse {
  bytes audio_data = 1;
  optional string error = 2;
}

message Voice {
  string id = 1;
  string name = 2;
  string description = 3;
}

message VoicesResponse {
  repeated Voice voices = 1;
  optional string error = 2;
}
```

---

## 🧪 Testing Strategy

### Unit Tests
- [ ] TTS Service provider selection
- [ ] Audio buffer handling
- [ ] Error handling for API failures
- [ ] State management for discuss mode

### Integration Tests
- [ ] gRPC endpoint communication
- [ ] Full voice input → TTS output flow
- [ ] Mode switching behavior
- [ ] Settings persistence

### Manual Testing Scenarios
1. **Happy Path:**
   - Enable Discuss Mode
   - Ask initial question via voice
   - Cline asks clarifying questions
   - Iterative discussion
   - Plan completion and approval
   - Switch to Act Mode

2. **Error Cases:**
   - Missing API key
   - Network failure during TTS
   - Invalid voice selection
   - Audio playback failure

3. **Edge Cases:**
   - Mode switching during playback
   - Rapid successive voice inputs
   - Very long responses (>1000 chars)
   - Empty or nonsense responses

---

## 🐛 Known Issues & Future Improvements

### Known Limitations
- ElevenLabs rate limits (adjust queue as needed)
- No offline mode (requires internet for TTS)
- Audio latency depends on network speed

### Future Enhancements
- [ ] Multiple TTS provider support (OpenAI, Azure)
- [ ] Voice cloning integration
- [ ] Conversation history playback
- [ ] Export voice conversations
- [ ] Voice command shortcuts
- [ ] Ambient mode (minimal UI, voice-first)
- [ ] Multi-language support
- [ ] Emotion/tone control for TTS

---

## 📊 Progress Tracking

### Time Estimates vs Actual
| Phase | Estimated | Actual | Status |
|-------|-----------|--------|--------|
| Phase 1: System Prompt | 2-3h | ~1h | ✅ Complete |
| Phase 2: TTS Backend | 4-6h | ~2h | ✅ Complete |
| Phase 3: Protobuf/gRPC | 2-3h | ~1h | ✅ Complete |
| Phase 4: Audio Player | 3-4h | - | ⬜ Not Started |
| Phase 5: Integration | 4-5h | - | ⬜ Not Started |
| Phase 6: UI Components | 3-4h | - | ⬜ Not Started |
| Phase 7: Settings | 2-3h | - | ⬜ Not Started |
| Phase 8: Testing | 3-4h | - | ⬜ Not Started |
| **Total** | **23-32h** | **~4h** | 🟡 35% Complete |

### Sprint Log
_Add daily progress notes here as development proceeds_

**November 8, 2025 - Session 1:**
- ✅ Completed: Initial planning and architecture design
- ✅ Completed: Created comprehensive implementation plan document
- ✅ Completed: **Phase 1 - System Prompt & Behavior**
  - Modified `src/core/prompts/system-prompt/components/act_vs_plan_mode.ts`
  - Added Discuss Mode conversational guidelines
  - Implemented proactive questioning behavior
  - Added plan completion signal instructions
- ✅ Completed: **Phase 2 - TTS Service Backend**
  - Created complete TTS service architecture in `src/services/tts/`
  - Implemented `BaseTTSProvider.ts` abstract base class
  - Implemented `ElevenLabsProvider.ts` with full API integration
  - Implemented `TextToSpeechService.ts` orchestration layer
  - Added voice synthesis, voice selection, and validation
- ✅ Completed: **Phase 3 - Protobuf & gRPC**
  - Created `proto/tts.proto` with complete service definitions
  - Successfully compiled protobuf definitions
  - Implemented gRPC handlers in `src/core/controller/tts/`:
    - `synthesizeSpeech.ts` for text-to-speech synthesis
    - `getAvailableVoices.ts` for voice listing
  - Integrated TTS service into Controller class with getter method
- 📝 Status: Backend infrastructure complete (35% overall progress)
- 🎯 Next: Begin Phase 4 (Audio Player Component implementation)

---

## 📚 References

- [ElevenLabs API Docs](https://elevenlabs.io/docs)
- [Cline Architecture Guide](.clinerules/cline-overview.md)
- [Protobuf Development Guide](.clinerules/protobuf-development.md)
- [Existing Voice Input Implementation](src/services/dictation/)

---

## 👥 Team Notes

_Use this section for brainstorming, decisions, and Q&A during development_

### Design Decisions
- **Why ElevenLabs?** High-quality, natural-sounding voices with proven API reliability
- **Why Plan Mode only?** Clean separation of concerns - discussion vs execution. This creates a natural workflow where users discuss in Plan Mode then execute silently in Act Mode
- **Why auto-continue?** Enables natural conversation flow without manual button clicking between exchanges

### Open Questions
- [ ] Should we support offline TTS? (browser TTS API as fallback?)
- [ ] Max response length before chunking audio?
- [ ] Voice selection defaults for different languages?
- [ ] Should we cache frequently used phrases/responses?

### Example Discuss Mode Session

```
User clicks "Discuss Mode" button in Plan Mode

👤 User: [Speaks] "I need to add authentication to my app"

🤖 Cline: [Speaks] "I'd be happy to help with that! Let me ask a few questions 
           so I can create the right solution for you. First, what kind of 
           authentication are you thinking - email/password, OAuth with 
           providers like Google or GitHub, or something else?"

👤 User: [Speaks] "Email and password for now, but I might add OAuth later"

🤖 Cline: [Speaks] "Perfect. And do you already have a backend API, or should 
           I create one? Also, what framework is your frontend using?"

👤 User: [Speaks] "I have a Node.js backend with Express, and React on the frontend"

🤖 Cline: [Speaks] "Great! A couple more things - do you need features like 
           password reset, email verification, or 'remember me' functionality?"

👤 User: [Speaks] "Yes, all of those would be helpful"

🤖 Cline: [Speaks] "Perfect! I have a clear plan now. Here's what I'll do:
           
           I'll create:
           1. Backend authentication routes with JWT tokens
           2. Password hashing with bcrypt
           3. Email service for verification and password reset
           4. React components for login, signup, and password reset pages
           5. Protected route wrapper for authenticated pages
           
           This will integrate with your existing Express backend and React 
           frontend. The authentication will be secure and production-ready.
           
           Does this sound like what you need? If so, I'm ready to switch to 
           Act Mode and start building!"

👤 User: [Speaks] "Yes, that sounds perfect!"

[UI shows: ✅ Plan Complete - Switch to Act Mode?]
[User clicks button → Switches to Act Mode]
[Discuss Mode auto-disables]
[Cline begins implementation silently]
```

---

*This document will be updated throughout implementation. Last updated: November 8, 2025*
