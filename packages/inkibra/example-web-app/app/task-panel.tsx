import type { RunQueryFn } from '@inkibra/router';
import { AwaitResult } from '@inkibra/router';
import type React from 'react';
import { useMemo, useState } from 'react';
import type { Task } from '../shared/types';
import { activityQuery, getTaskQuery } from './queries/task-queries';

type TaskPanelProps = {
  query: { taskPanel?: { taskId?: string } };
  runQuery: RunQueryFn<any, any>;
  navigate: (path: string) => void;
};

export function TaskPanel({ query, runQuery, navigate }: TaskPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const selectedTaskId = query.taskPanel?.taskId;

  const [taskPromise] = useMemo(() => {
    if (!selectedTaskId) return [null] as const;
    // biome-ignore lint/suspicious/noExplicitAny: Query args type inference is complex
    return [runQuery(getTaskQuery, { taskId: selectedTaskId })[0]] as const;
  }, [runQuery, selectedTaskId]);

  const [recentPromise] = useMemo(() => {
    if (selectedTaskId) return [null] as const;
    // biome-ignore lint/suspicious/noExplicitAny: Query args type inference is complex
    return [runQuery(activityQuery, { limit: 10 })[0]] as const;
  }, [runQuery, selectedTaskId]);

  const handleClose = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('taskPanel.taskId');
    navigate(url.pathname + url.search);
  };

  const handleSelect = (taskId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('taskPanel.taskId', taskId);
    navigate(url.pathname + url.search);
    setCollapsed(false);
  };

  if (collapsed) {
    return (
      <div style={styles.collapsed}>
        <button style={styles.iconButton} onClick={() => setCollapsed(false)}>
          ▶
        </button>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <strong>Task Panel</strong>
          {selectedTaskId ? (
            <span style={styles.subtle}>Task {selectedTaskId}</span>
          ) : (
            <span style={styles.subtle}>Recent tasks</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.iconButton} onClick={() => setCollapsed(true)}>
            ❐
          </button>
          <button style={styles.iconButton} onClick={handleClose}>
            ✕
          </button>
        </div>
      </div>

      <div style={styles.body}>
        {selectedTaskId && taskPromise ? (
          <AwaitResult
            resolve={taskPromise}
            initialLoading={<div style={styles.loading}>Loading task...</div>}
            initialError={(err) => (
              <div style={styles.error}>Failed to load task: {err.message}</div>
            )}
          >
            {(task) => {
              const t = task as Task | null;
              if (!t) return <div style={styles.empty}>Task not found</div>;
              return (
                <div>
                  <div style={styles.title}>{t.title}</div>
                  <div style={styles.meta}>
                    {t.status} · {t.priority}
                  </div>
                  <p style={styles.description}>
                    {t.description || 'No description'}
                  </p>
                </div>
              );
            }}
          </AwaitResult>
        ) : recentPromise ? (
          <AwaitResult
            resolve={recentPromise}
            initialLoading={<div style={styles.loading}>Loading tasks...</div>}
            initialError={(err) => (
              <div style={styles.error}>
                Failed to load tasks: {err.message}
              </div>
            )}
          >
            {(tasks) => {
              const list = (tasks as Task[]) ?? [];
              if (list.length === 0) {
                return <div style={styles.empty}>No recent tasks</div>;
              }
              return (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {list.map((t) => (
                    <button
                      key={t.id}
                      style={styles.listItem}
                      onClick={() => handleSelect(t.id)}
                    >
                      <div style={styles.title}>{t.title}</div>
                      <div style={styles.meta}>
                        {t.status} · {t.priority}
                      </div>
                    </button>
                  ))}
                </div>
              );
            }}
          </AwaitResult>
        ) : (
          <div style={styles.empty}>Select a task to view details</div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 320,
    borderLeft: '1px solid #2a2a2a',
    background: '#111',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  collapsed: {
    width: 32,
    borderLeft: '1px solid #2a2a2a',
    background: '#111',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    padding: '10px 12px',
    borderBottom: '1px solid #2a2a2a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  body: {
    padding: '12px',
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
  },
  title: {
    fontWeight: 600,
    color: '#fff',
  },
  meta: {
    color: '#888',
    fontSize: 12,
  },
  description: {
    marginTop: 8,
    color: '#ddd',
    fontSize: 14,
    lineHeight: 1.4,
  },
  listItem: {
    textAlign: 'left',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #2a2a2a',
    background: '#181818',
    cursor: 'pointer',
  },
  loading: {
    color: '#aaa',
    fontSize: 13,
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
  },
  empty: {
    color: '#777',
    fontSize: 13,
  },
  subtle: {
    color: '#999',
    fontSize: 12,
  },
  iconButton: {
    border: '1px solid #2a2a2a',
    background: '#1a1a1a',
    color: '#ddd',
    borderRadius: 6,
    padding: '6px 8px',
    cursor: 'pointer',
  },
};

export default TaskPanel;
