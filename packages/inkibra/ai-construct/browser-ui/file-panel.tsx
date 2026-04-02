import type { ChangeEvent } from 'react';
import { createElement, useEffect, useRef, useState } from 'react';

import type { ConstructStudioContextFile } from '../lab/types';
import { css, cx } from '../styled-system/css';
import {
  chipAccentClass,
  chipClass,
  panelClass,
  panelHeaderClass,
  panelTitleClass,
  scrollBodyClass,
} from './styles';

export type ConstructFilePanelBodyProps = {
  file: ConstructStudioContextFile;
  /** When true, remove the read-only banner (edit mode is active). */
  editModeActive?: boolean;
  /** Refresh the file content. */
  onRefresh?: () => void;
  /**
   * Called when the user saves the file in the inline editor.
   * Only available when editModeActive is true.
   */
  onSave?: (path: string, content: string) => void;
};

export type ConstructFilePanelProps = ConstructFilePanelBodyProps & {
  focused?: boolean;
  onClose?: () => void;
};

/**
 * The scrollable body of a file panel — reusable inside the tabbed center workspace.
 */
export function ConstructFilePanelBody(props: ConstructFilePanelBodyProps) {
  const { file } = props;
  const { pinnedSource, pinnedScope } = file;
  const hasFrontmatter = Object.keys(file.frontmatter).length > 0;

  // Inline editor state (only used when editModeActive)
  const [draft, setDraft] = useState<string>(file.content ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const prevPathRef = useRef(file.path);

  // Reset draft when file path changes (different file opened)
  useEffect(() => {
    if (file.path !== prevPathRef.current) {
      prevPathRef.current = file.path;
      setDraft(file.content ?? '');
      setSavedAt(null);
    }
  }, [file.path, file.content]);

  // When the file content updates externally (e.g. after a save flush), sync if not dirty
  const isDirty = draft !== (file.content ?? '');

  function handleSave() {
    if (!props.onSave || saving) return;
    setSaving(true);
    props.onSave(file.path, draft);
    setSaving(false);
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <div
      className={cx(
        scrollBodyClass,
        css({
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }),
      )}
    >
      {/* Read-only banner */}
      {!props.editModeActive ? (
        <div
          className={css({
            padding: '5px 14px',
            bg: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid token(colors.aic.border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
          })}
        >
          <span
            className={css({
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'aic.textSubtle',
            })}
          >
            Read-only
          </span>
          <span className={css({ fontSize: '11px', color: 'aic.textSubtle' })}>
            — enable edit mode to modify
          </span>
        </div>
      ) : null}

      {/* File meta row */}
      <div
        className={css({
          padding: '7px 14px',
          borderBottom: '1px solid token(colors.aic.border)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexShrink: 0,
          flexWrap: 'wrap',
        })}
      >
        {props.onRefresh && (
          <button
            type="button"
            onClick={props.onRefresh}
            className={css({
              padding: '2px 6px',
              border: '1px solid token(colors.aic.border)',
              borderRadius: '4px',
              bg: 'transparent',
              color: 'aic.textMuted',
              fontSize: '11px',
              cursor: 'pointer',
            })}
            title="Refresh file content"
          >
            ↻
          </button>
        )}
        <span
          className={css({
            fontSize: '11px',
            fontFamily: 'monospace',
            color: 'aic.textMuted',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          })}
        >
          {file.path}
        </span>
        <span className={chipClass}>{file.sizeBytes}b</span>
        {pinnedSource === 'system' ? (
          <>
            <span
              className={cx(
                chipClass,
                css({
                  borderColor: '#b45309',
                  color: '#f59e0b',
                  bg: 'rgba(245,158,11,0.08)',
                }),
              )}
            >
              sys
            </span>
            {pinnedScope ? (
              <span className={chipClass}>{pinnedScope}</span>
            ) : null}
          </>
        ) : pinnedSource === 'ai' ? (
          <span className={cx(chipClass, chipAccentClass)}>ai pin</span>
        ) : null}
      </div>

      {/* File content / inline editor */}
      {props.editModeActive && props.onSave ? (
        <>
          {/* Editor toolbar */}
          <div
            className={css({
              padding: '5px 14px',
              borderBottom: '1px solid token(colors.aic.border)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexShrink: 0,
            })}
          >
            <span
              className={css({
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: isDirty ? 'aic.accent' : 'aic.textSubtle',
                flex: 1,
              })}
            >
              {isDirty ? 'Modified' : savedAt ? `Saved ${savedAt}` : 'Editor'}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              className={css({
                padding: '2px 10px',
                borderRadius: '4px',
                border: isDirty
                  ? '1px solid token(colors.aic.accentStrong)'
                  : '1px solid token(colors.aic.border)',
                bg: isDirty ? 'aic.accentSoft' : 'transparent',
                color: isDirty ? 'aic.accent' : 'aic.textMuted',
                cursor: isDirty ? 'pointer' : 'default',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                opacity: saving ? 0.5 : 1,
              })}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {/* Textarea editor */}
          <div
            className={css({
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            })}
          >
            {createElement('textarea', {
              value: draft,
              onChange: (e: ChangeEvent<HTMLTextAreaElement>) =>
                setDraft(e.target.value),
              spellCheck: false,
              className: css({
                flex: 1,
                margin: 0,
                padding: '12px 14px',
                fontSize: '12px',
                lineHeight: 1.65,
                fontFamily: 'monospace',
                color: 'aic.text',
                bg: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                width: '100%',
                boxSizing: 'border-box',
                userSelect: 'text',
                cursor: 'text',
              }),
            })}
          </div>
        </>
      ) : (
        <div
          className={css({
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          })}
        >
          {hasFrontmatter && (
            <details
              open
              className={css({
                borderBottom: '1px solid token(colors.aic.border)',
                padding: '8px 14px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'aic.textSubtle',
                userSelect: 'text',
                cursor: 'default',
              })}
            >
              <summary
                className={css({
                  fontSize: '10px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'aic.textSubtle',
                  cursor: 'pointer',
                  marginBottom: '4px',
                })}
              >
                frontmatter
              </summary>
              <pre
                className={css({
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.5,
                })}
              >
                {formatFrontmatter(file.frontmatter)}
              </pre>
            </details>
          )}
          {file.content ? (
            <pre
              className={css({
                margin: 0,
                padding: '12px 14px',
                fontSize: '12px',
                lineHeight: 1.65,
                fontFamily: 'monospace',
                color: 'aic.text',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                userSelect: 'text',
                cursor: 'text',
              })}
            >
              {file.content}
            </pre>
          ) : (
            <div
              className={css({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '120px',
                color: 'aic.textSubtle',
                fontSize: '13px',
                fontStyle: 'italic',
              })}
            >
              {hasFrontmatter ? 'No body content.' : 'Empty file.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Standalone file panel — panel shell + header + body.
 * Use ConstructFilePanelBody directly when embedding inside another panel.
 */
export function ConstructFilePanel(props: ConstructFilePanelProps) {
  const { file } = props;
  const filename =
    file.title || file.path.split('/').filter(Boolean).pop() || file.path;

  return (
    <section
      className={cx(
        panelClass,
        css({
          minHeight: 0,
          borderColor: props.focused ? 'aic.accent' : 'aic.border',
        }),
      )}
    >
      <header className={panelHeaderClass}>
        <h3 className={panelTitleClass}>{filename}</h3>
        <div
          className={css({ display: 'flex', alignItems: 'center', gap: '6px' })}
        >
          {props.editModeActive ? (
            <span className={cx(chipClass, chipAccentClass)}>edit mode</span>
          ) : null}
          {props.onClose ? (
            <button
              type="button"
              onClick={props.onClose}
              className={css({
                width: '20px',
                height: '20px',
                borderRadius: '4px',
                border: '1px solid token(colors.aic.border)',
                bg: 'transparent',
                color: 'aic.textMuted',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                flexShrink: 0,
              })}
            >
              ×
            </button>
          ) : null}
        </div>
      </header>
      <ConstructFilePanelBody
        file={file}
        editModeActive={props.editModeActive}
      />
    </section>
  );
}

/** Format frontmatter record as compact YAML-like key: value lines. */
function formatFrontmatter(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length === 0) return null;
        return `${key}: [${value.map(String).join(', ')}]`;
      }
      if (value === null || value === undefined) return null;
      return `${key}: ${String(value)}`;
    })
    .filter(Boolean)
    .join('\n');
}
