/** @jsxImportSource react */

import type { RoutePageProps } from '@inkibra/router';
import { useCallback, useEffect, useState } from 'react';
import { css } from '../../../styled-system/css';
import type { devAppRoutes } from '../route-tree';

type DevIndexPageProps = {
  apiImplementations: RoutePageProps<typeof devAppRoutes>['apiImplementations'];
};

type ConstructEntry = {
  id: string;
  deleting?: boolean;
};

export default function DevIndexPage({
  apiImplementations,
}: DevIndexPageProps) {
  const [constructs, setConstructs] = useState<ConstructEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConstructs = useCallback(async () => {
    try {
      const result = await apiImplementations.listDevConstructs.execute(
        { pathParams: {}, pathQuery: {}, body: {}, files: undefined },
        {},
      );
      if (result.type === 'Ok') {
        setConstructs(
          (result.value.constructs as string[]).map((id) => ({ id })),
        );
      }
    } catch {
      setError('Failed to load constructs');
    } finally {
      setLoading(false);
    }
  }, [apiImplementations]);

  useEffect(() => {
    void fetchConstructs();
  }, [fetchConstructs]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      const trimmed = newId.trim();
      if (trimmed) body.id = trimmed;
      const result = await apiImplementations.createDevConstruct.execute(
        { pathParams: {}, pathQuery: {}, body, files: undefined },
        {},
      );
      if (result.type === 'Ok') {
        setNewId('');
        await fetchConstructs();
      } else {
        setError('Failed to create construct');
      }
    } catch {
      setError('Failed to create construct');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConstructs((prev) =>
      prev.map((c) => (c.id === id ? { ...c, deleting: true } : c)),
    );
    setError(null);
    try {
      const result = await apiImplementations.deleteDevConstruct.execute(
        {
          pathParams: { constructId: id },
          pathQuery: {},
          body: {},
          files: undefined,
        },
        {},
      );
      if (result.type === 'Ok') {
        await fetchConstructs();
      } else {
        setError(`Failed to delete ${id}`);
        setConstructs((prev) =>
          prev.map((c) => (c.id === id ? { ...c, deleting: false } : c)),
        );
      }
    } catch {
      setError(`Failed to delete ${id}`);
      setConstructs((prev) =>
        prev.map((c) => (c.id === id ? { ...c, deleting: false } : c)),
      );
    }
  };

  return (
    <div
      className={css({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '32px',
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      })}
    >
      <div className={css({ width: '100%', maxWidth: '520px' })}>
        {/* Header */}
        <h1
          className={css({
            margin: '0 0 4px 0',
            fontSize: '22px',
            fontWeight: 700,
            color: 'aic.text',
            letterSpacing: '-0.02em',
          })}
        >
          Constructs
        </h1>
        <p
          className={css({
            margin: '0 0 24px 0',
            fontSize: '13px',
            color: 'aic.textSubtle',
          })}
        >
          ai-construct dev server
        </p>

        {/* Create form */}
        <div
          className={css({
            display: 'flex',
            gap: '8px',
            marginBottom: '20px',
          })}
        >
          <input
            type="text"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !creating) void handleCreate();
            }}
            placeholder="construct id (optional)"
            className={css({
              flex: 1,
              padding: '9px 12px',
              borderRadius: '8px',
              border: '1px solid token(colors.aic.border)',
              bg: 'rgba(255,255,255,0.04)',
              color: 'aic.text',
              fontSize: '13px',
              outline: 'none',
              fontFamily: 'monospace',
            })}
          />
          <button
            type="button"
            disabled={creating}
            onClick={handleCreate}
            className={css({
              padding: '9px 18px',
              borderRadius: '8px',
              border: 'none',
              bg: 'aic.accent',
              color: '#0a0a0a',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              opacity: creating ? 0.6 : 1,
            })}
          >
            {creating ? 'Creating...' : 'New Construct'}
          </button>
        </div>

        {/* Error */}
        {error ? (
          <div
            className={css({
              padding: '8px 12px',
              marginBottom: '16px',
              borderRadius: '8px',
              bg: 'rgba(248,113,113,0.12)',
              border: '1px solid rgba(248,113,113,0.3)',
              color: 'aic.error',
              fontSize: '12px',
            })}
          >
            {error}
          </div>
        ) : null}

        {/* List */}
        <div
          className={css({
            border: '1px solid token(colors.aic.border)',
            borderRadius: '10px',
            bg: 'aic.panel',
            overflow: 'hidden',
          })}
        >
          {loading ? (
            <div
              className={css({
                padding: '24px',
                textAlign: 'center',
                color: 'aic.textSubtle',
                fontSize: '13px',
              })}
            >
              Loading...
            </div>
          ) : constructs.length === 0 ? (
            <div
              className={css({
                padding: '24px',
                textAlign: 'center',
                color: 'aic.textSubtle',
                fontSize: '13px',
              })}
            >
              No constructs yet. Create one to get started.
            </div>
          ) : (
            constructs.map((c, i) => (
              <div
                key={c.id}
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  borderTop:
                    i > 0 ? '1px solid token(colors.aic.border)' : undefined,
                  opacity: c.deleting ? 0.5 : 1,
                  transition: 'opacity 150ms ease',
                })}
              >
                {/* Status dot */}
                <span
                  className={css({
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    bg: 'aic.success',
                    flexShrink: 0,
                  })}
                />

                {/* Name + link */}
                <a
                  href={`/constructs/${encodeURIComponent(c.id)}/lab`}
                  className={css({
                    flex: 1,
                    color: 'aic.text',
                    textDecoration: 'none',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    fontWeight: 500,
                  })}
                >
                  {c.id}
                </a>

                {/* Open lab button */}
                <a
                  href={`/constructs/${encodeURIComponent(c.id)}/lab`}
                  className={css({
                    padding: '5px 12px',
                    borderRadius: '6px',
                    border: '1px solid token(colors.aic.border)',
                    bg: 'transparent',
                    color: 'aic.accent',
                    fontSize: '11px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  })}
                >
                  Open Lab
                </a>

                {/* Delete button */}
                <button
                  type="button"
                  disabled={c.deleting}
                  onClick={() => handleDelete(c.id)}
                  className={css({
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid rgba(248,113,113,0.25)',
                    bg: 'transparent',
                    color: 'aic.error',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: c.deleting ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                  })}
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
