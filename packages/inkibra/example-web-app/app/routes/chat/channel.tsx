/**
 * Channel Detail Page
 *
 * Receives loaderData from the Router.
 * Uses useLive for real-time message updates.
 */

import type { RoutePageProps } from '@inkibra/router';
import type { LiveReducer } from '@inkibra/router/lib/use-event-stream-hooks';
import { useLive } from '@inkibra/router/lib/use-event-stream-hooks';
import { useState } from 'react';
import type { ChatMessages } from '../../../schemas';
import type { Message } from '../../../shared/types';
import type { appRoutes } from '../../routes';

const styles = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    maxWidth: '900px',
  },
  header: {
    marginBottom: '16px',
    paddingBottom: '16px',
    borderBottom: '1px solid #2a2a2a',
  },
  channelName: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  messages: {
    flex: 1,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
    paddingBottom: '16px',
  },
  message: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    maxWidth: '70%',
  },
  messageBubble: {
    backgroundColor: '#1a1a1a',
    borderRadius: '12px',
    padding: '10px 14px',
    border: '1px solid #2a2a2a',
  },
  messageHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginBottom: '4px',
  },
  messageAuthor: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#ffffff',
  },
  messageTime: {
    fontSize: '11px',
    color: '#666666',
  },
  messageContent: {
    fontSize: '14px',
    color: '#d0d0d0',
    lineHeight: 1.5,
    wordWrap: 'break-word' as const,
  },
  inputArea: {
    display: 'flex',
    gap: '12px',
    padding: '16px 0',
    borderTop: '1px solid #2a2a2a',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '14px',
    outline: 'none',
  },
  sendButton: {
    padding: '12px 24px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  sendButtonDisabled: {
    backgroundColor: '#2a2a2a',
    color: '#666',
    cursor: 'not-allowed',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666666',
  },
};

type ChannelPageProps = RoutePageProps<
  (typeof appRoutes.$pages.main.channels.main)[':channelId']
>;

const ChannelPage = ({
  loaderData,
  ctx,
  apiImplementations,
  eventStreams,
  params,
}: ChannelPageProps) => {
  const chatStream = eventStreams.chatMessages;
  // loaderData is { channel: Channel, messages: Message[] } on success
  const channel = loaderData?.type === 'Ok' ? loaderData.value.channel : null;
  const initialMessages =
    loaderData?.type === 'Ok' ? loaderData.value.messages : [];
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const messageReducer: LiveReducer<Message[], ChatMessages.Events> = {
    message_created: (msgs, event) => [...msgs, event.message],
    message_deleted: (msgs, event) =>
      msgs.filter((m) => m.id !== event.messageId),
  };

  // Use useLive for real-time message updates
  const { data: messages, status: streamStatus } = useLive(
    initialMessages,
    chatStream,
    channel
      ? { pathParams: { channelId: params.channelId }, pathQuery: {} }
      : undefined,
    ctx,
    messageReducer,
  );

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !channel || isSending) return;

    setIsSending(true);
    try {
      const result = await apiImplementations.sendMessage.execute(
        {
          pathParams: { channelId: channel.id },
          pathQuery: {},
          body: { content: newMessage.trim() },
          files: undefined,
        },
        ctx,
      );
      if (result.type === 'Ok') {
        setNewMessage('');
        // Message will appear via useLive stream
      } else {
        // TODO: Show error toast
        console.error('Failed to send message:', result.error);
      }
    } finally {
      setIsSending(false);
    }
  };

  if (!channel) {
    return (
      <div
        style={{ textAlign: 'center', padding: '60px 20px', color: '#666666' }}
      >
        <p>Channel not found</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.channelName}>
          <span style={{ color: '#666666' }}>#</span>
          {channel.name}
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor:
                streamStatus === 'connected'
                  ? '#10b981'
                  : streamStatus === 'connecting'
                    ? '#f59e0b'
                    : '#ef4444',
              marginLeft: '8px',
            }}
            title={`Stream: ${streamStatus}`}
          />
        </h1>
      </header>

      <div style={styles.messages}>
        {messages.length === 0 ? (
          <div style={styles.emptyState}>
            No messages yet. Start the conversation!
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={styles.message}>
              <div style={styles.messageBubble}>
                <div style={styles.messageHeader}>
                  <span style={styles.messageAuthor}>{msg.authorUsername}</span>
                  <span style={styles.messageTime}>
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div style={styles.messageContent}>{msg.content}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <form style={styles.inputArea} onSubmit={handleSendMessage}>
        <input
          style={styles.input}
          placeholder={`Message #${channel.name}`}
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          disabled={isSending}
        />
        <button
          type="submit"
          style={{
            ...styles.sendButton,
            ...((!newMessage.trim() || isSending) && styles.sendButtonDisabled),
          }}
          disabled={!newMessage.trim() || isSending}
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
};

export default ChannelPage;
