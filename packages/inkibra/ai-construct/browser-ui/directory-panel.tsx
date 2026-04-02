import { useMemo } from 'react';
import type {
  ConstructRuntimeVfsNode,
  ConstructStudioContextFile,
} from '../lab/types';
import { css, cx } from '../styled-system/css';
import { scrollBodyClass, sectionLabelClass } from './styles';

export type ConstructDirectoryPanelBodyProps = {
  path: string;
  vfsNodes: ConstructRuntimeVfsNode[];
  contextFiles: ConstructStudioContextFile[];
  onSelectPath?: (path: string) => void;
};

function formatSize(bytes?: number): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const thStyle = css({
  textAlign: 'left',
  padding: '4px 16px',
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'aic.textSubtle',
  borderBottom: '1px solid token(colors.aic.border)',
});

export function ConstructDirectoryPanelBody(
  props: ConstructDirectoryPanelBodyProps,
) {
  const { path, vfsNodes, contextFiles } = props;

  // Find direct children of this directory
  const normalizedDir = path.endsWith('/') ? path : `${path}/`;
  const children = useMemo(() => {
    return vfsNodes
      .filter((node) => {
        if (!node.path.startsWith(normalizedDir)) return false;
        const remainder = node.path.slice(normalizedDir.length);
        // Direct child: no further slashes (or just a trailing slash for dirs)
        const stripped = remainder.replace(/\/$/, '');
        return stripped.length > 0 && !stripped.includes('/');
      })
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.path.localeCompare(b.path);
      });
  }, [vfsNodes, normalizedDir]);

  // Find README.md in this directory
  const readmePath = `${normalizedDir}README.md`;
  const readmeFile = contextFiles.find(
    (f) => f.path.toLowerCase() === readmePath.toLowerCase(),
  );

  const dirName = path.split('/').filter(Boolean).pop() ?? path;

  return (
    <div
      className={cx(
        scrollBodyClass,
        css({
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
        }),
      )}
    >
      {/* Directory header */}
      <div
        className={css({
          padding: '12px 16px',
          borderBottom: '1px solid token(colors.aic.border)',
        })}
      >
        <div className={css({ fontSize: '11px', color: 'aic.textSubtle' })}>
          {path}
        </div>
        <div
          className={css({
            fontSize: '14px',
            fontWeight: 600,
            color: 'aic.text',
            marginTop: '2px',
          })}
        >
          {dirName}/
        </div>
        <div
          className={css({
            fontSize: '11px',
            color: 'aic.textMuted',
            marginTop: '4px',
          })}
        >
          {children.length} item{children.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* README.md content if present */}
      {readmeFile?.content ? (
        <div
          className={css({
            padding: '12px 16px',
            borderBottom: '1px solid token(colors.aic.border)',
            bg: 'rgba(255,255,255,0.02)',
          })}
        >
          <div
            className={cx(
              sectionLabelClass,
              css({ letterSpacing: '0.05em', marginBottom: '8px' }),
            )}
          >
            README.md
          </div>
          <pre
            className={css({
              margin: 0,
              fontSize: '12px',
              lineHeight: 1.5,
              color: 'aic.textMuted',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
              maxHeight: '200px',
              overflow: 'auto',
            })}
          >
            {readmeFile.content}
          </pre>
        </div>
      ) : null}

      {/* File listing */}
      <div className={css({ flex: 1, overflow: 'auto', padding: '8px 0' })}>
        {children.length === 0 ? (
          <div
            className={css({
              padding: '24px 16px',
              textAlign: 'center',
              color: 'aic.textSubtle',
              fontSize: '12px',
              fontStyle: 'italic',
            })}
          >
            Empty directory
          </div>
        ) : (
          <table
            className={css({
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            })}
          >
            <thead>
              <tr>
                <th className={thStyle}>Name</th>
                <th
                  className={cx(
                    thStyle,
                    css({ textAlign: 'right', width: '80px' }),
                  )}
                >
                  Size
                </th>
                <th
                  className={cx(
                    thStyle,
                    css({ textAlign: 'right', width: '120px' }),
                  )}
                >
                  Modified
                </th>
              </tr>
            </thead>
            <tbody>
              {children.map((node) => {
                const name =
                  node.path.replace(/\/$/, '').split('/').pop() ?? node.path;
                const isDir = node.type === 'directory';
                return (
                  <tr
                    key={node.path}
                    className={css({ cursor: 'pointer' })}
                    onClick={() => props.onSelectPath?.(node.path)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'rgba(255,255,255,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'transparent';
                    }}
                  >
                    <td
                      className={css({
                        padding: '6px 16px',
                        color: isDir ? 'aic.textMuted' : 'aic.text',
                        fontWeight: isDir ? 600 : 400,
                      })}
                    >
                      <span
                        className={css({
                          marginRight: '8px',
                          fontSize: '13px',
                        })}
                      >
                        {isDir ? '📁' : '📄'}
                      </span>
                      {name}
                      {isDir ? '/' : ''}
                    </td>
                    <td
                      className={css({
                        padding: '6px 16px',
                        textAlign: 'right',
                        color: 'aic.textSubtle',
                      })}
                    >
                      {isDir ? '—' : formatSize(node.sizeBytes)}
                    </td>
                    <td
                      className={css({
                        padding: '6px 16px',
                        textAlign: 'right',
                        color: 'aic.textSubtle',
                      })}
                    >
                      {formatDate(node.modifiedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
