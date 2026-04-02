import { useEffect, useMemo, useState } from 'react';
import { css, cx } from '../styled-system/css';
import {
  panelClass,
  panelHeaderClass,
  panelTitleClass,
  scrollBodyClass,
} from './styles';

export type ConstructFileTreeItem = {
  path: string;
  kind?: 'file' | 'directory';
  label?: string;
  description?: string;
  meta?: string;
  /** When true, renders the row with reduced opacity (not in active context). */
  dimmed?: boolean;
  chips?: Array<{
    label: string;
    tone?: 'accent' | 'muted' | 'warning' | 'neon';
  }>;
  sizeBytes?: number;
};

type ConstructFileTreeChipTone = NonNullable<
  ConstructFileTreeItem['chips']
>[number]['tone'];

type FileTreeNode = {
  path: string;
  segment: string;
  kind: 'file' | 'directory';
  item?: ConstructFileTreeItem;
  children: Map<string, FileTreeNode>;
};

type FlattenedTreeNode = {
  path: string;
  depth: number;
  kind: 'file' | 'directory';
  label: string;
  item?: ConstructFileTreeItem;
  hasChildren: boolean;
  isLast: boolean;
  /** Which ancestor depths have a continuing sibling below (for tree lines). */
  ancestorContinuations: boolean[];
};

export type ConstructFileTreeProps = {
  items: ConstructFileTreeItem[];
  activePath?: string;
  emptyLabel?: string;
  dense?: boolean;
  title?: string;
  /** When true, renders without the outer panel wrapper (for embedding inside another panel). */
  bare?: boolean;
  onSelectPath?: (path: string) => void;
};

function normalizedPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function splitPath(path: string): string[] {
  return normalizedPath(path).split('/').filter(Boolean);
}

function parentDirectoryPath(path: string): string | undefined {
  const segments = splitPath(path);
  if (segments.length <= 1) return undefined;
  return `/${segments.slice(0, -1).join('/')}`;
}

function pathAncestors(path?: string): string[] {
  if (!path) return [];
  const segments = splitPath(path);
  const ancestors: string[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    ancestors.push(`/${segments.slice(0, i + 1).join('/')}`);
  }
  return ancestors;
}

function createNode(
  path: string,
  segment: string,
  kind: 'file' | 'directory',
): FileTreeNode {
  return { path, segment, kind, children: new Map() };
}

function buildFileTree(items: ConstructFileTreeItem[]): FileTreeNode {
  const root = createNode('/', '', 'directory');

  const ensureDirectoryNode = (directoryPath: string, label?: string) => {
    const segments = splitPath(directoryPath);
    let cursor = root;
    segments.forEach((segment, index) => {
      const currentPath = `/${segments.slice(0, index + 1).join('/')}`;
      const existing = cursor.children.get(segment);
      if (existing) {
        cursor = existing;
        if (index === segments.length - 1 && label && !existing.item?.label) {
          existing.item = {
            ...(existing.item ?? { path: currentPath, kind: 'directory' }),
            label,
          };
        }
        return;
      }
      const node = createNode(currentPath, segment, 'directory');
      cursor.children.set(segment, node);
      cursor = node;
      if (index === segments.length - 1 && label) {
        node.item = { path: currentPath, kind: 'directory', label };
      }
    });
  };

  items.forEach((item) => {
    const path = normalizedPath(item.path);
    const kind = item.kind ?? 'file';
    if (kind === 'directory') {
      ensureDirectoryNode(path, item.label);
      return;
    }
    const parentPath = parentDirectoryPath(path);
    if (parentPath) ensureDirectoryNode(parentPath);
    const segments = splitPath(path);
    const segment = segments[segments.length - 1] ?? path;
    let cursor = root;
    segments.slice(0, -1).forEach((directorySegment, index, source) => {
      const next = cursor.children.get(directorySegment);
      if (next) {
        cursor = next;
        return;
      }
      const currentPath = `/${source.slice(0, index + 1).join('/')}`;
      const node = createNode(currentPath, directorySegment, 'directory');
      cursor.children.set(directorySegment, node);
      cursor = node;
    });
    const fileNode = createNode(path, segment, 'file');
    fileNode.item = { ...item, path, kind: 'file' };
    cursor.children.set(segment, fileNode);
  });

  return root;
}

function flattenTree(
  root: FileTreeNode,
  expandedPaths: Set<string>,
  depth = 0,
  ancestorContinuations: boolean[] = [],
): FlattenedTreeNode[] {
  const entries = Array.from(root.children.values()).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.segment.localeCompare(right.segment);
  });
  const output: FlattenedTreeNode[] = [];
  for (const [i, node] of entries.entries()) {
    const isLast = i === entries.length - 1;
    output.push({
      path: node.path,
      depth,
      kind: node.kind,
      label: node.item?.label ?? node.segment,
      item: node.item,
      hasChildren: node.children.size > 0,
      isLast,
      ancestorContinuations: [...ancestorContinuations],
    });
    if (node.kind === 'directory' && expandedPaths.has(node.path)) {
      output.push(
        ...flattenTree(node, expandedPaths, depth + 1, [
          ...ancestorContinuations,
          !isLast,
        ]),
      );
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// File type icons
// ---------------------------------------------------------------------------

const FILE_ICONS: Record<string, string> = {
  '.md': '📄',
  '.ts': '📜',
  '.tsx': '⚛',
  '.json': '{}',
  '.toml': '⚙',
  '.yaml': '⚙',
  '.yml': '⚙',
  '.txt': '📝',
  '.log': '📋',
};

function getFileIcon(name: string): string {
  const ext = name.includes('.') ? `.${name.split('.').pop()}` : '';
  return FILE_ICONS[ext] ?? '📄';
}

function formatSize(bytes?: number): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function chipToneClassName(tone?: ConstructFileTreeChipTone): string {
  if (tone === 'accent' || tone === 'neon') {
    return css({
      borderColor: 'aic.accentStrong',
      color: 'aic.accent',
      bg: 'aic.accentSoft',
    });
  }
  if (tone === 'warning') {
    return css({
      borderColor: 'rgba(251,191,36,0.5)',
      color: 'aic.warning',
      bg: 'aic.warningSoft',
    });
  }
  return css({ color: 'aic.textSubtle' });
}

const INDENT_PX = 16;
const LINE_COLOR = 'rgba(255,255,255,0.08)';

// ---------------------------------------------------------------------------
// Tree row component
// ---------------------------------------------------------------------------

function TreeRow({
  node,
  active,
  expanded,
  dense,
  onToggle,
  onSelect,
}: {
  node: FlattenedTreeNode;
  active: boolean;
  expanded: boolean;
  dense: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const dimmed = node.item?.dimmed ?? false;
  const isDir = node.kind === 'directory';
  const rowHeight = dense ? 24 : 28;

  // Tree connector lines
  const treeGuides = [];
  for (let d = 0; d < node.depth; d++) {
    const hasContinuation = node.ancestorContinuations[d] ?? false;
    treeGuides.push(
      <span
        key={`guide-${d}`}
        className={css({
          display: 'inline-block',
          width: `${INDENT_PX}px`,
          height: `${rowHeight}px`,
          position: 'relative',
          flexShrink: 0,
        })}
      >
        {hasContinuation && (
          <span
            className={css({
              position: 'absolute',
              left: '8px',
              top: 0,
              bottom: 0,
              width: '1px',
              bg: LINE_COLOR,
            })}
          />
        )}
      </span>,
    );
  }

  // Branch connector for this node
  const branchConnector =
    node.depth > 0 ? (
      <span
        className={css({
          display: 'inline-block',
          width: `${INDENT_PX}px`,
          height: `${rowHeight}px`,
          position: 'relative',
          flexShrink: 0,
        })}
      >
        <span
          className={css({
            position: 'absolute',
            left: '8px',
            top: 0,
            height: node.isLast ? '50%' : '100%',
            width: '1px',
            bg: LINE_COLOR,
          })}
        />
        <span
          className={css({
            position: 'absolute',
            left: '8px',
            top: '50%',
            width: '8px',
            height: '1px',
            bg: LINE_COLOR,
          })}
        />
      </span>
    ) : null;

  // Icon
  const icon = isDir ? (
    <span
      className={css({
        fontSize: '10px',
        color: 'aic.textSubtle',
        flexShrink: 0,
        width: '14px',
        textAlign: 'center',
        transition: 'transform 120ms ease',
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        display: 'inline-block',
      })}
    >
      ▶
    </span>
  ) : (
    <span
      className={css({
        fontSize: '11px',
        flexShrink: 0,
        width: '14px',
        textAlign: 'center',
      })}
    >
      {getFileIcon(node.label)}
    </span>
  );

  const sizeText = formatSize(node.item?.sizeBytes);

  return (
    <button
      type="button"
      className={css({
        width: '100%',
        border: 'none',
        bg: active ? 'aic.accentSoft' : 'transparent',
        borderRadius: '4px',
        padding: 0,
        margin: 0,
        textAlign: 'left',
        color: active
          ? 'aic.text'
          : dimmed
            ? 'aic.textSubtle'
            : 'aic.textMuted',
        cursor: 'pointer',
        transition: 'background 80ms ease',
        opacity: dimmed ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        height: `${rowHeight}px`,
        fontSize: '12px',
        fontFamily:
          "'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      })}
      onClick={() => {
        if (isDir && node.hasChildren) onToggle();
        onSelect();
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.background =
            'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {treeGuides}
      {branchConnector}
      {icon}
      <span
        className={css({
          marginLeft: '6px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
          fontWeight: isDir ? 600 : 400,
          color: isDir ? (active ? 'aic.text' : 'aic.textMuted') : 'inherit',
        })}
      >
        {node.label}
      </span>
      {node.item?.chips?.map((chip) => (
        <span
          key={`${node.path}:${chip.label}`}
          className={cx(
            css({
              height: '14px',
              padding: '0 5px',
              borderRadius: '999px',
              border: '1px solid token(colors.aic.border)',
              fontSize: '8px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              flexShrink: 0,
              marginLeft: '4px',
              fontFamily: 'inherit',
            }),
            chipToneClassName(chip.tone),
          )}
        >
          {chip.label}
        </span>
      ))}
      {sizeText && (
        <span
          className={css({
            fontSize: '10px',
            color: 'aic.textSubtle',
            marginLeft: '4px',
            flexShrink: 0,
            fontFamily: 'inherit',
          })}
        >
          {sizeText}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConstructFileTree(props: ConstructFileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(pathAncestors(props.activePath)),
  );

  useEffect(() => {
    if (!props.activePath) return;
    setExpandedPaths(
      (current) => new Set([...current, ...pathAncestors(props.activePath)]),
    );
  }, [props.activePath]);

  const root = useMemo(() => buildFileTree(props.items), [props.items]);
  const flattened = useMemo(
    () => flattenTree(root, expandedPaths),
    [root, expandedPaths],
  );

  const toggleDirectory = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const treeBody = (
    <div
      className={css({
        display: 'flex',
        flexDirection: 'column',
      })}
    >
      {flattened.length === 0 ? (
        <p
          className={css({
            margin: 0,
            padding: '16px 10px',
            textAlign: 'center',
            color: 'aic.textSubtle',
            fontSize: '12px',
          })}
        >
          {props.emptyLabel ?? 'No files'}
        </p>
      ) : (
        flattened.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            active={node.path === props.activePath}
            expanded={expandedPaths.has(node.path)}
            dense={props.dense ?? false}
            onToggle={() => toggleDirectory(node.path)}
            onSelect={() => props.onSelectPath?.(node.path)}
          />
        ))
      )}
    </div>
  );

  if (props.bare) {
    return treeBody;
  }

  return (
    <section className={cx(panelClass, css({ minHeight: 0 }))}>
      <div className={panelHeaderClass}>
        <h3 className={panelTitleClass}>{props.title ?? 'Context'}</h3>
      </div>
      <div
        className={cx(
          scrollBodyClass,
          css({
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
          }),
        )}
      >
        {treeBody}
      </div>
    </section>
  );
}
