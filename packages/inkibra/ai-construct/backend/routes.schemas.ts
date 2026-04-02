import { defineRouteSchema } from '@inkibra/router/lib/api-route';
import type {
  ApplyConstructLabAction,
  DeleteConstructFile,
  EnterConstructEditMode,
  ExitConstructEditMode,
  GetConstructContextTrace,
  GetConstructLabSnapshot,
  GetConstructLanes,
  GetConstructRuntimeSnapshot,
  ListConstructFiles,
  ReadConstructFile,
  WriteConstructFile,
} from './routes';

export const getConstructLabSnapshotSchema = defineRouteSchema<{
  pathParams: GetConstructLabSnapshot.PathParams;
  pathQuery: GetConstructLabSnapshot.PathQuery;
  body: GetConstructLabSnapshot.Body;
  response: GetConstructLabSnapshot.Response;
}>();

export const applyConstructLabActionSchema = defineRouteSchema<{
  pathParams: ApplyConstructLabAction.PathParams;
  pathQuery: ApplyConstructLabAction.PathQuery;
  body: ApplyConstructLabAction.Body;
  response: ApplyConstructLabAction.Response;
}>();

export const getConstructRuntimeSnapshotSchema = defineRouteSchema<{
  pathParams: GetConstructRuntimeSnapshot.PathParams;
  pathQuery: GetConstructRuntimeSnapshot.PathQuery;
  body: GetConstructRuntimeSnapshot.Body;
  response: GetConstructRuntimeSnapshot.Response;
}>();

export const enterConstructEditModeSchema = defineRouteSchema<{
  pathParams: EnterConstructEditMode.PathParams;
  pathQuery: EnterConstructEditMode.PathQuery;
  body: EnterConstructEditMode.Body;
  response: EnterConstructEditMode.Response;
}>();

export const exitConstructEditModeSchema = defineRouteSchema<{
  pathParams: ExitConstructEditMode.PathParams;
  pathQuery: ExitConstructEditMode.PathQuery;
  body: ExitConstructEditMode.Body;
  response: ExitConstructEditMode.Response;
}>();

export const listConstructFilesSchema = defineRouteSchema<{
  pathParams: ListConstructFiles.PathParams;
  pathQuery: ListConstructFiles.PathQuery;
  body: ListConstructFiles.Body;
  response: ListConstructFiles.Response;
}>();

export const readConstructFileSchema = defineRouteSchema<{
  pathParams: ReadConstructFile.PathParams;
  pathQuery: ReadConstructFile.PathQuery;
  body: ReadConstructFile.Body;
  response: ReadConstructFile.Response;
}>();

export const writeConstructFileSchema = defineRouteSchema<{
  pathParams: WriteConstructFile.PathParams;
  pathQuery: WriteConstructFile.PathQuery;
  body: WriteConstructFile.Body;
  response: WriteConstructFile.Response;
}>();

export const deleteConstructFileSchema = defineRouteSchema<{
  pathParams: DeleteConstructFile.PathParams;
  pathQuery: DeleteConstructFile.PathQuery;
  body: DeleteConstructFile.Body;
  response: DeleteConstructFile.Response;
}>();

export const getConstructLanesSchema = defineRouteSchema<{
  pathParams: GetConstructLanes.PathParams;
  pathQuery: GetConstructLanes.PathQuery;
  body: GetConstructLanes.Body;
  response: GetConstructLanes.Response;
}>();

export const getConstructContextTraceSchema = defineRouteSchema<{
  pathParams: GetConstructContextTrace.PathParams;
  pathQuery: GetConstructContextTrace.PathQuery;
  body: GetConstructContextTrace.Body;
  response: GetConstructContextTrace.Response;
}>();
