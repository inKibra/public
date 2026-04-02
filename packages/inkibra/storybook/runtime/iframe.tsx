/**
 * @inkibra/storybook - Iframe Runtime
 *
 * Renders a single story variant inside an iframe for CSS isolation.
 * Communicates with parent chrome via postMessage.
 */

import { importModuleByFileId, manifest } from 'virtual:storybook';
import { Agentation } from 'agentation';
import {
  type ReactNode,
  StrictMode,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type {
  StoryProps,
  StoryRecord,
  StoryRuntimeMode,
  StoryVariant,
} from '../types';
import {
  postToParent,
  SB_CONTROLS_HOST_ID,
  SB_EVENT_ERROR,
  SB_EVENT_OUTPUT,
  SB_EVENT_READY,
} from './messages';

// ============================================================================
// Story Lookup
// ============================================================================

/**
 * Find a story record by ID.
 */
function findStoryRecord(storyId: string): StoryRecord | undefined {
  return manifest.find((record: StoryRecord) => record.id === storyId);
}

/**
 * Import and extract a story variant from a module.
 */
async function loadStoryVariant(
  record: StoryRecord,
): Promise<StoryVariant | null> {
  const importFn = importModuleByFileId[record.fileId];
  if (!importFn) {
    throw new Error(`No import function for fileId: ${record.fileId}`);
  }

  const mod = await importFn();
  if (typeof mod !== 'object' || mod === null) {
    throw new Error(`Module for ${record.fileId} is not an object`);
  }

  let variant = (mod as Record<string, unknown>)[record.exportName];

  // Some bundled module wrappers expose export getters before lazy init settles.
  // A second access after re-invoking the importer resolves those cases.
  if (variant === undefined) {
    const retryMod = await importFn();
    variant = (retryMod as Record<string, unknown>)[record.exportName];
  }

  if (!isStoryVariant(variant)) {
    const details =
      typeof variant === 'object' && variant !== null
        ? `keys=${Object.keys(variant as Record<string, unknown>).join(',')}; storyType=${typeof (variant as Record<string, unknown>).Story}`
        : `type=${typeof variant}`;
    throw new Error(
      `Export "${record.exportName}" is not a valid StoryVariant (${details})`,
    );
  }

  return variant;
}

/**
 * Basic validation that something looks like a StoryVariant.
 */
function isStoryVariant(value: unknown): value is StoryVariant {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.Story === 'function';
}

// ============================================================================
// Story Renderer Component
// ============================================================================

type StoryRendererProps = {
  storyId: string;
  sessionId?: string;
  controlsEnabled: boolean;
  runtimeMode: StoryRuntimeMode;
};

function StoryRenderer({
  storyId,
  sessionId,
  controlsEnabled,
  runtimeMode,
}: StoryRendererProps) {
  const [content, setContent] = useState<ReactNode>(null);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);
  const [inputPanel, setInputPanel] = useState<ReactNode>(null);
  const [controlsHost, setControlsHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!controlsEnabled || window.parent === window) {
      setControlsHost(null);
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let attempts = 0;

    const resolveHost = () => {
      if (cancelled) return;

      try {
        const host = window.parent.document.getElementById(SB_CONTROLS_HOST_ID);
        if (host instanceof HTMLElement) {
          setControlsHost(host);
          return;
        }
      } catch {
        // Ignore cross-window access issues; controls just won't be available.
      }

      attempts += 1;
      if (attempts > 180) return;

      rafId = window.requestAnimationFrame(resolveHost);
    };

    resolveHost();

    return () => {
      cancelled = true;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      setControlsHost(null);
    };
  }, [controlsEnabled, storyId]);

  const handleOutput = useCallback(
    (data: unknown) => {
      const timestamp = Date.now();
      window.dispatchEvent(
        new CustomEvent(SB_EVENT_OUTPUT, {
          detail: { storyId, data, timestamp, mode: runtimeMode },
        }),
      );

      postToParent({
        type: 'SB_OUTPUT',
        storyId,
        data,
        timestamp,
        sessionId,
      });
    },
    [storyId, sessionId, runtimeMode],
  );

  const handleRegisterInput = useCallback(
    (panel: ReactNode) => {
      setInputPanel(panel ?? null);
      postToParent({
        type: 'SB_REGISTER_INPUT',
        storyId,
        hasPanel: panel !== null && panel !== undefined,
        sessionId,
      });
    },
    [storyId, sessionId],
  );

  useEffect(() => {
    let cancelled = false;

    setReady(false);
    setError(null);
    setContent(null);
    setInputPanel(null);
    postToParent({
      type: 'SB_REGISTER_INPUT',
      storyId,
      hasPanel: false,
      sessionId,
    });

    async function load() {
      try {
        const record = findStoryRecord(storyId);
        if (!record) {
          throw new Error(`Story not found: ${storyId}`);
        }

        const variant = await loadStoryVariant(record);
        if (!variant) {
          throw new Error(`Failed to load story variant: ${storyId}`);
        }

        if (cancelled) return;

        const storyProps: StoryProps = {
          onOutput: handleOutput,
          onRegisterInput: handleRegisterInput,
          runtime: { mode: runtimeMode },
        };

        setContent(variant.Story(storyProps));
        setError(null);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setContent(null);

        postToParent({
          type: 'SB_ERROR',
          storyId,
          message: e.message,
          stack: e.stack,
          sessionId,
        });
        window.dispatchEvent(
          new CustomEvent(SB_EVENT_ERROR, {
            detail: {
              storyId,
              message: e.message,
              stack: e.stack,
              mode: runtimeMode,
            },
          }),
        );
      }
    }

    load();

    return () => {
      cancelled = true;
      postToParent({
        type: 'SB_REGISTER_INPUT',
        storyId,
        hasPanel: false,
        sessionId,
      });
    };
  }, [storyId, sessionId, runtimeMode, handleOutput, handleRegisterInput]);

  // Post ready signal and set attribute once ready
  useEffect(() => {
    if (ready) {
      const root = document.querySelector('[data-storybook-root]');
      if (root) {
        root.setAttribute('data-storybook-ready', 'true');
        root.setAttribute('data-storybook-mode', runtimeMode);
      }
      postToParent({ type: 'SB_READY', storyId, sessionId });
      window.dispatchEvent(
        new CustomEvent(SB_EVENT_READY, {
          detail: { storyId, mode: runtimeMode },
        }),
      );
    }
  }, [ready, storyId, sessionId, runtimeMode]);

  const controlsPortal =
    controlsEnabled && inputPanel && controlsHost
      ? createPortal(inputPanel, controlsHost)
      : null;

  if (error) {
    return (
      <div
        style={{
          padding: 24,
          color: '#dc2626',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
        }}
      >
        <h2 style={{ margin: '0 0 16px 0' }}>Error loading story</h2>
        <p style={{ margin: 0 }}>{error.message}</p>
        {error.stack && (
          <pre
            style={{
              marginTop: 16,
              fontSize: 12,
              overflow: 'auto',
              background: '#fef2f2',
              padding: 12,
              borderRadius: 4,
            }}
          >
            {error.stack}
          </pre>
        )}
      </div>
    );
  }

  return (
    <>
      {content}
      {controlsPortal}
    </>
  );
}

// ============================================================================
// No Story Selected View
// ============================================================================

function NoStorySelected() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        color: '#6b7280',
        fontFamily: 'sans-serif',
      }}
    >
      <p>No story selected</p>
    </div>
  );
}

// ============================================================================
// Mount
// ============================================================================

function getStoryIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('story');
}

function getSessionIdFromUrl(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  return params.get('sb_session') ?? undefined;
}

function getRuntimeModeFromUrl(): StoryRuntimeMode {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('sb_mode');
  if (mode === 'test' || mode === 'vrt') {
    return mode;
  }
  return 'dev';
}

function areControlsEnabledFromUrl(runtimeMode: StoryRuntimeMode): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('sb_controls') === '0') return false;
  if (runtimeMode !== 'dev') return false;
  return true;
}

function IframeApp() {
  const storyId = getStoryIdFromUrl();
  const sessionId = getSessionIdFromUrl();
  const runtimeMode = getRuntimeModeFromUrl();
  const controlsEnabled = areControlsEnabledFromUrl(runtimeMode);

  if (!storyId) {
    return (
      <>
        <NoStorySelected />
        <Agentation />
      </>
    );
  }

  return (
    <>
      <StoryRenderer
        storyId={storyId}
        sessionId={sessionId}
        controlsEnabled={controlsEnabled}
        runtimeMode={runtimeMode}
      />
      <Agentation />
    </>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <IframeApp />
    </StrictMode>,
  );
}
