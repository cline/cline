import React, { useState, useMemo, useRef, useEffect } from "react"
import styled from "styled-components"
import { CheckpointOverlay, CheckpointControls } from "./CheckpointControls"
import { ClineMessage } from "@shared/ExtensionMessage"
import { formatTimestamp } from "@/utils/format"
import { vscode } from "@/utils/vscode"
import { ClineCheckpointRestore } from "@shared/WebviewMessage"
import TimelineHoverModal from "./TimelineHoverModal"
import { CheckpointsServiceClient } from "@/services/grpc-client"

interface TimelineProps {
  messages: ClineMessage[]
}

const TimelineContainer = styled.div<{ isCollapsed: boolean }>`
  position: relative;
  width: 100%;
  height: ${props => props.isCollapsed ? '28px' : '100px'};
  margin: 10px 0 0 0;
  display: flex;
  align-items: center;
  border: 1px solid var(--vscode-editorGroup-border);
  background-color: var(--vscode-editorWidget-background, rgba(240, 240, 240, 0.1));
  overflow: hidden;
  z-index: 5;
  padding: ${props => props.isCollapsed ? '0' : '6px 0 12px 0'};
  transition: height 0.3s ease-in-out, padding 0.3s ease-in-out;
`

const TimelineScrollContainer = styled.div`
  display: flex;
  overflow-x: auto;
  width: 100%;
  height: 100%;
  align-items: center;
  padding: 0 25px;
  margin-top: 15px; /* Move content down */
  
  /* Hide scrollbar but keep functionality */
  scrollbar-width: thin;
  scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
  
  &::-webkit-scrollbar {
    height: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  
  &::-webkit-scrollbar-thumb {
    background-color: var(--vscode-scrollbarSlider-background);
    border-radius: 2px;
  }
`

const TimelineLine = styled.div`
  position: absolute;
  top: 60%; /* Move line down from center */
  left: 0;
  right: 0;
  height: 1px;
  background-color: var(--vscode-editorGroup-border);
  opacity: 0.6;
  z-index: 1;
  transform: translateY(-50%);
`

const NavigationArrow = styled.div<{ direction: 'left' | 'right' }>`
  position: absolute;
  top: 60%; /* Match line position */
  ${props => props.direction === 'left' ? 'left: 5px;' : 'right: 5px;'}
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  color: var(--vscode-foreground);
  opacity: 0.7;
  
  &:hover {
    opacity: 1;
  }
`

const TimelineItemsContainer = styled.div`
  display: flex;
  position: relative;
  z-index: 2;
  align-items: center;
  min-width: min-content;
  gap: 20px; /* Reduced spacing between items */
`

const TimelineItem = styled.div<{ 
  itemType: "ask" | "say" | "checkpoint" | "complete";
  isActiveCheckpoint?: boolean;
}>`
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: transform 0.1s ease-in-out;

  &:hover {
    transform: scale(1.1);
  }

  &::after {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 1px;
    height: 6px;
    background-color: var(--vscode-editorGroup-border);
    opacity: 0.6;
  }

  ${(props) =>
    props.itemType === "ask" &&
    `
     background-color: #888888;
     color: white;
    `}

  ${(props) =>
    props.itemType === "say" &&
    `
     background-color: #888888;
     color: white;
    `}

  ${(props) =>
    props.itemType === "checkpoint" &&
    `
     background-color: #2D8CFF;
     color: white;
     ${props.isActiveCheckpoint ? `
       box-shadow: 0 0 0 4px rgba(255, 100, 100, 0.4);
       border: 2px solid rgba(255, 100, 100, 0.7);
     ` : ''}
    `}
    
  ${(props) =>
    props.itemType === "complete" &&
    `
     background-color: #22C55E;
     color: white;
    `}
`

const TimelineItemWrapper = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 0;
  min-height: 60px;
  
  /* Make checkpoint controls visible when selected or hovered */
  &:hover ${CheckpointControls}, 
  &:has(${CheckpointControls}) ${CheckpointControls} {
    opacity: 1;
  }
`

const TimelineItemLabel = styled.div`
  font-size: 10px;
  color: var(--vscode-foreground);
  margin-top: 10px;
  white-space: nowrap;
  text-align: center;
  font-weight: 500;
  max-width: 70px;
  overflow: hidden;
  text-overflow: ellipsis;
`

const TimelineItemTimestamp = styled.div`
  font-size: 9px;
  color: var(--vscode-descriptionForeground);
  margin-top: 2px;
  white-space: nowrap;
  opacity: 0.8;
  text-align: center;
  max-width: 70px;
  overflow: hidden;
  text-overflow: ellipsis;
`

const TimelineHeader = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  z-index: 3;
`

const TimelineTitle = styled.div`
  color: var(--vscode-foreground);
  font-size: 11px;
  font-weight: bold;
  display: flex;
  align-items: center;
`

const CollapseToggle = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  cursor: pointer;
  transition: transform 0.2s ease;
  
  &.collapsed {
    transform: rotate(-90deg);
  }
`

// Format timestamp as relative time (e.g., "2m ago", "just now") or time (e.g., "12:13 PM")
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now()
  const diff = now - timestamp
  
  // Less than a minute ago
  if (diff < 60 * 1000) {
    return 'just now'
  }
  
  // Less than an hour ago
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000))
    return `${minutes}m ago`
  }
  
  // Less than a day ago
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000))
    return `${hours}h ago`
  }
  
  // Format as time for today or date for older
  const date = new Date(timestamp)
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
  
  return timeFormatter.format(date)
}

const getItemType = (message: ClineMessage, isFirstMessage: boolean = false): "ask" | "say" | "checkpoint" | "complete" => {
  // First message is always treated as "say" (user feedback)
  if (isFirstMessage) {
    return "say"
  }
  
  // User feedback is treated as "say" (will get up arrow)
  if (message.type === "say" && message.say === "user_feedback") {
    return "say"
  }
  
  if (message.type === "say") {
    switch (message.say) {
      case "checkpoint_created":
        return "checkpoint"
      case "completion_result":
        return "complete"
      default:
        return "ask" // AI responses get "ask" type (will get down arrow)
    }
  } else if (message.type === "ask") {
    switch (message.ask) {
      case "completion_result":
        return "complete"
      default:
        return "ask" // AI questions get "ask" type (will get down arrow)
    }
  }

  return "ask"
}

const getItemIcon = (itemType: "ask" | "say" | "checkpoint" | "complete"): string => {
  switch (itemType) {
    case "ask":
      return "arrow-down" // AI asking questions gets down arrow
    case "say":
      return "arrow-up" // User messages get up arrow
    case "checkpoint":
      return "bookmark"
    case "complete":
      return "check"
    default:
      return "circle-small"
  }
}

const Timeline: React.FC<TimelineProps> = ({ messages }) => {
  const [hoveredItem, setHoveredItem] = useState<number | null>(null)
  const [activeCheckpoint, setActiveCheckpoint] = useState<number | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const timelineItems = useMemo(() => {
    const relevantMessages = messages.filter(m => 
      ((m.type === "say" && (m.say === "user_feedback" || m.say === "text") && m.text && m.text.trim().length > 0) ||
       (m.type === "ask" && (m.ask === "followup" || m.ask === "tool"))) ||
      ((m.type === "say" && m.say === "checkpoint_created") || m.lastCheckpointHash)
    )
    
    // Remove the code that adds completion messages to the timeline
    
    const sortedMessages = [...relevantMessages].sort((a, b) => a.ts - b.ts)
    
    const uniqueMessages = sortedMessages.filter(
      (item, index, self) => index === self.findIndex((t) => t.ts === item.ts)
    )
    
    return uniqueMessages
  }, [messages])

  // Scroll to the end when new items are added
  useEffect(() => {
    if (scrollContainerRef.current && timelineItems.length > 0) {
      scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth
    }
  }, [timelineItems.length])

  // Only render the timeline if there are items to display
  if (timelineItems.length === 0) {
    return null
  }

  // Function to get a descriptive label for each timeline item
  const getItemLabel = (message: ClineMessage): string => {
    // Check for completion messages first
    if ((message.type === "say" && message.say === "completion_result") ||
        (message.type === "ask" && message.ask === "completion_result")) {
      return "Completed"
    }
    
    // Check for checkpoint messages
    if (message.type === "say" && message.say === "checkpoint_created") {
      return "Checkpoint"
    }
    
    // All other messages
    return "Message"
  }

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = direction === 'left' ? -200 : 200
      scrollContainerRef.current.scrollLeft += scrollAmount
    }
  }

  const handleMouseEnter = (event: React.MouseEvent, item: ClineMessage) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoverPosition({
      x: rect.left + rect.width / 2,
      y: rect.top
    })
    setHoveredItem(item.ts)
  }

  const handleMouseLeave = () => {
    setHoveredItem(null)
    setHoverPosition(null)
  }

  // Find the hovered message
  const hoveredMessage = hoveredItem ? timelineItems.find(item => item.ts === hoveredItem) : null

  return (
    <TimelineContainer isCollapsed={isCollapsed}>
      <TimelineHeader>
        <TimelineTitle>
          <CollapseToggle 
            className={isCollapsed ? 'collapsed' : ''}
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            <i className="codicon codicon-chevron-down" />
          </CollapseToggle>
          Timeline
        </TimelineTitle>
      </TimelineHeader>
      
      {!isCollapsed && (
        <>
          <TimelineLine />
          <NavigationArrow direction="left" onClick={() => handleScroll('left')}>
            <i className="codicon codicon-chevron-left" />
          </NavigationArrow>
          <NavigationArrow direction="right" onClick={() => handleScroll('right')}>
            <i className="codicon codicon-chevron-right" />
          </NavigationArrow>
          <TimelineScrollContainer ref={scrollContainerRef}>
            <TimelineItemsContainer>
              {timelineItems.map((item, index) => {
                const itemType = getItemType(item, index === 0)
                const timestamp = formatRelativeTime(item.ts)
                const label = getItemLabel(item)

                return (
                  <TimelineItemWrapper key={item.ts}>
                    <TimelineItem
                      itemType={itemType}
                      isActiveCheckpoint={itemType === "checkpoint" && activeCheckpoint === item.ts}
                      onMouseEnter={(e) => handleMouseEnter(e, item)}
                      onMouseLeave={handleMouseLeave}
                      onClick={() => {
                        // Single click no longer does anything for checkpoints
                      }}
                      onDoubleClick={() => {
                        if (itemType === "checkpoint") {
                          // Set this checkpoint as active
                          setActiveCheckpoint(item.ts);
                          
                          // On double-click, directly restore workspace files
                          CheckpointsServiceClient.checkpointRestore({
                            number: item.ts,
                            restoreType: "workspace" as ClineCheckpointRestore
                          }).catch(err => {
                            console.error("Checkpoint restore error:", err);
                          });
                        }
                      }}>
                      <i className={`codicon codicon-${getItemIcon(itemType)}`} style={{ fontSize: "14px" }} />
                    </TimelineItem>
                    <TimelineItemLabel>{label}</TimelineItemLabel>
                    <TimelineItemTimestamp>{timestamp}</TimelineItemTimestamp>
                    {/* Removed checkpoint overlay - no UI is shown on click */}
                  </TimelineItemWrapper>
                )
              })}
            </TimelineItemsContainer>
          </TimelineScrollContainer>
        </>
      )}
      
      {/* Render the hover modal if an item is hovered */}
      {hoveredMessage && hoverPosition && (
        <TimelineHoverModal
          message={hoveredMessage}
          position={hoverPosition}
          onClose={handleMouseLeave}
          isFirstMessage={hoveredItem === timelineItems[0]?.ts}
        />
      )}
    </TimelineContainer>
  )
}

export default Timeline
