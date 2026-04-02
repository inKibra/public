/** @jsxImportSource react */
/**
 * Channels Layout Page
 *
 * Layout for channels section with:
 * - Sidebar showing list of channels
 * - Main outlet for channel detail (or empty state)
 * - Modal for creating new channels (state-driven)
 */

import type { RoutePageProps } from '@inkibra/router';
import { Link, Redirect, useCurrentParams } from '@inkibra/router/react';
import type { FormEvent, MouseEvent } from 'react';
import { useState } from 'react';
import { appRoutes } from '../../routes';

// ============================================================================
// Styles
// ============================================================================

const styles = {
  layout: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    height: '100%',
    gap: '1px',
    backgroundColor: '#2a2a2a',
  } as const,
  sidebar: {
    backgroundColor: '#0d0d0d',
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  sidebarHeader: {
    padding: '16px',
    borderBottom: '1px solid #2a2a2a',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sidebarTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  newChannelButton: {
    padding: '6px 12px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  channelList: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },
  channelItem: {
    display: 'block',
    padding: '12px',
    borderRadius: '8px',
    textDecoration: 'none',
    color: '#ccc',
    marginBottom: '4px',
  },
  channelItemActive: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
  },
  channelItemName: {
    fontSize: '14px',
    fontWeight: 500,
    marginBottom: '2px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  channelItemDesc: {
    fontSize: '12px',
    color: '#666',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  mainContent: {
    backgroundColor: '#0d0d0d',
    height: '100%',
    overflow: 'auto',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#666',
    textAlign: 'center' as const,
    padding: '40px',
  },
  emptyIcon: {
    fontSize: '64px',
    marginBottom: '16px',
  },
  emptyText: {
    fontSize: '16px',
    marginBottom: '24px',
  },
  emptyButton: {
    padding: '12px 24px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  emptyListText: {
    color: '#666',
    fontSize: '13px',
    padding: '12px',
    textAlign: 'center' as const,
  },
  // Modal styles
  modalOverlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: '12px',
    padding: '24px',
    width: '100%',
    maxWidth: '400px',
    border: '1px solid #2a2a2a',
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#fff',
    marginBottom: '20px',
  },
  input: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#0d0d0d',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    marginBottom: '12px',
    boxSizing: 'border-box' as const,
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '20px',
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: 'transparent',
    color: '#888',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  submitButton: {
    padding: '10px 20px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  submitButtonDisabled: {
    backgroundColor: '#2a2a2a',
    color: '#666',
    cursor: 'not-allowed',
  },
};

// ============================================================================
// Types
// ============================================================================

type ChannelsLayoutProps = RoutePageProps<
  typeof appRoutes.$pages.main.channels
>;

// ============================================================================
// Empty State Component
// ============================================================================

type EmptyStateProps = {
  onCreateChannel: () => void;
};

const EmptyState = ({ onCreateChannel }: EmptyStateProps) => (
  <div style={styles.emptyState}>
    <div style={styles.emptyIcon}>💬</div>
    <p style={styles.emptyText}>
      No channel selected. Choose a channel from the sidebar or create a new
      one!
    </p>
    <button type="button" style={styles.emptyButton} onClick={onCreateChannel}>
      + Create Channel
    </button>
  </div>
);

// ============================================================================
// New Channel Modal Component
// ============================================================================

type NewChannelModalProps = {
  onClose: () => void;
  onSubmit: (name: string, description: string) => void;
  isSubmitting?: boolean;
};

const NewChannelModal = ({
  onClose,
  onSubmit,
  isSubmitting,
}: NewChannelModalProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), description.trim());
    }
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={handleOverlayClick}>
      <div style={styles.modalContent}>
        <h2 style={styles.modalTitle}>Create New Channel</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Channel name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
            autoFocus
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={styles.input}
          />
          <div style={styles.modalActions}>
            <button type="button" style={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                ...((!name.trim() || isSubmitting) &&
                  styles.submitButtonDisabled),
              }}
              disabled={!name.trim() || isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

const ChannelsLayout = ({
  loaderData,
  ctx,
  getOutlet,
  emptyOutlets,
  apiImplementations,
  navigate,
}: ChannelsLayoutProps) => {
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get channels from loader data
  const channels = loaderData?.type === 'Ok' ? loaderData.value : [];

  // Get the main outlet component
  const MainOutlet = getOutlet('main');

  // Redirect to login if not authenticated
  if (ctx.session === null) {
    return <Redirect to={appRoutes.$paths.login.getPath({})} />;
  }

  const handleCreateChannel = async (name: string, description: string) => {
    setIsSubmitting(true);
    try {
      const result = await apiImplementations.createChannel.execute(
        {
          pathParams: {},
          pathQuery: {},
          body: { name, description },
          files: undefined,
        },
        ctx,
      );
      if (result.type === 'Ok') {
        setShowModal(false);
        // Navigate to the new channel
        navigate(
          appRoutes.$paths.channels[':channelId'].getPath({
            channelId: result.value.id,
          }),
        );
      } else {
        // TODO: Show error toast
        console.error('Failed to create channel:', result.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if we're viewing a specific channel (for highlighting in sidebar)
  const currentChannelId = useCurrentParams(
    appRoutes.$paths.channels[':channelId'],
  )?.channelId;

  return (
    <div style={styles.layout}>
      {/* Sidebar with channel list */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <span style={styles.sidebarTitle}>Channels</span>
          <button
            type="button"
            style={styles.newChannelButton}
            onClick={() => setShowModal(true)}
          >
            + New
          </button>
        </div>
        <div style={styles.channelList}>
          {channels.length === 0 ? (
            <p style={styles.emptyListText}>No channels yet</p>
          ) : (
            channels.map((channel) => (
              <Link
                key={channel.id}
                to={appRoutes.$paths.channels[':channelId'].getPath({
                  channelId: channel.id,
                })}
                style={{
                  ...styles.channelItem,
                  ...(currentChannelId === channel.id &&
                    styles.channelItemActive),
                }}
              >
                <div style={styles.channelItemName}>
                  <span style={{ fontSize: '16px' }}>#</span>
                  {channel.name}
                </div>
                {channel.description && (
                  <div style={styles.channelItemDesc}>
                    {channel.description}
                  </div>
                )}
              </Link>
            ))
          )}
        </div>
      </aside>

      {/* Main content area */}
      <main style={styles.mainContent}>
        {emptyOutlets.includes('main') ? (
          <EmptyState onCreateChannel={() => setShowModal(true)} />
        ) : (
          <MainOutlet />
        )}
      </main>

      {/* New Channel Modal */}
      {showModal && (
        <NewChannelModal
          onClose={() => setShowModal(false)}
          onSubmit={handleCreateChannel}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
};

export default ChannelsLayout;
