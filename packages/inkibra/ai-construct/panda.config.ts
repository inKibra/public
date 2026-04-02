import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  preflight: false,
  hash: false,
  include: ['./browser-ui/**/*.{ts,tsx}', './dev-server/**/*.{ts,tsx}'],
  exclude: [],
  outdir: 'styled-system',
  theme: {
    extend: {
      tokens: {
        colors: {
          aic: {
            panel: { value: 'var(--ink-aic-panel, #111827)' },
            border: {
              value: 'var(--ink-aic-border, rgba(148, 163, 184, 0.22))',
            },
            borderStrong: {
              value: 'var(--ink-aic-border-strong, rgba(148, 163, 184, 0.42))',
            },
            text: { value: 'var(--ink-aic-text, #e5eefb)' },
            textMuted: { value: 'var(--ink-aic-text-muted, #a7b6cc)' },
            textSubtle: { value: 'var(--ink-aic-text-subtle, #7f8aa3)' },
            accent: { value: 'var(--ink-aic-accent, #7dd3fc)' },
            accentSoft: {
              value: 'var(--ink-aic-accent-soft, rgba(125, 211, 252, 0.12))',
            },
            accentStrong: {
              value: 'var(--ink-aic-accent-strong, rgba(125, 211, 252, 0.28))',
            },
            success: { value: 'var(--ink-aic-success, #4ade80)' },
            warning: { value: 'var(--ink-aic-warning, #f59e0b)' },
            warningSoft: {
              value: 'var(--ink-aic-warning-soft, rgba(245, 158, 11, 0.12))',
            },
            error: { value: 'var(--ink-aic-error, #f87171)' },
            canvas: { value: 'var(--ink-aic-canvas, transparent)' },
          },
        },
      },
    },
  },
});
