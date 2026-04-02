import type { Logger } from '@inkibra/logger';
import { Filter } from '@inkibra/observable-cache';
import { err, ok } from 'neverthrow';
import type { DbResult, DbWarning, NonEmptyArray } from './db-result';
import type {
  Cas,
  Driver,
  EnsureCollectionOptions,
  MutationResult,
  TypedObjectBase,
} from './driver';
import {
  type CouchbaseDalConnection,
  CouchbaseDriver,
  type ITypedCouchbaseObject,
} from './drivers/couchbase-driver';
import { DALErrors } from './error-codes';

export type FindOptions<
  T extends ITypedCouchbaseObject | TypedObjectBase,
  K extends keyof T,
> = {
  limit?: number;
  offset?: number;
  filter?: Filter<T, K | 'created' | 'modified' | 'deleted'>;
  orderBy?: {
    field: K | 'created' | 'modified';
    direction: 'ASC' | 'DESC';
  };
};

// TODO: discuss indexes and adaptive indexes with couchbase

type BaseObject = ITypedCouchbaseObject | TypedObjectBase;

type OnlySimple<T> = {
  [P in keyof Required<T>]: Required<T>[P] extends string | number | boolean
    ? P extends keyof BaseObject
      ? never
      : P
    : never;
}[Exclude<keyof Required<T>, keyof BaseObject>];

type OnlySimpleArray<T> = {
  [P in keyof Required<T>]: Required<T>[P] extends Array<string> | Array<number>
    ? P
    : never;
}[keyof Required<T>];

function mergeWarnings(
  a?: NonEmptyArray<DbWarning>,
  b?: NonEmptyArray<DbWarning>,
): NonEmptyArray<DbWarning> | undefined {
  if (a && b) return [...a, ...b] as NonEmptyArray<DbWarning>;
  return a ?? b;
}

type Deleted<TModel extends BaseObject> = {
  type: 'DELETED';
  oldType: TModel['type'];
  id: string;
};

export class DalBase<
  TModel extends BaseObject,
  TValueIndexes extends Array<Extract<OnlySimple<TModel>, string>>,
  TArrayIndexes extends Array<Extract<OnlySimpleArray<TModel>, string>>,
  TUpdates,
  TCollectionName extends string,
> {
  #driver: Driver;
  #type: TModel['type'];
  #version: TModel['version'];
  #valueIndexes: TValueIndexes;
  #arrayIndexes: TArrayIndexes;
  #collection: TCollectionName;
  #discriminator: (data: unknown) => data is TModel;
  static async init<
    TModel extends BaseObject,
    TValueIndexes extends Array<Extract<OnlySimple<TModel>, string>>,
    TArrayIndexes extends Array<Extract<OnlySimpleArray<TModel>, string>>,
    TUpdates,
    TCollectionName extends string,
  >(
    logger: Logger,
    {
      driver,
      db,
      type,
      version,
      valueIndexes,
      arrayIndexes,
      collection,
      discriminator,
      ensureCollectionOptions,
    }: {
      driver?: Driver;
      db?: CouchbaseDalConnection;
      type: TModel['type'];
      version: TModel['version'];
      valueIndexes: TValueIndexes;
      arrayIndexes: TArrayIndexes;
      collection: TCollectionName;
      discriminator: (data: unknown) => data is TModel;
      ensureCollectionOptions?: EnsureCollectionOptions;
    },
  ) {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'init',
    });

    // Handle backward compatibility: wrap CouchbaseDalConnection in driver
    let actualDriver: Driver;
    if (driver) {
      actualDriver = driver;
    } else if (db) {
      // Import dynamically to avoid circular dependency
      const { CouchbaseDriver } = await import('./drivers/couchbase-driver');
      actualDriver = new CouchbaseDriver(db);
    } else {
      throw new Error('Either driver or db must be provided');
    }

    const dal = new DalBase<
      TModel,
      TValueIndexes,
      TArrayIndexes,
      TUpdates,
      TCollectionName
    >({
      driver: actualDriver,
      type,
      version,
      valueIndexes,
      arrayIndexes,
      collection,
      discriminator,
    });

    // Ensure collection and indexes
    await actualDriver.ensureCollection(
      logger,
      {
        name: collection,
        indexes: [
          { fields: ['type'], composite: false },
          { fields: ['version'], composite: false },
          { fields: ['id'], composite: false },
          { fields: ['deleted'], composite: false },
          ...valueIndexes.map((f) => ({ fields: [f], composite: false })),
          ...arrayIndexes.map((f) => ({ fields: [f], composite: false })),
        ],
      },
      ensureCollectionOptions,
    );

    // Ensure type-specific indexes
    await actualDriver.ensureIndex(
      logger,
      collection,
      { fields: ['type'], composite: false },
      type,
    );
    if (version !== undefined) {
      await actualDriver.ensureIndex(
        logger,
        collection,
        { fields: ['version'], composite: false },
        type,
      );
    }
    for (const indexedProperty of valueIndexes) {
      await actualDriver.ensureIndex(
        logger,
        collection,
        { fields: [indexedProperty], composite: false },
        type,
      );
    }
    for (const indexedProperty of arrayIndexes) {
      await actualDriver.ensureIndex(
        logger,
        collection,
        { fields: [indexedProperty], composite: false },
        type,
      );
    }

    return dal;
  }
  protected constructor({
    driver,
    type,
    version,
    valueIndexes,
    arrayIndexes,
    collection,
    discriminator,
  }: {
    driver: Driver;
    type: TModel['type'];
    version: TModel['version'];
    valueIndexes: TValueIndexes;
    arrayIndexes: TArrayIndexes;
    collection: TCollectionName;
    discriminator: (data: unknown) => data is TModel;
  }) {
    this.#driver = driver;
    this.#type = type;
    this.#version = version;
    this.#valueIndexes = valueIndexes;
    this.#arrayIndexes = arrayIndexes;
    this.#collection = collection;
    this.#discriminator = discriminator;
  }
  public get driver(): Driver {
    return this.#driver;
  }
  public get db(): Driver {
    // Backward compatibility alias
    return this.#driver;
  }
  public get version(): TModel['version'] {
    // TODO: enforce version selection on make query
    return this.#version;
  }

  public get discriminator(): (data: unknown) => data is TModel {
    return this.#discriminator;
  }
  public get type(): TModel['type'] {
    return this.#type;
  }
  public get valueIndexes(): TValueIndexes {
    return this.#valueIndexes;
  }
  public get arrayIndexes(): TArrayIndexes {
    return this.#arrayIndexes;
  }
  public get collection(): TCollectionName {
    return this.#collection;
  }
  public makeQuery(
    logger: Logger,
    {
      limit = 100,
      offset,
      filter,
    }: FindOptions<TModel, TValueIndexes[number] | TArrayIndexes[number]>,
    queryCommand = '*',
    includeDeleted = false,
  ) {
    let queryClause = '';
    const queryArgs: Array<
      string | boolean | number | Array<string> | Array<number>
    > = [this.type];
    const queryArgsOffset = 1;
    queryClause = `${queryClause}`;
    if (this.version !== undefined) {
      queryClause = `${queryClause} AND version=$${
        queryArgs.length + queryArgsOffset
      }`;
      queryArgs.push(this.version);
    }
    for (const key in filter) {
      if (Reflect.has(filter, key)) {
        const condition = Reflect.get(filter, key) as Filter.Filters;

        if (condition) {
          if ('operator' in condition) {
            switch (condition.operator) {
              case Filter.Operators.EQUAL:
                // thing = 5;
                queryClause = `${queryClause} AND \`${key}\`=$${
                  queryArgs.length + queryArgsOffset
                }`;
                queryArgs.push(condition?.value);
                break;
              case Filter.Operators.LIKE_AND:
                if (condition.values.length) {
                  queryClause = `${queryClause} AND \`${key}\` LIKE '%${condition.values[0]}%'`;
                  for (let i = 1; i < condition.values.length; i++) {
                    queryClause = `${queryClause} AND \`${key}\` LIKE '%${condition.values[i]}%'`;
                  }
                }
                break;
              case Filter.Operators.LIKE_OR:
                if (condition.values.length) {
                  queryClause = `${queryClause} AND \`${key}\` LIKE '%${condition.values[0]}%'`;
                  for (let i = 1; i < condition.values.length; i++) {
                    queryClause = `${queryClause} OR \`${key}\` LIKE '%${condition.values[i]}%'`;
                  }
                }
                break;
              case Filter.Operators.NOT_EQUAL:
                // thing != 5;
                queryClause = `${queryClause} AND \`${key}\`!=$${
                  queryArgs.length + queryArgsOffset
                }`;
                queryArgs.push(condition.value);
                break;
              case Filter.Operators.BETWEEN:
                // thing BETWEEN 5 AND 10;
                queryClause = `${queryClause} AND \`${key}\` BETWEEN $${
                  queryArgs.length + queryArgsOffset
                } AND $${queryArgs.length + queryArgsOffset + 1}`;
                queryArgs.push(condition.firstValue);
                queryArgs.push(condition.secondValue);
                break;
              case Filter.Operators.GREATER_THAN:
                // thing > 5;
                queryClause = `${queryClause} AND \`${key}\`>$${
                  queryArgs.length + queryArgsOffset
                }`;
                queryArgs.push(condition.value);
                break;
              case Filter.Operators.LESS_THAN:
                // thing < 5;
                queryClause = `${queryClause} AND \`${key}\`<$${
                  queryArgs.length + queryArgsOffset
                }`;
                queryArgs.push(condition.value);
                break;
              case Filter.Operators.GREATER_THAN_OR_EQUAL:
                // thing >= 5;
                queryClause = `${queryClause} AND \`${key}\`>=$${
                  queryArgs.length + queryArgsOffset
                }`;
                queryArgs.push(condition.value);
                break;
              case Filter.Operators.LESS_THAN_OR_EQUAL:
                // thing <= 5;
                queryClause = `${queryClause} AND \`${key}\`<=$${
                  queryArgs.length + queryArgsOffset
                }`;
                queryArgs.push(condition.value);
                break;
              case Filter.Operators.IN:
                // thing IN ["thing1", "thing2"];
                queryClause = `${queryClause} AND \`${key}\` IN $${
                  queryArgs.length + queryArgsOffset
                }`;
                queryArgs.push(condition.values);
                break;
              case Filter.Operators.NOT_IN:
                // thing NOT IN ["thing1", "thing2"];
                queryClause = `${queryClause} AND \`${key}\` NOT IN $${
                  queryArgs.length + queryArgsOffset
                }`;
                queryArgs.push(condition.values);
                break;
              case Filter.Operators.ANY_IN:
                // ANY thing IN things SATISFIES thing IN ["thing1", "thing2"] END;
                queryClause = `${queryClause} AND ANY \`${key}\` IN \`${key}\` SATISFIES \`${key}\` IN $${
                  queryArgs.length + queryArgsOffset
                } END`;
                queryArgs.push(condition.values);
                break;
              case Filter.Operators.EVERY_IN:
                // EVERY thing IN things SATISFIES thing IN ["thing1", "thing2"] END;
                queryClause = `${queryClause} AND EVERY \`${key}\` IN \`${key}\` SATISFIES \`${key}\` IN $${
                  queryArgs.length + queryArgsOffset
                } END`;
                queryArgs.push(condition.values);
                break;
              case Filter.Operators.NOT_ANY_IN:
                // NOT ANY thing IN things SATISFIES thing IN ["thing1", "thing2"] END;
                queryClause = `${queryClause} AND NOT ANY \`${key}\` IN \`${key}\` SATISFIES \`${key}\` IN $${
                  queryArgs.length + queryArgsOffset
                } END`;
                queryArgs.push(condition.values);
                break;
              case Filter.Operators.NOT_EVERY_IN:
                // NOT EVERY thing IN things SATISFIES thing IN ["thing1", "thing2"] END;
                queryClause = `${queryClause} AND NOT EVERY \`${key}\` IN \`${key}\` SATISFIES \`${key}\` IN $${
                  queryArgs.length + queryArgsOffset
                } END`;
                queryArgs.push(condition.values);
                break;
            }
          }
        }
      }
    }
    queryClause = `${queryClause} LIMIT $${queryArgs.length + queryArgsOffset}`;
    queryArgs.push(limit);
    if (offset) {
      queryClause = `${queryClause} OFFSET $${queryArgs.length + queryArgsOffset}`;
      queryArgs.push(offset);
    }
    const query = `SELECT ${queryCommand} FROM bucket WHERE ${
      includeDeleted === false ? 'deleted IS MISSING and' : ''
    } type=$1 ${queryClause}`;
    logger.debug('Generated query', { query, queryArgs });
    return { query, queryArgs };
  }
  public async find(
    logger: Logger,
    {
      limit,
      filter,
      offset,
      orderBy,
    }: FindOptions<TModel, TValueIndexes[number] | TArrayIndexes[number]>,
    _consistent = true,
  ): Promise<DbResult<TModel[]>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'find',
    });
    logger.trace('find', { limit, filter, orderBy });

    const result = await this.#driver.find<TModel>(
      logger,
      this.collection,
      this.type,
      {
        limit,
        filter: filter as unknown as Filter<
          TModel,
          keyof TModel | 'created' | 'modified' | 'deleted'
        >,
        offset,
        orderBy,
      },
    );

    if (result.isErr()) {
      return result;
    }

    // Filter with discriminator
    const ret = result.value.value.filter(this.#discriminator);
    return ok({ value: ret, warnings: result.value.warnings });
  }
  public async findOne(
    logger: Logger,
    {
      filter,
    }: Pick<
      FindOptions<TModel, TValueIndexes[number] | TArrayIndexes[number]>,
      'filter'
    >,
    consistent = false,
  ): Promise<DbResult<TModel | undefined>> {
    const limit = 1;
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'findOne',
    });
    logger.trace('find', { limit, filter });
    const result = await this.find(logger, { limit, filter }, consistent);
    if (result.isErr()) {
      return err(result.error);
    }
    const [ret] = result.value.value;
    return ok({ value: ret, warnings: result.value.warnings });
  }
  public async exists(logger: Logger, id: string) {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'exists',
    });
    logger.trace('exists', { id });
    const res = await this.#driver.exists(logger, this.collection, id);
    return res;
  }

  public async get(
    logger: Logger,
    id: TModel['id'],
  ): Promise<DbResult<{ cas: Cas; value: TModel } | undefined>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'get',
    });
    logger.trace('get', { id });

    const result = await this.#driver.get<TModel>(logger, this.collection, id);

    if (result.isErr()) {
      return result;
    }

    const record = result.value.value;
    if (!record) {
      return ok({ value: undefined, warnings: result.value.warnings });
    }

    if (this.#discriminator(record.value)) {
      return ok({ value: record, warnings: result.value.warnings });
    }

    const reason = `get failed: type mismatch between ${this.type} and the returned type`;
    logger.warn(reason);
    return err(DALErrors.dbQuery(reason));
  }

  public async getMany(
    logger: Logger,
    ids: TModel['id'][],
  ): Promise<DbResult<{ value: TModel; cas: Cas }[]>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'getMany',
    });
    logger.trace('getMany', { ids });

    const result = await this.#driver.getMany<TModel>(
      logger,
      this.collection,
      ids,
    );

    if (result.isErr()) {
      return result;
    }

    const ret: { value: TModel; cas: Cas }[] = [];
    for (const item of result.value.value) {
      if (this.#discriminator(item.value)) {
        ret.push(item);
      } else {
        logger.warn(`getMany: type mismatch for id ${item.value.id}`);
      }
    }

    return ok({ value: ret, warnings: result.value.warnings });
  }

  public async replace(
    logger: Logger,
    cas: Cas,
    value: TModel,
  ): Promise<DbResult<{ cas: Cas }>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'replace',
    });
    logger.trace('replace', { cas, value });

    const result = await this.#driver.replace(logger, this.collection, cas, {
      ...value,
      modified: new Date().toISOString(),
    } as TModel);
    return result;
  }
  public async update(
    logger: Logger,
    existing: { cas: Cas; value: TModel },
    updates: TUpdates,
  ): Promise<DbResult<{ cas: Cas; value: TModel }>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'update',
    });
    logger.trace('update', { id: existing, updates });

    const obj = existing.value;
    Object.assign(obj, updates);
    const result = await this.#driver.replace(
      logger,
      this.collection,
      existing.cas,
      obj,
    );

    if (result.isErr()) {
      return result as DbResult<{ cas: Cas; value: TModel }>;
    }

    return ok({
      value: { cas: result.value.value.cas, value: obj },
      warnings: result.value.warnings,
    });
  }
  public async delete(
    logger: Logger,
    existing: { cas: Cas; value: TModel },
  ): Promise<DbResult<{ cas: Cas; value: Deleted<TModel> }>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'delete',
    });
    logger.trace('delete', { existing });

    const obj = existing.value;
    const deleted = Object.assign(obj, {
      type: 'DELETED',
      deleted: new Date().toISOString(),
      oldType: obj.type,
    });
    const result = await this.#driver.replace(
      logger,
      this.collection,
      existing.cas,
      deleted,
    );

    if (result.isErr()) {
      return result as DbResult<{ cas: Cas; value: Deleted<TModel> }>;
    }

    return ok({
      value: { cas: result.value.value.cas, value: deleted as Deleted<TModel> },
      warnings: result.value.warnings,
    });
  }

  public async insert(
    logger: Logger,
    obj: TModel,
    created = new Date().toISOString(),
  ): Promise<DbResult<MutationResult>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'insert',
    });
    logger.trace('insert', { obj: obj.id });

    const result = await this.#driver.insert(logger, this.collection, {
      ...obj,
      created,
      modified: created,
    } as TModel);

    return result;
  }

  public async insertMany(
    logger: Logger,
    objs: TModel[],
  ): Promise<DbResult<PromiseSettledResult<MutationResult>[]>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'insertMany',
    });
    logger.trace('insertMany', { objs: objs.map((o) => o.id) });

    const created = new Date().toISOString();
    const result = await this.#driver.insertMany(
      logger,
      this.collection,
      objs.map((obj) => ({ ...obj, created, modified: created }) as TModel),
    );

    return result;
  }

  public async countFiltered(
    logger: Logger,
    {
      filter,
    }: {
      filter: Filter<
        TModel,
        | TValueIndexes[number]
        | TArrayIndexes[number]
        | 'created'
        | 'modified'
        | 'deleted'
      >;
    },
    _consistent = true,
  ): Promise<DbResult<number>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'count',
    });
    logger.trace('count', { filter });

    const result = await this.#driver.countFiltered(
      logger,
      this.collection,
      this.type,
      filter as unknown as Filter<
        TModel,
        keyof TModel | 'created' | 'modified' | 'deleted'
      >,
    );

    return result;
  }
}

export class MigrationDal<
  TOldModel extends ITypedCouchbaseObject,
  TOldValueIndexes extends Array<Extract<OnlySimple<TOldModel>, string>>,
  TOldArrayIndexes extends Array<Extract<OnlySimpleArray<TOldModel>, string>>,
  TNewModel extends ITypedCouchbaseObject,
  TNewValueIndexes extends Array<Extract<OnlySimple<TNewModel>, string>>,
  TNewArrayIndexes extends Array<Extract<OnlySimpleArray<TNewModel>, string>>,
  TUpdates,
  TCollectionName extends string,
> extends DalBase<
  TNewModel,
  TNewValueIndexes,
  TNewArrayIndexes,
  TUpdates,
  TCollectionName
> {
  readonly #couchbaseConnection: CouchbaseDalConnection;
  readonly #oldDal: DalBase<
    TOldModel,
    TOldValueIndexes,
    TOldArrayIndexes,
    TUpdates,
    TCollectionName
  >;
  readonly #upgrade: (oldData: TOldModel) => TNewModel;
  readonly #findOptionsConverter: (
    newFindOptions: FindOptions<
      TNewModel,
      TNewValueIndexes[number] | TNewArrayIndexes[number]
    >,
  ) => FindOptions<
    TOldModel,
    TOldValueIndexes[number] | TOldArrayIndexes[number]
  >;

  private constructor(
    oldDal: DalBase<
      TOldModel,
      TOldValueIndexes,
      TOldArrayIndexes,
      never,
      TCollectionName
    >,
    newDalParams: {
      db: CouchbaseDalConnection;
      type: TNewModel['type'];
      version: TNewModel['version'];
      valueIndexes: TNewValueIndexes;
      arrayIndexes: TNewArrayIndexes;
      collection: TCollectionName;
      discriminator: (data: unknown) => data is TNewModel;
    },
    upgrade: (oldData: TOldModel) => TNewModel,
    findOptionsConverter: (
      newFindOptions: FindOptions<
        TNewModel,
        TNewValueIndexes[number] | TNewArrayIndexes[number]
      >,
    ) => FindOptions<
      TOldModel,
      TOldValueIndexes[number] | TOldArrayIndexes[number]
    >,
  ) {
    const couchbaseConnection = newDalParams.db;
    super({
      ...newDalParams,
      driver: new CouchbaseDriver(couchbaseConnection),
    });
    this.#couchbaseConnection = couchbaseConnection;
    this.#oldDal = oldDal;
    this.#upgrade = upgrade;
    this.#findOptionsConverter = findOptionsConverter;
  }

  public static async init<
    TOldModel extends ITypedCouchbaseObject,
    TOldValueIndexes extends Array<Extract<OnlySimple<TOldModel>, string>>,
    TOldArrayIndexes extends Array<Extract<OnlySimpleArray<TOldModel>, string>>,
    TNewModel extends ITypedCouchbaseObject,
    TNewValueIndexes extends Array<Extract<OnlySimple<TNewModel>, string>>,
    TNewArrayIndexes extends Array<Extract<OnlySimpleArray<TNewModel>, string>>,
    TUpdates,
    TCollectionName extends string,
  >(
    logger: Logger,
    {
      db,
      type,
      version,
      valueIndexes,
      arrayIndexes,
      collection,
      discriminator,
      oldDal,
      upgrade,
      findOptionsConverter,
      andMigrate,
    }: {
      db: CouchbaseDalConnection;
      type: TNewModel['type'];
      version: TNewModel['version'];
      valueIndexes: TNewValueIndexes;
      arrayIndexes: TNewArrayIndexes;
      collection: TCollectionName;
      discriminator: (data: unknown) => data is TNewModel;
      oldDal: DalBase<
        TOldModel,
        TOldValueIndexes,
        TOldArrayIndexes,
        never,
        TCollectionName
      >;
      upgrade: (oldData: TOldModel) => TNewModel;
      findOptionsConverter: (
        newFindOptions: FindOptions<
          TNewModel,
          TNewValueIndexes[number] | TNewArrayIndexes[number]
        >,
      ) => FindOptions<
        TOldModel,
        TOldValueIndexes[number] | TOldArrayIndexes[number]
      >;
      andMigrate?: 'naive' | 'stream';
    },
  ) {
    await DalBase.init(logger, {
      db,
      type,
      version,
      valueIndexes,
      arrayIndexes,
      collection,
      discriminator,
    });
    const dal = new MigrationDal<
      TOldModel,
      TOldValueIndexes,
      TOldArrayIndexes,
      TNewModel,
      TNewValueIndexes,
      TNewArrayIndexes,
      TUpdates,
      TCollectionName
    >(
      oldDal,
      {
        db,
        type,
        valueIndexes,
        arrayIndexes,
        version,
        collection,
        discriminator,
      },
      upgrade,
      findOptionsConverter,
    );

    switch (andMigrate) {
      case 'naive':
        await dal.naiveMigrate(logger);
        break;
      case 'stream':
        await dal.streamMigrate(logger);
        break;
    }

    return dal;
  }

  public async find(
    logger: Logger,
    options: FindOptions<
      TNewModel,
      TNewValueIndexes[number] | TNewArrayIndexes[number]
    >,
    consistent = true,
  ): Promise<DbResult<TNewModel[]>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'find',
    });
    logger.trace('find', { options, consistent });

    const oldDataResult = await this.#oldDal.find(
      logger,
      this.#findOptionsConverter(options),
      consistent,
    );

    if (oldDataResult.isErr()) {
      return err(oldDataResult.error);
    }

    // update old data
    const updatedData = oldDataResult.value.value.map(this.#upgrade);

    const newDataResult = await super.find(logger, options, consistent);

    if (newDataResult.isErr()) {
      return newDataResult;
    }

    // TODO: reapply sort options
    return ok({
      value: [...updatedData, ...newDataResult.value.value],
      warnings: mergeWarnings(
        oldDataResult.value.warnings,
        newDataResult.value.warnings,
      ),
    });
  }

  public async get(
    logger: Logger,
    id: string,
  ): Promise<DbResult<{ cas: Cas; value: TNewModel } | undefined>> {
    const oldResult = await this.#oldDal.get(logger, id);
    if (oldResult.isErr()) {
      return err(oldResult.error);
    }

    const oldData = oldResult.value.value;
    if (oldData) {
      // update since it's the old model
      const updatedValue = this.#upgrade(oldData.value);
      return ok({
        value: { cas: oldData.cas, value: updatedValue },
        warnings: oldResult.value.warnings,
      });
    }

    const newResult = await super.get(logger, id);
    if (newResult.isErr()) return newResult;

    return ok({
      value: newResult.value.value,
      warnings: mergeWarnings(
        oldResult.value.warnings,
        newResult.value.warnings,
      ),
    });
  }

  public async getMany(
    logger: Logger,
    ids: string[],
  ): Promise<DbResult<{ value: TNewModel; cas: Cas }[]>> {
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'getMany',
    });
    logger.trace('getMany', { ids });

    const oldDataResult = await this.#oldDal.getMany(logger, ids);
    if (oldDataResult.isErr()) {
      return err(oldDataResult.error);
    }

    const updatedData = oldDataResult.value.value.map(({ cas, value }) => ({
      cas,
      value: this.#upgrade(value),
    }));

    const newDataResult = await super.getMany(logger, ids);
    if (newDataResult.isErr()) {
      return newDataResult;
    }

    return ok({
      value: [...updatedData, ...newDataResult.value.value],
      warnings: mergeWarnings(
        oldDataResult.value.warnings,
        newDataResult.value.warnings,
      ),
    });
  }

  public async findOne(
    logger: Logger,
    {
      filter,
    }: Pick<
      FindOptions<
        TNewModel,
        TNewValueIndexes[number] | TNewArrayIndexes[number]
      >,
      'filter'
    >,
    consistent?: boolean,
  ): Promise<DbResult<TNewModel | undefined>> {
    const limit = 1;
    logger = logger.child({
      component: 'dal-connection: service',
      method: 'findOne',
    });
    logger.trace('find', { limit, filter });
    const result = await this.find(logger, { limit, filter }, consistent);
    if (result.isErr()) {
      return err(result.error);
    }
    const [ret] = result.value.value;
    return ok({ value: ret, warnings: result.value.warnings });
  }

  /**
   * A naive migration that will migrate all data from the old dal to the new dal.
   * It is **not** recommended to use this at scale.
   * @param logger
   */
  private async naiveMigrate(logger: Logger): Promise<void> {
    logger.info('Starting naive migration');
    const oldDataResult = await this.#oldDal.find(logger, { limit: undefined });
    if (oldDataResult.isErr()) {
      logger.error('Failed to get old data for migration', oldDataResult.error);
      throw oldDataResult.error;
    }

    const oldData = oldDataResult.value.value;
    logger.info(`Found ${oldData.length} items to migrate`);

    for (const item of oldData) {
      await this.#couchbaseConnection.upsert(
        this.collection,
        this.#upgrade(item),
      );
    }
    logger.info('Finished naive migration');
  }

  private async streamMigrate(logger: Logger): Promise<void> {
    logger.info('Starting stream migration');
    const { query, queryArgs } = this.#oldDal.makeQuery(logger, {
      limit: undefined,
      filter: {},
    });
    const stream = this.#couchbaseConnection.getQueryStream(
      this.collection,
      query,
      queryArgs,
      {
        logger,
      },
    );

    logger.info('Stream migration started');
    stream.on('data', async (item: unknown) => {
      logger.trace('Stream migration data', item);
      await this.#couchbaseConnection.upsert(
        this.collection,
        this.#upgrade(item as TOldModel),
      );
    });
    stream.on('error', (err: unknown) => {
      logger.error('Stream migration error', err);
    });
    stream.on('end', () => {
      logger.info('Stream migration ended');
    });
  }
}
