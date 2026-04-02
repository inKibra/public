# Constraint Language and Derived Edge Relations

## Overview

This document proposes a declarative constraint system for
`@inkibra/dal-connection` that fits Inkibra's existing wide-table,
collection/partition model.

The goal is to express integrity rules once and compile them to the strongest
database-level enforcement available, without forcing the application model to
fully normalize into classic join tables.

The most important idea is:

- scalar references can compile to native DB constraints such as `FOREIGN KEY`
  and `UNIQUE`
- array references can compile to generated **derived edge relations** kept in
  sync by triggers, with constraints attached to the generated edges

The application-facing model stays wide-table and document-oriented. The
database gets extra generated structure only where integrity requires it.

Postgres is the primary target. A future runtime fallback may exist for other
backends, but this spec is intentionally Postgres-first.

---

## Goals

1. Preserve the current collection/partition/wide-table model.
2. Make common integrity rules declarative.
3. Prefer DB-native enforcement over application/runtime checks.
4. Support same-collection references, cross-collection references, and array
   references.
5. Reuse existing generated-column strategy (`val_*`, `part_*`) instead of
   introducing a second indexing model.
6. Avoid forcing developers to hand-write triggers for routine array-reference
   relationships.

## Non-goals

1. Full backend portability in v1.
2. Arbitrary authorization policy compilation into DB constraints.
3. Replacing the existing DAL APIs.
4. Replacing application-level business invariants that depend on request
   context or external systems.

---

## Constraint categories

The first pass should support four declarative constraint kinds:

1. `unique`
2. `check`
3. `exists`
4. `derivedEdges`

`derivedEdges` is the array-reference bridge. It lets a document row keep an
array field while the database internally materializes scalar edge rows for
integrity and indexing.

---

## Design principles

### 1. Fields used by constraints should already be surfaced

If a field matters for indexing or integrity, it should already be available as:

- a base column (`id`, `type`, `created`, `deleted`, etc.), or
- a generated column (`val_email`, `part_workspace`, etc.)

This avoids magical constraint compilation over arbitrary JSON paths with no DB
projection.

### 2. Declarative first, backend second

Developers describe the rule they want. The DAL decides whether to emit:

- native `UNIQUE`
- native `CHECK`
- native `FOREIGN KEY`
- deferred constraint trigger
- generated derived-edge relation plus constraints on that relation

### 3. Scalar references and array references are different

Scalar references map naturally onto FKs.

Array references do not.

Rather than pretending arrays are scalar references, the DAL should generate a
derived edge representation when it needs relational enforcement.

---

## Proposed API shape

The exact final API can vary, but the target shape should be close to this:

```typescript
defineCollection({
  name: 'tempo',
  dals: [workoutDal, workoutSessionDal, workoutAdminEdgeDal],
  constraints: [
    unique({
      name: 'workout_slug_unique_per_workspace',
      where: { type: 'WORKOUT' },
      scope: ['workspaceId'],
      fields: ['slug'],
      ignoreSoftDeleted: true,
    }),

    exists({
      name: 'workout_session_parent_exists',
      from: { type: 'WORKOUT_SESSION', field: 'parentWorkoutId' },
      to: { collection: 'tempo', type: 'WORKOUT', field: 'id' },
      deferrable: true,
    }),

    check({
      name: 'workout_duration_positive',
      where: { type: 'WORKOUT' },
      expr: gt(field('durationMinutes'), literal(0)),
    }),
  ],
  derivedEdges: [
    derivedEdges({
      name: 'workout_admins',
      from: {
        type: 'WORKOUT',
        field: 'adminUserIds',
      },
      edge: {
        type: 'WORKOUT_ADMIN_EDGE',
        sourceIdField: 'workoutId',
        targetIdField: 'adminUserId',
        partition: 'workoutId',
        preserveOrder: false,
      },
      to: {
        collection: 'auth',
        type: 'AUTHORIZED_USER',
        field: 'id',
      },
      constraints: {
        targetExists: true,
        uniquePerSource: true,
      },
    }),
  ],
});
```

---

## Scalar constraints

### `unique(...)`

Represents scoped uniqueness.

Example:

```typescript
unique({
  name: 'authorized_user_email_unique_per_workspace',
  where: { type: 'AUTHORIZED_USER' },
  scope: ['workspaceId'],
  fields: ['email'],
  ignoreSoftDeleted: true,
});
```

Compiles to something like:

```sql
CREATE UNIQUE INDEX tempo_authorized_user_email_unique_per_workspace
ON tempo (val_workspaceid, val_email)
WHERE type = 'AUTHORIZED_USER' AND deleted IS NULL;
```

### `check(...)`

Represents row-local predicates over generated/base columns.

Example:

```typescript
check({
  name: 'workout_duration_positive',
  where: { type: 'WORKOUT' },
  expr: gt(field('durationMinutes'), literal(0)),
});
```

Compiles to a native `CHECK` when expression lowering is possible.

### `exists(...)`

Represents scalar references.

Examples:

```typescript
exists({
  name: 'trainer_owner_exists',
  from: { type: 'TRAINER', field: 'ownerId' },
  to: { collection: 'auth', type: 'AUTHORIZED_USER', field: 'id' },
  deferrable: true,
});
```

```typescript
exists({
  name: 'session_parent_workout_exists',
  from: { type: 'WORKOUT_SESSION', field: 'parentWorkoutId' },
  to: { collection: 'tempo', type: 'WORKOUT', field: 'id' },
  deferrable: true,
});
```

Possible DB lowerings:

1. plain FK if existence is enough
2. composite FK when target `type` must also match
3. deferred constraint trigger if schema shape cannot express the relation as an
   FK cleanly

Example composite FK strategy:

```sql
ALTER TABLE tempo
ADD CONSTRAINT tempo_id_type_unique UNIQUE (id, type);

ALTER TABLE tempo
ADD CONSTRAINT workout_session_parent_workout_fk
FOREIGN KEY (val_parentworkoutid, const_parent_type)
REFERENCES tempo(id, type)
DEFERRABLE INITIALLY DEFERRED;
```

---

## Derived edge relations

### Why they exist

Arrays of references are a natural fit for the current document model, but they
do not map naturally to native foreign keys.

Examples:

- `WORKOUT.adminUserIds: string[]`
- `WORKOUT.exerciseIds: string[]`
- `ENTITY.memberIds: string[]`

Rather than forcing the source model to normalize completely, the DAL should be
able to generate internal edge rows that represent each array element as a
scalar relation.

### Core idea

For a source row:

```typescript
type Workout = {
  id: string;
  type: 'WORKOUT';
  adminUserIds: string[];
};
```

the DAL generates internal rows like:

```typescript
type WorkoutAdminEdge = {
  id: string;
  type: 'WORKOUT_ADMIN_EDGE';
  workoutId: string;
  adminUserId: string;
  position?: number;
  created: string;
  modified: string;
};
```

The application still treats `adminUserIds` as canonical. The generated edge
rows exist to support integrity, indexing, and reverse lookups.

### Edge row lifecycle

For each `derivedEdges(...)` declaration, the DAL generates trigger logic that:

1. watches inserts/updates/deletes on the source type
2. computes the desired edge set from the source array field
3. deletes stale generated edges
4. inserts missing generated edges
5. optionally preserves order using a `position` column

This trigger runs in the same transaction as the source write.

### Example declaration

```typescript
derivedEdges({
  name: 'workout_admins',
  from: {
    type: 'WORKOUT',
    field: 'adminUserIds',
  },
  edge: {
    type: 'WORKOUT_ADMIN_EDGE',
    sourceIdField: 'workoutId',
    targetIdField: 'adminUserId',
    partition: 'workoutId',
    preserveOrder: false,
  },
  to: {
    collection: 'auth',
    type: 'AUTHORIZED_USER',
    field: 'id',
  },
  constraints: {
    targetExists: true,
    uniquePerSource: true,
  },
});
```

### Generated SQL shape

Conceptually, the DAL emits:

1. support for edge rows within the collection schema
2. source-side sync trigger
3. constraints on generated edge rows

Sync trigger sketch:

```sql
CREATE OR REPLACE FUNCTION sync_workout_admin_edges()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM tempo
    WHERE type = 'WORKOUT_ADMIN_EDGE'
      AND val_workoutid = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.type <> 'WORKOUT' THEN
    RETURN NEW;
  END IF;

  DELETE FROM tempo
  WHERE type = 'WORKOUT_ADMIN_EDGE'
    AND val_workoutid = NEW.id;

  INSERT INTO tempo (id, type, created, modified, data)
  SELECT
    new_edge_id(NEW.id, elem.value),
    'WORKOUT_ADMIN_EDGE',
    NEW.modified,
    NEW.modified,
    jsonb_build_object(
      'workoutId', NEW.id,
      'adminUserId', elem.value
    )
  FROM jsonb_array_elements_text(NEW.data->'adminUserIds') AS elem(value);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

The edge DAL can then reuse the existing generated-column/index machinery.

### Constraints on generated edges

Once the edge rows exist, constraints become scalar again.

Example:

- `targetExists: true` can compile to FK or composite FK from edge target field
  to the target collection
- `uniquePerSource: true` can compile to unique index on
  `(type, val_workoutid, val_adminuserid)`

This is the main benefit of the approach: arrays get converted into a form that
native relational constraints can understand.

---

## FK vs trigger vs derived edges

### Use FK / composite FK when:

- the source reference is scalar
- the target collection/type is fixed
- the relation can be expressed as column tuples

Examples:

- `TRAINER.ownerId -> AUTHORIZED_USER.id`
- `WORKOUT_SESSION.parentWorkoutId -> WORKOUT.id`

### Use derived edges when:

- the source is an array of refs
- scalar edge rows would make constraints easier
- the application should keep the array shape as the canonical API

Examples:

- `WORKOUT.adminUserIds[*] -> AUTHORIZED_USER.id`
- `WORKOUT.exerciseIds[*] -> EXERCISE.id`

### Use deferred constraint trigger directly when:

- the relation is awkward for FKs
- generating edges would be overkill
- the invariant is same-collection and better expressed procedurally

Example:

- `WORKOUT.parentId` must reference a row of a specific type, but schema shape
  does not support a clean composite FK

---

## Soft delete behavior

This spec only treats **existence** as the first-class DB-level guarantee.

If a target row is soft-deleted but still physically exists, a normal FK still
passes.

That means:

- FK / derived-edge constraints can guarantee the referenced row exists
- “referenced row must not be deleted” remains a separate concern

Future options:

1. query defaults that ignore soft-deleted rows
2. additional trigger-backed constraints for active/non-deleted references
3. explicit `onTargetSoftDelete` policy on constraints

Out of scope for v1: full soft-delete policy compilation.

---

## Constraint compiler strategy

The DAL should compile declarative constraints through an intermediate
representation.

### Constraint IR

Conceptually:

```typescript
type ConstraintIR =
  | {
      kind: 'unique';
      name: string;
      collection: string;
      where?: ConstraintWhere;
      scope: string[];
      fields: string[];
      ignoreSoftDeleted?: boolean;
    }
  | {
      kind: 'check';
      name: string;
      collection: string;
      where?: ConstraintWhere;
      expr: Expr;
    }
  | {
      kind: 'exists';
      name: string;
      from: RefDescriptor;
      to: RefDescriptor;
      deferrable?: boolean;
    }
  | {
      kind: 'derivedEdges';
      name: string;
      from: ArrayRefDescriptor;
      edge: EdgeDescriptor;
      to: RefDescriptor;
      constraints: DerivedEdgeConstraintConfig;
    };
```

### Lowering priority

1. Native index/constraint
2. Native deferred constraint trigger
3. Generated derived-edge relation with native constraints on the generated rows
4. Runtime fallback (future, non-goal for v1)

For v1, the compiler should prefer DB-only backends and fail fast if a declared
constraint cannot be lowered safely.

---

## Example cases

### Case 1: email unique per workspace

```typescript
unique({
  name: 'auth_email_unique_per_workspace',
  where: { type: 'AUTHORIZED_USER' },
  scope: ['workspaceId'],
  fields: ['email'],
  ignoreSoftDeleted: true,
});
```

Expected lowering: partial unique index.

### Case 2: trainer owner must exist in auth

```typescript
exists({
  name: 'trainer_owner_exists',
  from: { type: 'TRAINER', field: 'ownerId' },
  to: { collection: 'auth', type: 'AUTHORIZED_USER', field: 'id' },
  deferrable: true,
});
```

Expected lowering: FK or composite FK.

### Case 3: workout session must have a parent workout

```typescript
exists({
  name: 'workout_session_parent_exists',
  from: { type: 'WORKOUT_SESSION', field: 'parentWorkoutId' },
  to: { collection: 'tempo', type: 'WORKOUT', field: 'id' },
  deferrable: true,
});
```

Expected lowering: composite self-FK if cleanly expressible; deferred trigger
otherwise.

### Case 4: all admin users on a workout must exist

```typescript
derivedEdges({
  name: 'workout_admins',
  from: { type: 'WORKOUT', field: 'adminUserIds' },
  edge: {
    type: 'WORKOUT_ADMIN_EDGE',
    sourceIdField: 'workoutId',
    targetIdField: 'adminUserId',
    partition: 'workoutId',
  },
  to: { collection: 'auth', type: 'AUTHORIZED_USER', field: 'id' },
  constraints: {
    targetExists: true,
    uniquePerSource: true,
  },
});
```

Expected lowering: generated edge rows + sync trigger + FK on generated edges.

### Case 5: all exercises in a workout must exist

```typescript
derivedEdges({
  name: 'workout_exercises',
  from: { type: 'WORKOUT', field: 'exerciseIds' },
  edge: {
    type: 'WORKOUT_EXERCISE_EDGE',
    sourceIdField: 'workoutId',
    targetIdField: 'exerciseId',
    partition: 'workoutId',
    preserveOrder: true,
  },
  to: { collection: 'library', type: 'EXERCISE', field: 'id' },
  constraints: {
    targetExists: true,
    uniquePerSource: true,
    preserveOrder: true,
  },
});
```

Expected lowering: generated edge rows + order-preserving sync trigger + FK.

---

## Implementation plan

### Phase 1: declarative metadata + native simple constraints

1. Add collection-level `constraints` metadata
2. Implement `unique(...)`
3. Implement `check(...)` for row-local expressions
4. Implement scalar `exists(...)` lowering to FK / composite FK when possible

### Phase 2: derived edges

1. Add `derivedEdges(...)` declaration
2. Generate edge DAL metadata within the same collection
3. Generate source sync triggers
4. Generate constraints on generated edges
5. Add tests for insert/update/delete consistency

### Phase 3: advanced policies

1. Soft-delete-aware relationship policies
2. Better typed self-reference compilation
3. Backend capability reporting / runtime fallback

---

## Testing strategy

Primary testing should use PGlite/Postgres behavior, since this spec is
Postgres-first.

Required tests:

1. scalar FK violation surfaces on commit for deferred constraints
2. composite FK enforces target type
3. generated edge rows sync correctly on insert/update/delete
4. generated edge FKs reject missing targets
5. generated edge uniqueness rejects duplicate refs
6. edge ordering is preserved when enabled
7. soft-deleted targets still satisfy plain existence constraints (documented
   behavior)

---

## Open questions

1. Should generated edge rows be fully internal, or queryable/debuggable through
   DAL APIs?
2. Should edge-row IDs be deterministic (`sourceId + targetId`) or opaque?
3. Should `derivedEdges(...)` support extra per-edge metadata in v1, or only
   source/target/position?
4. How aggressively should same-collection typed refs prefer composite FK over
   deferred trigger?
5. Should soft-delete-aware existence become part of the v1 DSL, or remain a
   later extension?

## Recommended v1 decisions

1. Generated edge rows are internal but inspectable in tests.
2. Edge IDs are deterministic when `preserveOrder = false`; include `position`
   when order matters.
3. `derivedEdges(...)` supports only source ID, target ID, and optional
   `position` in v1.
4. Prefer composite FK over deferred trigger when the schema can express it
   cleanly.
5. Keep soft-delete-aware existence out of v1.
