import { css, cx } from '../styled-system/css';

// ─── Panel Layout ────────────────────────────────────────────
export const panelClass = css({
  border: '1px solid token(colors.aic.border)',
  borderRadius: '14px',
  bg: 'aic.panel',
  color: 'aic.text',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const panelFocusedClass = css({
  borderColor: 'aic.accent',
});

export const panelHeaderClass = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '10px 14px',
  borderBottom: '1px solid token(colors.aic.border)',
  bg: 'rgba(255,255,255,0.02)',
  flexShrink: 0,
});

export const panelTitleClass = css({
  margin: 0,
  color: 'aic.text',
  fontSize: '12px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

export const scrollBodyClass = css({
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
  minHeight: 0,
});

// ─── Chips / Badges ──────────────────────────────────────────
export const chipClass = css({
  height: '20px',
  padding: '0 7px',
  borderRadius: '999px',
  border: '1px solid token(colors.aic.border)',
  bg: 'rgba(255,255,255,0.03)',
  color: 'aic.textMuted',
  fontSize: '10px',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  whiteSpace: 'nowrap',
});

export const chipAccentClass = css({
  borderColor: 'aic.accentStrong',
  color: 'aic.accent',
  bg: 'aic.accentSoft',
});

export const chipWarningClass = css({
  borderColor: 'rgba(245,158,11,0.35)',
  color: 'aic.warning',
  bg: 'rgba(245,158,11,0.08)',
});

// ─── Typography ──────────────────────────────────────────────
export const sectionLabelClass = css({
  margin: 0,
  color: 'aic.textSubtle',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
});

export const textMutedClass = css({
  margin: 0,
  color: 'aic.textMuted',
  fontSize: '12px',
});

export const textSubtleClass = css({
  margin: 0,
  color: 'aic.textSubtle',
  fontSize: '11px',
});

export const monoClass = css({
  fontFamily: 'monospace',
});

// ─── Sections ────────────────────────────────────────────────
export const sectionClass = css({
  padding: '12px 18px',
  borderBottom: '1px solid token(colors.aic.border)',
});

// ─── Utility ─────────────────────────────────────────────────
export const emptyStateClass = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '160px',
  color: 'aic.textSubtle',
  fontSize: '13px',
  fontStyle: 'italic',
});

export const dotClass = css({
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  display: 'inline-block',
});

// Re-export cx for combining classes
export { css, cx };
