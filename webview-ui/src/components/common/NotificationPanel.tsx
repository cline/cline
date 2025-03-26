import React, { useState, useRef, useEffect } from 'react';
import { ExternalAdvice } from '../../../../src/shared/WebviewMessage';
import { formatDistanceToNow } from 'date-fns';
import { vscode } from '../../utils/vscode';
import './NotificationPanel.css';

/**
 * NotificationPanel Component
 * 
 * Displays a panel of notifications with support for:
 * - Sorting by timestamp (newest first)
 * - Separating active and dismissed notifications
 * - Expanding/collapsing notification content and suggestions
 * - Sending notifications to chat
 * - Dismissing and restoring notifications
 * - Displaying machine-actionable suggestions with code examples
 */
interface NotificationPanelProps {
  notifications: ExternalAdvice[];
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onOpenRelatedFile?: (filePath: string) => void;
  onClose: () => void;
  taskId?: string;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  notifications,
  onMarkAsRead,
  onDismiss,
  onOpenRelatedFile,
  onClose,
  taskId
}) => {
  // Track which notifications have expanded suggestions
  const [expandedNotifications, setExpandedNotifications] = useState<Record<string, boolean>>({});
  // Track which notifications have expanded content
  const [expandedContents, setExpandedContents] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Add click-outside handler to close the panel
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        // Click was outside the panel, close it
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const toggleExpand = (id: string) => {
    setExpandedNotifications(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const toggleExpandContent = (id: string) => {
    setExpandedContents(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  if (notifications.length === 0) {
    return (
      <div className="notification-panel" ref={panelRef}>
        <div className="notification-header">
          <div>
            <h3>Notifications</h3>
            {taskId && (
              <div className="task-id-display">
                Task ID: {taskId}
              </div>
            )}
          </div>
          <button 
            className="close-button"
            onClick={onClose}
            title="Close notifications"
          >
            <i className="codicon codicon-close"></i>
          </button>
        </div>
        <div className="notification-empty">
          <p>No notifications at this time</p>
        </div>
      </div>
    );
  }

  // Sort notifications with newest first
  const sortedNotifications = [...notifications].sort((a, b) => b.timestamp - a.timestamp);

  // Separate active and dismissed notifications
  const activeNotifications = sortedNotifications.filter(notification => !notification.dismissed);
  const dismissedNotifications = sortedNotifications.filter(notification => notification.dismissed);

  // Add a handler for restoring dismissed notifications
  const handleRestore = (id: string) => {
    // Send a message to restore the notification
    vscode.postMessage({ type: 'restoreAdvice', adviceId: id });
  };
  
  // Add a handler for sending notifications to chat
  const handleSendToChat = (notification: ExternalAdvice) => {
    // Send the notification to chat
    vscode.postMessage({ 
      type: 'sendExternalAdviceToChat',
      advice: notification
    });
    
    // Don't mark as read here - the backend will handle that
    // This allows the button to remain visible
  };

  const renderNotification = (notification: ExternalAdvice, isDismissed: boolean = false) => {
    const isExpanded = expandedNotifications[notification.id] || false;
    const hasMachineData = !!notification.machineData;
    const hasSuggestions = hasMachineData && notification.machineData?.suggestions && notification.machineData.suggestions.length > 0;
    
    return (
      <div 
        key={notification.id} 
        className={`notification-item ${notification.priority} ${notification.read ? 'read' : 'unread'} ${hasMachineData ? 'machine-actionable' : ''} ${isDismissed ? 'dismissed' : ''}`}
      >
        <div className="notification-content">
          <div className="notification-header-row">
            <h4>
              {notification.title}
              {hasMachineData && (
                <span className="machine-actionable-indicator" title="Machine-actionable notification">
                  <i className="codicon codicon-gear"></i>
                </span>
              )}
            </h4>
            {hasSuggestions && (
              <button 
                className="expand-button"
                onClick={() => toggleExpand(notification.id)}
                title={isExpanded ? "Collapse suggestions" : "Expand suggestions"}
              >
                <i className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`}></i>
              </button>
            )}
          </div>
          
          <div className="notification-content-text">
            {notification.content.length > 200 ? (
              <>
                <p>
                  {expandedContents[notification.id] 
                    ? notification.content 
                    : `${notification.content.substring(0, 200)}...`}
                </p>
                <div 
                  className="content-toggle-button"
                  onClick={() => toggleExpandContent(notification.id)}
                >
                  {expandedContents[notification.id] ? 'See less' : 'See more'}
                </div>
              </>
            ) : (
              <p>{notification.content}</p>
            )}
          </div>
          
          {hasMachineData && notification.machineData?.context && (
            <div className="notification-context">
              <strong>Context:</strong> {notification.machineData.context}
            </div>
          )}
          
          {hasSuggestions && isExpanded && (
            <div className="notification-suggestions">
              <strong>Suggestions:</strong>
              {notification.machineData?.suggestions?.map((suggestion, index) => (
                <div key={index} className="suggestion-item">
                  <div className="suggestion-header">
                    <span className="suggestion-number">{index + 1}.</span>
                    <span className="suggestion-file" onClick={() => onOpenRelatedFile && onOpenRelatedFile(suggestion.file)}>
                      {suggestion.file.split('/').pop()}
                    </span>
                    {suggestion.location && (
                      <span className="suggestion-location">
                        Line {suggestion.location.line}, Col {suggestion.location.column}
                      </span>
                    )}
                  </div>
                  <p className="suggestion-explanation">{suggestion.explanation}</p>
                  {suggestion.currentCode && suggestion.suggestedCode && (
                    <div className="suggestion-code">
                      <div className="code-block">
                        <div className="code-label">Current:</div>
                        <pre>{suggestion.currentCode}</pre>
                      </div>
                      <div className="code-block">
                        <div className="code-label">Suggested:</div>
                        <pre>{suggestion.suggestedCode}</pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          
          {notification.relatedFiles && notification.relatedFiles.length > 0 && (
            <div className="related-files">
              <p>Related files:</p>
              <ul>
                {notification.relatedFiles.map(file => (
                  <li key={file}>
                    <a onClick={() => onOpenRelatedFile && onOpenRelatedFile(file)}>
                      {file.split('/').pop()}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <div className="notification-meta">
            <span className="notification-time">
              {formatDistanceToNow(notification.timestamp)} ago
            </span>
            <span className={`notification-type ${notification.type}`}>
              {notification.type}
            </span>
            <span className="notification-action-type">
              {hasMachineData && notification.machineData?.actionType}
            </span>
          </div>
        </div>
        
        <div className="notification-actions">
          {!isDismissed && (
            <button 
              className="mark-read-button"
              onClick={() => handleSendToChat(notification)}
              title="Send this notification directly to the chat"
            >
              Send to Chat
            </button>
          )}
          <button 
            className="dismiss-button"
            onClick={() => isDismissed ? handleRestore(notification.id) : onDismiss(notification.id)}
          >
            {isDismissed ? 'Restore' : 'Dismiss'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="notification-panel" ref={panelRef}>
      <div className="notification-header">
        <div>
          <h3>Notifications</h3>
          {taskId && (
            <div className="task-id-display">
              Task ID: {taskId}
            </div>
          )}
        </div>
        <button 
          className="close-button"
          onClick={onClose}
          title="Close notifications"
        >
          <i className="codicon codicon-close"></i>
        </button>
      </div>
      <div className="notification-list">
        {activeNotifications.length > 0 && (
          <>
            <h4 className="notification-section-title">Active</h4>
            {activeNotifications.map(notification => renderNotification(notification))}
          </>
        )}
        
        {dismissedNotifications.length > 0 && (
          <>
            <h4 className="notification-section-title">Dismissed</h4>
            {dismissedNotifications.map(notification => renderNotification(notification, true))}
          </>
        )}
      </div>
    </div>
  );
};
