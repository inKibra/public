/** @jsxImportSource react */
/**
 * Boards Layout Page
 *
 * Layout for boards section with:
 * - Sidebar showing list of boards
 * - Main outlet for board detail (or empty state)
 * - Modal for creating new boards (state-driven)
 */

import type { RoutePageProps } from '@inkibra/router';
import { Link, Redirect, useCurrentParams } from '@inkibra/router/react';
import type { FormEvent, MouseEvent } from 'react';
import { useState } from 'react';
import { appRoutes } from '../../routes';

// V2 Page Props - derived from route tree via $pages accessor
// Structure: $pages.main.boards - the boards list segment
type BoardsListPageProps = RoutePageProps<typeof appRoutes.$pages.main.boards>;

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
  newBoardButton: {
    padding: '6px 12px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  boardList: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },
  boardItem: {
    display: 'block',
    padding: '12px',
    borderRadius: '8px',
    textDecoration: 'none',
    color: '#ccc',
    marginBottom: '4px',
  },
  boardItemActive: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
  },
  boardItemName: {
    fontSize: '14px',
    fontWeight: 500,
    marginBottom: '2px',
  },
  boardItemDesc: {
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
    backgroundColor: '#3b82f6',
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
    backgroundColor: '#3b82f6',
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

// ============================================================================
// Empty State Component
// ============================================================================

type EmptyStateProps = {
  onCreateBoard: () => void;
};

const EmptyState = ({ onCreateBoard }: EmptyStateProps) => (
  <div style={styles.emptyState}>
    <div style={styles.emptyIcon}>📋</div>
    <p style={styles.emptyText}>
      No board selected. Choose a board from the sidebar or create a new one!
    </p>
    <button type="button" style={styles.emptyButton} onClick={onCreateBoard}>
      + Create Board
    </button>
  </div>
);

// ============================================================================
// New Board Modal Component
// ============================================================================

type NewBoardModalProps = {
  onClose: () => void;
  onSubmit: (name: string, description: string) => void;
  isSubmitting?: boolean;
};

const NewBoardModal = ({
  onClose,
  onSubmit,
  isSubmitting,
}: NewBoardModalProps) => {
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
        <h2 style={styles.modalTitle}>Create New Board</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Board name"
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
              {isSubmitting ? 'Creating...' : 'Create Board'}
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

const BoardsLayout = ({
  loaderData,
  ctx,
  getOutlet,
  emptyOutlets,
  apiImplementations,
  navigate,
}: BoardsListPageProps) => {
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get boards from loader data - type is inferred from loader schema via $pages
  const boards = loaderData?.type === 'Ok' ? loaderData.value : [];

  // Get outlet components
  const MainOutlet = getOutlet('main');

  // Redirect to login if not authenticated
  if (ctx.session === null) {
    return <Redirect to={appRoutes.$paths.login.getPath({})} />;
  }

  const handleCreateBoard = async (name: string, description: string) => {
    setIsSubmitting(true);
    try {
      const result = await apiImplementations.createBoard.execute(
        {
          pathParams: {},
          pathQuery: {},
          body: { name, description },
          files: undefined,
        },
        { session: ctx.session },
      );
      if (result.type === 'Ok') {
        setShowModal(false);
        // Navigate to the new board
        navigate(
          appRoutes.$paths.boards[':boardId'].getPath({
            boardId: result.value.id,
          }),
        );
      } else {
        console.error('Failed to create board:', result.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if we're viewing a specific board (for highlighting in sidebar)
  const currentBoardId = useCurrentParams(
    appRoutes.$paths.boards[':boardId'],
  )?.boardId;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        height: '100%',
        gap: '1px',
        backgroundColor: '#2a2a2a',
      }}
    >
      {/* Sidebar with board list */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <span style={styles.sidebarTitle}>Boards</span>
          <button
            type="button"
            style={styles.newBoardButton}
            onClick={() => setShowModal(true)}
          >
            + New
          </button>
        </div>
        <div style={styles.boardList}>
          {boards.length === 0 ? (
            <p style={styles.emptyListText}>No boards yet</p>
          ) : (
            boards.map((board) => (
              <Link
                key={board.id}
                to={appRoutes.$paths.boards[':boardId'].getPath({
                  boardId: board.id,
                })}
                style={{
                  ...styles.boardItem,
                  ...(currentBoardId === board.id && styles.boardItemActive),
                }}
              >
                <div style={styles.boardItemName}>{board.name}</div>
                {board.description && (
                  <div style={styles.boardItemDesc}>{board.description}</div>
                )}
              </Link>
            ))
          )}
        </div>
      </aside>

      {/* Main content area */}
      <main style={styles.mainContent}>
        {emptyOutlets.includes('main') ? (
          <EmptyState onCreateBoard={() => setShowModal(true)} />
        ) : (
          <MainOutlet />
        )}
      </main>

      {/* New Board Modal */}
      {showModal && (
        <NewBoardModal
          onClose={() => setShowModal(false)}
          onSubmit={handleCreateBoard}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
};

export default BoardsLayout;
