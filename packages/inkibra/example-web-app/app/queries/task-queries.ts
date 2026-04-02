/**
 * Task Queries and Mutations
 *
 * Static query/mutation plans that use route DEFINITIONS (not handlers).
 * Execution happens via runQuery/mutation helpers provided by the router,
 * which bind actual handlers at runtime.
 */

import { createMutation, createQuery, type Selection } from '@inkibra/router';
import {
  createTaskRoute,
  deleteTaskRoute,
  getTaskRoute,
  listAllTasksRoute,
  listTasksRoute,
  updateTaskRoute,
} from '../../api/routes/tasks';
import type { SessionData, Task } from '../../shared/types';

// ============================================================================
// Shared Types
// ============================================================================

export type TasksQueryContext = {
  session: SessionData | null;
};

// Type guard for Task entity
function isTaskEntity(value: unknown): value is Task {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'boardId' in value &&
    'title' in value &&
    'status' in value &&
    'priority' in value &&
    'position' in value &&
    'createdAt' in value &&
    'updatedAt' in value
  );
}

function getOkValue<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const outer = value as {
    type?: unknown;
    value?: {
      type?: unknown;
      value?: unknown;
    };
  };

  if (outer.type !== 'Ok') {
    return null;
  }

  if (outer.value?.type !== 'Ok') {
    return null;
  }

  return (outer.value.value as T) ?? null;
}

// ============================================================================
// Task Query - fetch tasks for a board
// ============================================================================

export type TasksQueryArgs = {
  boardId: string;
  listId?: string;
  status?: 'todo' | 'in-progress' | 'done';
};

/**
 * Static query to fetch tasks for a board with optional status filter.
 * Uses DSL filter for efficient cache matching.
 *
 * Required routes: listTasks
 */
export const tasksQuery = createQuery({
  apiRoutes: {
    listTasks: listTasksRoute,
  },

  map: (args: TasksQueryArgs, ctx: TasksQueryContext) => ({
    listTasks: {
      handle: [
        {
          pathParams: { boardId: args.boardId },
          pathQuery: {
            ...(args.listId && { listId: args.listId }),
            ...(args.status && { status: args.status }),
          },
          body: {},
          files: undefined,
        },
        ctx,
      ],
      select: {
        type: 'Task',
        filter: {
          boardId: { op: 'eq', value: args.boardId },
          ...(args.listId && { listId: { op: 'eq', value: args.listId } }),
          ...(args.status && { status: { op: 'eq', value: args.status } }),
        },
        sort: 'desc',
        sortKey: 'updatedAt',
      } as Selection,
    },
  }),

  config: {
    staleTime: 30_000, // 30 seconds
    refetchOnFocus: true,
  },

  reduce: (results) => {
    return getOkValue<Task[]>(results.listTasks) ?? [];
  },
});

// ============================================================================
// Activity Query - global latest tasks
// ============================================================================

export type ActivityQueryArgs = {
  limit?: number;
};

/**
 * Static query to fetch the latest tasks across all boards.
 *
 * Required routes: listAllTasks
 */
export const activityQuery = createQuery({
  apiRoutes: {
    listAllTasks: listAllTasksRoute,
  },

  map: (args: ActivityQueryArgs, ctx: TasksQueryContext) => ({
    listAllTasks: {
      handle: [
        {
          pathParams: {},
          pathQuery: { ...(args.limit ? { limit: args.limit } : {}) },
          body: {},
          files: undefined,
        },
        ctx,
      ],
      select: {
        type: 'Task',
        sort: 'desc',
        sortKey: 'updatedAt',
        limit: args.limit ?? 10,
      } as Selection,
    },
  }),

  config: {
    staleTime: 15_000,
    refetchOnFocus: true,
  },

  reduce: (results) => {
    return getOkValue<Task[]>(results.listAllTasks) ?? [];
  },
});

// ============================================================================
// Get Task Query - fetch single task by id
// ============================================================================

export type GetTaskArgs = {
  taskId: string;
};

/**
 * Static query to fetch a single task by id.
 *
 * Required routes: getTask
 */
export const getTaskQuery = createQuery({
  apiRoutes: {
    getTask: getTaskRoute,
  },

  map: (args: GetTaskArgs, ctx: TasksQueryContext) => ({
    getTask: {
      handle: [
        {
          pathParams: { taskId: args.taskId },
          pathQuery: {},
          body: {},
          files: undefined,
        },
        ctx,
      ],
      select: {
        type: 'Task',
        filter: { id: { op: 'eq', value: args.taskId } },
      } satisfies Selection,
    },
  }),

  config: {
    staleTime: 30_000,
    refetchOnFocus: false,
  },

  reduce: (results) => {
    return getOkValue<Task>(results.getTask);
  },
});

// ============================================================================
// Create Task Mutation
// ============================================================================

export type CreateTaskArgs = {
  boardId: string;
  data: {
    title: string;
    description: string;
    listId?: string;
    status?: 'todo' | 'in-progress' | 'done';
    priority?: 'low' | 'medium' | 'high';
  };
};

/**
 * Static mutation to create a new task.
 *
 * Required routes: createTask
 */
export const createTaskMutation = createMutation({
  apiRoutes: {
    createTask: createTaskRoute,
  },

  map: (args: CreateTaskArgs, ctx: TasksQueryContext) => ({
    createTask: {
      handle: [
        {
          pathParams: { boardId: args.boardId },
          pathQuery: {},
          body: args.data,
          files: undefined,
        },
        ctx,
      ],
      select: [
        {
          // List-scoped selection (for list outlet)
          type: 'Task',
          filter: {
            boardId: { op: 'eq', value: args.boardId },
            ...(args.data.listId && {
              listId: { op: 'eq', value: args.data.listId },
            }),
          },
          sort: 'desc',
          sortKey: 'updatedAt',
        } satisfies Selection,
        {
          // Global activity selection (latest tasks across boards)
          type: 'Task',
          sort: 'desc',
          sortKey: 'updatedAt',
          limit: 10,
        } satisfies Selection,
      ],
    },
  }),

  // Optimistic update - create a temporary task
  optimistic: (args: CreateTaskArgs) => ({
    type: 'Task',
    id: `temp-${Date.now()}`,
    boardId: args.boardId,
    listId: args.data.listId,
    title: args.data.title,
    description: args.data.description,
    status: args.data.status ?? 'todo',
    priority: args.data.priority ?? 'medium',
    position: 0,
    createdBy: 'optimistic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
});

// ============================================================================
// Update Task Mutation
// ============================================================================

export type UpdateTaskArgs = {
  taskId: string;
  data: {
    title?: string;
    description?: string;
    status?: 'todo' | 'in-progress' | 'done';
    priority?: 'low' | 'medium' | 'high';
  };
};

/**
 * Static mutation to update an existing task.
 *
 * Required routes: updateTask
 */
export const updateTaskMutation = createMutation({
  apiRoutes: {
    updateTask: updateTaskRoute,
  },

  map: (args: UpdateTaskArgs, ctx: TasksQueryContext) => ({
    updateTask: {
      handle: [
        {
          pathParams: { taskId: args.taskId },
          pathQuery: {},
          body: args.data,
          files: undefined,
        },
        ctx,
      ],
      select: { type: 'Task', id: args.taskId } as Selection,
    },
  }),

  // Optimistic update - merge new data with existing
  optimistic: (args: UpdateTaskArgs, current: unknown) => {
    const base: Task = isTaskEntity(current)
      ? current
      : {
          type: 'Task',
          id: args.taskId,
          boardId: '',
          listId: undefined,
          title: '',
          description: '',
          status: 'todo',
          priority: 'medium',
          position: 0,
          createdBy: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

    return {
      ...base,
      ...args.data,
      updatedAt: new Date().toISOString(),
    };
  },
});

// ============================================================================
// Delete Task Mutation
// ============================================================================

export type DeleteTaskArgs = {
  taskId: string;
  boardId: string; // Needed to invalidate the right cache
};

/**
 * Static mutation to delete a task.
 *
 * Required routes: deleteTask
 */
export const deleteTaskMutation = createMutation({
  apiRoutes: {
    deleteTask: deleteTaskRoute,
  },

  map: (args: DeleteTaskArgs, ctx: TasksQueryContext) => ({
    deleteTask: {
      handle: [
        {
          pathParams: { taskId: args.taskId },
          pathQuery: {},
          body: {},
          files: undefined,
        },
        ctx,
      ],
      select: { type: 'Task', id: args.taskId } as Selection,
    },
  }),
});
