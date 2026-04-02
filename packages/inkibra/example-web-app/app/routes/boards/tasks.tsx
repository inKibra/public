/**
 * Board Tasks Component
 *
 * Demonstrates the query system with:
 * - Loading/error states
 * - CRUD mutations
 * - Status filtering
 */

import type { RoutePageProps } from '@inkibra/router';
import { AwaitResult } from '@inkibra/router';
import * as React from 'react';
import type { Task, TaskStatus } from '../../../shared/types';
import {
  type CreateTaskArgs,
  createTaskMutation,
  type DeleteTaskArgs,
  deleteTaskMutation,
  tasksQuery,
  type UpdateTaskArgs,
  updateTaskMutation,
} from '../../queries/task-queries';
import type { appRoutes } from '../../routes';

// ============================================================================
// Types
// ============================================================================

// Tasks are now accessed via the board detail route's $pages path
type TasksPageProps = RoutePageProps<
  (typeof appRoutes.$pages.main.boards.main)[':boardId']
>;

// V2 props may not exist in V1 routes
// biome-ignore lint/suspicious/noExplicitAny: V1/V2 compatibility
type RunQueryFn = (query: any, args: any, opts?: any) => [Promise<any>, any];
// biome-ignore lint/suspicious/noExplicitAny: V1/V2 compatibility
type MutationFn = (
  mutation: any,
  opts?: any,
) => { run: (args: any) => Promise<any>; isPending: boolean; result?: any };

type V2Props = {
  runQuery?: RunQueryFn;
  mutation?: MutationFn;
};

// ============================================================================
// Task Card Component
// ============================================================================

type TaskCardProps = {
  task: Task;
  onUpdate: (taskId: string, data: Partial<Task>) => void;
  onDelete: (taskId: string) => void;
};

function TaskCard({ task, onUpdate, onDelete }: TaskCardProps) {
  const statusColors: Record<TaskStatus, string> = {
    todo: '#6b7280',
    'in-progress': '#3b82f6',
    done: '#22c55e',
  };

  const priorityColors: Record<string, string> = {
    low: '#9ca3af',
    medium: '#f59e0b',
    high: '#ef4444',
  };

  return (
    <div
      style={{
        backgroundColor: '#1f2937',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '12px',
        border: '1px solid #374151',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: '#f9fafb', fontSize: '16px' }}>
            {task.title}
          </h3>
          <p style={{ margin: '8px 0', color: '#9ca3af', fontSize: '14px' }}>
            {task.description}
          </p>
        </div>
        <button
          onClick={() => onDelete(task.id)}
          type="button"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: '18px',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <span
          style={{
            backgroundColor: statusColors[task.status],
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          {task.status}
        </span>
        <span
          style={{
            backgroundColor: priorityColors[task.priority],
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          {task.priority}
        </span>
        <select
          value={task.status}
          onChange={(e) =>
            onUpdate(task.id, { status: e.target.value as TaskStatus })
          }
          style={{
            marginLeft: 'auto',
            backgroundColor: '#374151',
            color: '#f9fafb',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
          }}
        >
          <option value="todo">To Do</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
        </select>
      </div>
    </div>
  );
}

// ============================================================================
// Task List Skeleton
// ============================================================================

function TaskListSkeleton() {
  return (
    <div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            backgroundColor: '#1f2937',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '12px',
            border: '1px solid #374151',
          }}
        >
          <div
            style={{
              height: '20px',
              width: '60%',
              backgroundColor: '#374151',
              borderRadius: '4px',
              marginBottom: '8px',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
          <div
            style={{
              height: '14px',
              width: '80%',
              backgroundColor: '#374151',
              borderRadius: '4px',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        </div>
      ))}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function BoardTasksPage({
  loaderData: _loaderData,
  params,
  runQuery,
  mutation,
}: TasksPageProps & V2Props) {
  const [statusFilter, setStatusFilter] = React.useState<TaskStatus | 'all'>(
    'all',
  );

  // V2: Use runQuery with static query plans
  // V1 fallback: show placeholder
  if (!runQuery || !mutation) {
    return (
      <div style={{ padding: '16px', color: '#9ca3af' }}>
        Tasks requires V2 routing
      </div>
    );
  }

  const [tasksPromise, optimisticTasks] = runQuery(tasksQuery, {
    boardId: params.boardId,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });

  // Bind mutations
  const createTask = mutation(createTaskMutation, { defaultScope: 'global' });
  const updateTask = mutation(updateTaskMutation, { defaultScope: 'global' });
  const deleteTask = mutation(deleteTaskMutation, { defaultScope: 'global' });

  const isMutating =
    createTask.isPending || updateTask.isPending || deleteTask.isPending;

  return (
    <div style={{ padding: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h2 style={{ margin: 0, color: '#f9fafb', fontSize: '20px' }}>
          Tasks{' '}
          {isMutating && (
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>
              (updating...)
            </span>
          )}
        </h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as TaskStatus | 'all')
            }
            style={{
              backgroundColor: '#374151',
              color: '#f9fafb',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 12px',
            }}
          >
            <option value="all">All Status</option>
            <option value="todo">To Do</option>
            <option value="in-progress">In Progress</option>
            <option value="done">Done</option>
          </select>
          <button
            onClick={async () => {
              const title = prompt('Task title:');
              if (!title) return;
              await createTask.run({
                boardId: params.boardId,
                data: {
                  title,
                  description: '',
                  status: 'todo',
                  priority: 'medium',
                },
              } as CreateTaskArgs);
            }}
            disabled={isMutating}
            type="button"
            style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 16px',
              cursor: isMutating ? 'not-allowed' : 'pointer',
              opacity: isMutating ? 0.5 : 1,
            }}
          >
            + Add Task
          </button>
        </div>
      </div>

      <AwaitResult
        resolve={tasksPromise}
        optimisticValue={optimisticTasks}
        initialLoading={<TaskListSkeleton />}
        error={(err) => (
          <div style={{ padding: '16px', color: '#ef4444' }}>
            Failed to load tasks: {err.message}
          </div>
        )}
      >
        {(tasks) => {
          const list = (tasks as Task[]).filter(
            (t) => statusFilter === 'all' || t.status === statusFilter,
          );
          if (list.length === 0) {
            return (
              <div
                style={{
                  color: '#9ca3af',
                  textAlign: 'center',
                  padding: '32px',
                }}
              >
                No tasks yet. Click "+ Add Task" to create one.
              </div>
            );
          }
          return (
            <div>
              {list.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onUpdate={(taskId, data) =>
                    updateTask.run({ taskId, data } as UpdateTaskArgs)
                  }
                  onDelete={(taskId) =>
                    deleteTask.run({
                      taskId,
                      boardId: params.boardId,
                    } as DeleteTaskArgs)
                  }
                />
              ))}
            </div>
          );
        }}
      </AwaitResult>
    </div>
  );
}
