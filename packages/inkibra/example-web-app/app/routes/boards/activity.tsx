import { AwaitResult } from '@inkibra/router';
import type { Task } from '../../../shared/types';
import { activityQuery } from '../../queries/task-queries';

// Props for activity panel - requires runQuery from V2 router
// Note: This component should be added to V2 routes for proper typing
type ActivityPageProps = {
  // biome-ignore lint/suspicious/noExplicitAny: Activity not yet in V2 route tree
  runQuery: (query: any, args: any, opts?: any) => [Promise<any>, any];
};

const panelStyle: React.CSSProperties = {
  width: '320px',
  minWidth: '280px',
  borderLeft: '1px solid #1f1f1f',
  backgroundColor: '#0c0c0c',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const headerStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#fff',
  marginBottom: '4px',
};

const itemStyle: React.CSSProperties = {
  border: '1px solid #1f1f1f',
  borderRadius: '8px',
  padding: '10px',
  backgroundColor: '#111',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const optimisticStyle: React.CSSProperties = {
  borderColor: '#4f46e5',
  boxShadow: '0 0 0 1px rgba(79, 70, 229, 0.35)',
};

const metaStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#888',
};

const titleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#fff',
  fontWeight: 600,
};

function renderItem(task: Task, optimistic: boolean) {
  return (
    <div
      key={task.id}
      style={{ ...itemStyle, ...(optimistic ? optimisticStyle : {}) }}
    >
      <div style={titleStyle}>{task.title || 'Untitled task'}</div>
      {task.description ? (
        <div style={{ fontSize: '12px', color: '#ccc' }}>
          {task.description}
        </div>
      ) : null}
      <div style={metaStyle}>
        {task.status} · {task.priority} ·{' '}
        {new Date(task.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}

const ActivityPage = ({ runQuery }: ActivityPageProps) => {
  const [promise, optimisticTasks] = runQuery(activityQuery, { limit: 10 });

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Live Activity</div>
      <AwaitResult
        resolve={promise}
        optimisticValue={optimisticTasks}
        initialLoading={<div style={metaStyle}>Loading…</div>}
        initialError={(error) => (
          <div style={{ color: '#ef4444', fontSize: '12px' }}>
            Failed to load activity: {error.message}
          </div>
        )}
      >
        {(data, state) => {
          const tasks = (data as Task[]) ?? [];
          return (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {tasks.length === 0 ? (
                <div style={metaStyle}>No activity yet.</div>
              ) : (
                tasks.map((task) =>
                  renderItem(task, state.phase === 'optimistic'),
                )
              )}
            </div>
          );
        }}
      </AwaitResult>
    </div>
  );
};

export default ActivityPage;
