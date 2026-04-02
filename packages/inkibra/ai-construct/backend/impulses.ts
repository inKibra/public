import type { IValidation } from 'typia/lib';

export type ImpulsePayloadSchema<TPayload extends Record<string, unknown>> = {
  kind: 'impulse-payload-schema';
  validate: (input: unknown) => IValidation<TPayload>;
  jsonSchema: Record<string, unknown>;
};

export function defineImpulsePayload<TPayload extends Record<string, unknown>>(
  schema: ImpulsePayloadSchema<TPayload>,
): ImpulsePayloadSchema<TPayload>;
export function defineImpulsePayload<
  TPayload extends Record<string, unknown>,
>(): ImpulsePayloadSchema<TPayload>;
export function defineImpulsePayload<TPayload extends Record<string, unknown>>(
  schema?: ImpulsePayloadSchema<TPayload>,
): ImpulsePayloadSchema<TPayload> {
  if (schema) {
    return schema;
  }
  throw new Error(
    'defineImpulsePayload<T>() is a compile-time marker. Enable build-pack type-macro + typia transforms.',
  );
}

export type ImpulseToolingConfig<
  TFunctions extends Record<string, unknown> = Record<string, never>,
> = {
  bash?: boolean;
  webSearch?:
    | false
    | {
        provider?: string;
        maxResults?: number;
      };
  codeMode?: {
    functions?: TFunctions;
    deps?: () => unknown | Promise<unknown>;
    sandbox?: {
      timeoutMs?: number;
      memoryMb?: number;
    };
  };
};

export type BuiltinImpulseKey = 'userChat' | 'heartbeat' | 'reminder';

export type BuiltinImpulseOverrides = {
  tools?: ImpulseToolingConfig;
};

export type BuiltinImpulsePayloadMap = {
  userChat: {
    content: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
  };
  heartbeat: {
    dueAt?: string;
    payload?: Record<string, unknown>;
  };
  reminder: {
    reminderId: string;
    message: string;
    dueAt?: string;
    context?: Record<string, unknown>;
  };
};

export type CustomImpulseRoute =
  | {
      kind?: 'systemEvent';
      event?: string;
      profile?: string;
      pool?: string;
    }
  | {
      kind: 'explicitImpulse';
      profile: string;
      event?: string;
      pool?: string;
    };

export type CustomImpulseDefinition<
  TPayload extends Record<string, unknown>,
  TFunctions extends Record<string, unknown> = Record<string, never>,
> = {
  payload: ImpulsePayloadSchema<TPayload>;
  tools?: ImpulseToolingConfig<TFunctions>;
  route?: CustomImpulseRoute;
  description?: string;
};

export type AnyCustomImpulseDefinition<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
  TFunctions extends Record<string, unknown> = Record<string, never>,
> = {
  payload: {
    validate: (input: unknown) => IValidation<TPayload>;
    jsonSchema: Record<string, unknown>;
  };
  tools?: ImpulseToolingConfig<TFunctions>;
  route?: CustomImpulseRoute;
  description?: string;
};

export function defineImpulse<
  TPayload extends Record<string, unknown>,
  TFunctions extends Record<string, unknown> = Record<string, never>,
>(
  definition: CustomImpulseDefinition<TPayload, TFunctions>,
): CustomImpulseDefinition<TPayload, TFunctions> {
  return definition;
}

export type ConstructImpulseRegistry<
  TBuiltins extends Partial<
    Record<BuiltinImpulseKey, BuiltinImpulseOverrides>
  > = Partial<Record<BuiltinImpulseKey, BuiltinImpulseOverrides>>,
  TCustom extends Record<string, AnyCustomImpulseDefinition> = Record<
    string,
    AnyCustomImpulseDefinition
  >,
> = {
  builtins: TBuiltins;
  custom: TCustom;
};

export function defineConstructImpulses<
  TBuiltins extends Partial<Record<BuiltinImpulseKey, BuiltinImpulseOverrides>>,
  TCustom extends Record<string, AnyCustomImpulseDefinition>,
>(registry: {
  builtins?: TBuiltins;
  custom?: TCustom;
}): ConstructImpulseRegistry<TBuiltins, TCustom> {
  return {
    builtins: (registry.builtins ?? {}) as TBuiltins,
    custom: (registry.custom ?? {}) as TCustom,
  };
}

export type CustomImpulsePayload<TDefinition> = TDefinition extends {
  payload: ImpulsePayloadSchema<infer TPayload>;
}
  ? TPayload
  : never;

export type ConstructImpulsePayload<
  TRegistry extends ConstructImpulseRegistry,
  TName extends keyof TRegistry['custom'] | keyof BuiltinImpulsePayloadMap,
> = TName extends keyof BuiltinImpulsePayloadMap
  ? BuiltinImpulsePayloadMap[TName]
  : TName extends keyof TRegistry['custom']
    ? CustomImpulsePayload<TRegistry['custom'][TName]>
    : never;
