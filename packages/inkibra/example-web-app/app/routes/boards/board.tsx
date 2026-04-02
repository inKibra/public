/** @jsxImportSource react */
/**
 * Board Detail Page
 *
 * Kanban-style board with lists and cards.
 * Uses the query system for tasks with AwaitResult.
 */

import type { RoutePageProps } from '@inkibra/router';
import { AwaitResult, useQuery } from '@inkibra/router';
import { useState } from 'react';
import type {
  BoardListWithCards,
  CreateTaskRequest,
  Task,
  TaskPriority,
  TaskStatus,
} from '../../../shared/types';
import { createTaskMutation, tasksQuery } from '../../queries/task-queries';
import type { appRoutes } from '../../routes';

// V2 Page Props - derived from route tree via $pages accessor
// Structure: $pages.main.boards.main[':boardId']
//   - main: root outlet
//   - boards: segment (BoardsList)
//   - main: nested outlet within boards (detail view)
//   - ':boardId': the board detail leaf
type BoardDetailPageProps = RoutePageProps<
  (typeof appRoutes.$pages.main.boards.main)[':boardId']
>;

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    label: 'board-container',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '16px',
  },
  header: {
    label: 'board-header',
    marginBottom: '16px',
    flexShrink: 0,
  },
  title: {
    label: 'board-title',
    fontSize: '24px',
    fontWeight: 700,
    color: '#ffffff',
    margin: 0,
  },
  tasksContainer: {
    label: 'tasks-container',
    marginBottom: '24px',
    borderBottom: '1px solid #333',
    paddingBottom: '16px',
  },
  board: {
    label: 'board',
    flex: 1,
    display: 'flex',
    gap: '16px',
    overflowX: 'auto' as const,
    paddingBottom: '16px',
  },
  list: {
    label: 'list',
    minWidth: '280px',
    maxWidth: '280px',
    backgroundColor: '#1a1a1a',
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  listHeader: {
    label: 'list-header',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    padding: '0 4px',
  },
  listTitle: {
    label: 'list-title',
    fontSize: '14px',
    fontWeight: 600,
    color: '#ffffff',
  },
  listCards: {
    label: 'list-cards',
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    minHeight: '100px',
  },
  card: {
    label: 'card',
    backgroundColor: '#0f0f0f',
    borderRadius: '8px',
    padding: '10px 12px',
    cursor: 'pointer',
    transition: 'box-shadow 0.2s',
  },
  cardTitle: {
    label: 'card-title',
    fontSize: '13px',
    color: '#ffffff',
    lineHeight: 1.4,
  },
  addButton: {
    label: 'add-button',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#666',
    padding: '8px',
    borderRadius: '6px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: '100%',
    fontSize: '13px',
    marginTop: 'auto',
  },
  notFound: {
    label: 'not-found',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#888',
  },
  taskSkeleton: {
    label: 'task-skeleton',
    height: '60px',
    backgroundColor: '#1a1a1a',
    borderRadius: '8px',
    marginBottom: '8px',
    animation: 'pulse 2s infinite',
  },
  revalidating: {
    label: 'revalidating',
    opacity: 0.7,
    pointerEvents: 'none' as const,
  },
};

// ============================================================================
// Types
// ============================================================================

type TaskListProps = {
  list: BoardListWithCards;
  tasksPromise: Promise<Task[]>;
  optimisticTasks?: Task[];
  createTask: (data: CreateTaskRequest) => Promise<void>;
  isCreatingTask: boolean;
  navigate: BoardDetailPageProps['navigate'];
};

// ============================================================================
// TaskList Component - Uses queries for its tasks
// ============================================================================

function TaskList({
  list,
  tasksPromise,
  optimisticTasks,
  createTask,
  isCreatingTask,
  navigate,
}: TaskListProps) {
  // Local state for add task form
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;

    await createTask({
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim(),
      listId: list.id,
      status: 'todo' as TaskStatus,
      priority: 'medium' as TaskPriority,
    });

    setIsAddingTask(false);
    setNewTaskTitle('');
    setNewTaskDescription('');
  };

  // Filter tasks for this list
  const filterByList = (tasks: Task[]) =>
    tasks.filter((t) => t.listId === list.id);

  return (
    <div style={styles.list}>
      <div style={styles.listHeader}>
        <span style={styles.listTitle}>{list.name}</span>
      </div>

      <div style={styles.listCards}>
        <AwaitResult
          resolve={tasksPromise}
          optimisticValue={optimisticTasks}
          initialLoading={
            <>
              <div style={styles.taskSkeleton} />
              <div style={styles.taskSkeleton} />
            </>
          }
          initialError={(error) => (
            <div style={{ color: '#ef4444', fontSize: '12px' }}>
              Failed to load tasks: {error.message}
            </div>
          )}
        >
          {(allTasks, state) => {
            const tasks = filterByList(allTasks as Task[]);
            return (
              <div
                style={
                  state.phase === 'revalidating' ? styles.revalidating : {}
                }
              >
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onSelect={() => {
                      navigate(window.location.pathname, {
                        params: { 'taskPanel.taskId': task.id },
                      });
                    }}
                  />
                ))}
                {tasks.length === 0 && (
                  <div
                    style={{ color: '#666', fontSize: '12px', padding: '8px' }}
                  >
                    No tasks yet
                  </div>
                )}
              </div>
            );
          }}
        </AwaitResult>

        {/* Legacy cards */}
        {list.cards.map((card) => (
          <div key={card.id} style={styles.card}>
            <div style={styles.cardTitle}>{card.title}</div>
          </div>
        ))}
      </div>

      {/* Add Task Form */}
      {isAddingTask ? (
        <div style={{ marginTop: '8px' }}>
          <input
            type="text"
            placeholder="Task title"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '4px',
              backgroundColor: '#0f0f0f',
              border: '1px solid #2a2a2a',
              borderRadius: '4px',
              color: '#fff',
            }}
            disabled={isCreatingTask}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateTask();
              if (e.key === 'Escape') setIsAddingTask(false);
            }}
          />
          <textarea
            placeholder="Description (optional)"
            value={newTaskDescription}
            onChange={(e) => setNewTaskDescription(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '4px',
              backgroundColor: '#0f0f0f',
              border: '1px solid #2a2a2a',
              borderRadius: '4px',
              color: '#fff',
              resize: 'vertical',
              minHeight: '40px',
            }}
            disabled={isCreatingTask}
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              onClick={handleCreateTask}
              disabled={isCreatingTask || !newTaskTitle.trim()}
              style={{
                flex: 1,
                padding: '6px 12px',
                backgroundColor: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {isCreatingTask ? 'Adding...' : 'Add Task'}
            </button>
            <button
              type="button"
              onClick={() => setIsAddingTask(false)}
              style={{
                padding: '6px 12px',
                backgroundColor: 'transparent',
                color: '#888',
                border: '1px solid #333',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          style={styles.addButton}
          onClick={() => setIsAddingTask(true)}
        >
          + Add Task
        </button>
      )}
    </div>
  );
}

// ============================================================================
// TaskCard Component
// ============================================================================

type TaskCardProps = {
  task: Task;
  onSelect: () => void;
};

function TaskCard({ task, onSelect }: TaskCardProps) {
  return (
    <div style={styles.card} onClick={onSelect}>
      <div style={styles.cardTitle}>{task.title}</div>
      {task.description && (
        <div style={{ fontSize: '12px', color: '#888' }}>
          {task.description}
        </div>
      )}
      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
        {task.status} · {task.priority}
      </div>
    </div>
  );
}

// ============================================================================
// BoardPage Component
// ============================================================================

const BoardPage = ({
  loaderData,
  getOutlet,
  apiImplementations,
  params,
  ctx,
  mutation,
  navigate,
}: BoardDetailPageProps) => {
  const board = loaderData?.type === 'Ok' ? loaderData.value : null;
  const TasksOutlet = getOutlet('tasks');

  // Query all tasks for this board - parent owns the query
  // Uses useQuery hook for live optimistic updates
  const [tasksPromise, optimisticTasks] = useQuery(
    ctx,
    tasksQuery,
    { boardId: params.boardId },
    { staleTime: 30000 },
  );

  // Bind mutation for creating tasks - parent owns the mutation
  const createTask = mutation(createTaskMutation, {
    defaultScope: 'global',
  });

  // Create task handler to pass to children
  const handleCreateTask = async (data: CreateTaskRequest) => {
    await createTask.run({
      boardId: params.boardId,
      data,
    });
  };

  // State for creating lists (lists don't use query system yet)
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [isCreatingList, setIsCreatingList] = useState(false);

  // Handler for creating a new list
  // TODO: Add createList to route's API routes for proper typing
  const handleCreateList = async () => {
    if (!newListName.trim()) return;

    setIsCreatingList(true);
    try {
      // Note: createList is not in the route's API yet
      console.log('apiImplementations', apiImplementations);
      const createListHandler = apiImplementations.createList;
      const result = await createListHandler.execute(
        {
          pathParams: { boardId: params.boardId },
          pathQuery: {},
          body: { name: newListName.trim() },
          files: undefined,
        },
        { session: ctx.session },
      );
      if (result.type === 'Ok') {
        // TODO: Replace with proper loader revalidation API when available
        // Currently triggers loader re-run via navigation without full page reload
        // Better approach: ctx.revalidateLoader() or similar explicit API
        navigate(window.location.pathname, { replace: true });
      }
    } finally {
      setIsCreatingList(false);
      setIsAddingList(false);
      setNewListName('');
    }
  };

  if (!board) {
    return (
      <div style={styles.notFound}>
        <p>Board not found. Select a board from the sidebar.</p>
      </div>
    );
  }
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>{board.name}</h1>
      </header>
      <div style={styles.tasksContainer}>
        <TasksOutlet />
      </div>

      <div style={styles.board}>
        {board.lists.map((list) => (
          <TaskList
            key={list.id}
            list={list}
            tasksPromise={tasksPromise}
            optimisticTasks={optimisticTasks}
            createTask={handleCreateTask}
            isCreatingTask={createTask.isPending}
            navigate={navigate}
          />
        ))}

        {/* Add List */}
        <div style={{ ...styles.list, backgroundColor: '#1a1a1a33' }}>
          {isAddingList ? (
            <div>
              <input
                type="text"
                placeholder="List name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginBottom: '8px',
                  backgroundColor: '#0f0f0f',
                  border: '1px solid #2a2a2a',
                  borderRadius: '4px',
                  color: '#fff',
                }}
                disabled={isCreatingList}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateList();
                  if (e.key === 'Escape') setIsAddingList(false);
                }}
              />
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={handleCreateList}
                  disabled={isCreatingList || !newListName.trim()}
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    backgroundColor: '#4f46e5',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  {isCreatingList ? 'Creating...' : 'Add List'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingList(false)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: 'transparent',
                    color: '#888',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              style={styles.addButton}
              onClick={() => setIsAddingList(true)}
            >
              + Add List
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BoardPage;
