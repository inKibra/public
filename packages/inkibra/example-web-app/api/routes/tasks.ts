/**
 * Tasks API Routes
 *
 * CRUD operations for tasks on boards
 */

import { createAPIRoute } from '@inkibra/router';
import { HttpMethod } from '@inkibra/router/constants/http-method';
import type {
  CreateTask,
  DeleteTask,
  GetTask,
  ListTasks,
  UpdateTask,
} from '../../schemas';
import {
  createTaskSchema as createTaskRouteSchema,
  deleteTaskSchema as deleteTaskRouteSchema,
  getTaskSchema as getTaskRouteSchema,
  listAllTasksSchema as listAllTasksRouteSchema,
  listTasksSchema as listTasksRouteSchema,
  updateTaskSchema as updateTaskRouteSchema,
} from '../../schemas';
import { SessionCodec } from './auth';

// ============================================================================
// List Tasks
// ============================================================================

export const listTasksSchema = listTasksRouteSchema;

export const listTasksRoute = createAPIRoute({
  name: 'listTasks',
  method: HttpMethod.GET,
  path: '/api/boards/:boardId/tasks',
  schema: listTasksSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// List All Tasks (global activity)
// ============================================================================

export const listAllTasksSchema = listAllTasksRouteSchema;

export const listAllTasksRoute = createAPIRoute({
  name: 'listAllTasks',
  method: HttpMethod.GET,
  path: '/api/tasks',
  schema: listAllTasksSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Get Task
// ============================================================================

export const getTaskSchema = getTaskRouteSchema;

export const getTaskRoute = createAPIRoute({
  name: 'getTask',
  method: HttpMethod.GET,
  path: '/api/tasks/:taskId',
  schema: getTaskSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Create Task
// ============================================================================

export const createTaskSchema = createTaskRouteSchema;

export const createTaskRoute = createAPIRoute({
  name: 'createTask',
  method: HttpMethod.POST,
  path: '/api/boards/:boardId/tasks',
  schema: createTaskSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Update Task
// ============================================================================

export const updateTaskSchema = updateTaskRouteSchema;

export const updateTaskRoute = createAPIRoute({
  name: 'updateTask',
  method: HttpMethod.PATCH,
  path: '/api/tasks/:taskId',
  schema: updateTaskSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Delete Task
// ============================================================================

export const deleteTaskSchema = deleteTaskRouteSchema;

export const deleteTaskRoute = createAPIRoute({
  name: 'deleteTask',
  method: HttpMethod.DELETE,
  path: '/api/tasks/:taskId',
  schema: deleteTaskSchema,
  contextCodec: { session: SessionCodec },
});

// ============================================================================
// Export Types and Routes
// ============================================================================

export type { ListTasks, GetTask, CreateTask, UpdateTask, DeleteTask };

export const taskRoutes = {
  listTasks: listTasksRoute,
  listAllTasks: listAllTasksRoute,
  getTask: getTaskRoute,
  createTask: createTaskRoute,
  updateTask: updateTaskRoute,
  deleteTask: deleteTaskRoute,
};
