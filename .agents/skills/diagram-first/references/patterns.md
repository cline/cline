# Patterns (compact)

Emit flowchart / sequenceDiagram / erDiagram from memory. Open this file for reminders.

## Process — `flowchart TD`

```mermaid
flowchart TD
  Start([Trigger]) --> Validate{Valid?}
  Validate -->|yes| Process[Run]
  Validate -->|no| Reject[Fail closed]
```

## Data flow — `flowchart LR` (typed edges)

```mermaid
flowchart LR
  Planner -->|"ShowBacklogItem"| ShowBacklog
  ShowBacklog -->|"rank"| MermaidProduce
```

## Architecture — subgraphs

```mermaid
flowchart TB
  subgraph HubDaemon["Hub daemon"]
    StatusPlane
    RoomPlane
    DriveLive
  end
  DriveLive --> ShowBacklog
  ShowBacklog --> StickyStagePane
```

## Sequence

```mermaid
sequenceDiagram
  participant UI
  participant Hub as HubDaemon
  participant Stage as StickyStagePane
  UI->>Hub: drive.show.present
  Hub->>Hub: validateMermaidSource
  alt parse-valid
    Hub-->>Stage: drive.show.presented
  else fail closed
    Hub-->>UI: mermaid_parse_failed
  end
```

## Prioritization — `quadrantChart` (no fake dates)

Use for leadership prioritization; never invent day-level gantt schedules.
