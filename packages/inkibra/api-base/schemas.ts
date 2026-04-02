// biome-ignore lint/style/noRestrictedImports: typia is allowed in schema files
import typia from 'typia';
import type { EmptyObject } from './constants/empty-object';
import type { NoData } from './constants/no-data';
import type { SimpleSuccess } from './constants/simple-success';

export const validateNoData = typia.createValidate<NoData>();
export const validateSimpleSuccess = typia.createValidate<SimpleSuccess>();
export const validateEmptyObject = typia.createValidate<EmptyObject>();
