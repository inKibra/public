import type { CSSProperties } from 'react';

export const constructUiVars = {
  panel: 'var(--ink-aic-panel, #111827)',
  border: 'var(--ink-aic-border, rgba(148, 163, 184, 0.22))',
  borderStrong: 'var(--ink-aic-border-strong, rgba(148, 163, 184, 0.42))',
  text: 'var(--ink-aic-text, #e5eefb)',
  textMuted: 'var(--ink-aic-text-muted, #a7b6cc)',
  textSubtle: 'var(--ink-aic-text-subtle, #7f8aa3)',
  accent: 'var(--ink-aic-accent, #7dd3fc)',
  accentSoft: 'var(--ink-aic-accent-soft, rgba(125, 211, 252, 0.12))',
  accentStrong: 'var(--ink-aic-accent-strong, rgba(125, 211, 252, 0.28))',
  success: 'var(--ink-aic-success, #4ade80)',
  warning: 'var(--ink-aic-warning, #f59e0b)',
  warningSoft: 'var(--ink-aic-warning-soft, rgba(245, 158, 11, 0.12))',
  error: 'var(--ink-aic-error, #f87171)',
  canvas: 'var(--ink-aic-canvas, transparent)',
} as const;

export function panelStyle(overrides?: CSSProperties): CSSProperties {
  return {
    border: `1px solid ${constructUiVars.border}`,
    borderRadius: 14,
    background: constructUiVars.panel,
    color: constructUiVars.text,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    ...overrides,
  };
}

export function panelHeaderStyle(overrides?: CSSProperties): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '10px 14px',
    borderBottom: `1px solid ${constructUiVars.border}`,
    background: 'rgba(255,255,255,0.02)',
    flexShrink: 0,
    ...overrides,
  };
}

export function panelTitleStyle(overrides?: CSSProperties): CSSProperties {
  return {
    margin: 0,
    color: constructUiVars.text,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.04em',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    ...overrides,
  };
}

export function scrollBodyStyle(overrides?: CSSProperties): CSSProperties {
  return {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    minHeight: 0,
    ...overrides,
  };
}

export function chipStyle(overrides?: CSSProperties): CSSProperties {
  return {
    height: 20,
    padding: '0 7px',
    borderRadius: 999,
    border: `1px solid ${constructUiVars.border}`,
    background: 'rgba(255,255,255,0.03)',
    color: constructUiVars.textMuted,
    fontSize: 10,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
    ...overrides,
  };
}
