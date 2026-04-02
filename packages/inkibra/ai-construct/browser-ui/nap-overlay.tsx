import { useEffect } from 'react';
import type { ConstructLabSnapshot } from '../lab/types';
import { css, cx } from '../styled-system/css';
import {
  chipAccentClass,
  chipClass,
  chipWarningClass,
  monoClass,
  sectionClass,
  sectionLabelClass,
  textMutedClass,
} from './styles';

export type ConstructNapOverlayProps = {
  visible: boolean;
  hypno: ConstructLabSnapshot['hypno'];
  toolLog: ConstructLabSnapshot['toolLog'];
  napQueued: ConstructLabSnapshot['queuedNextNapPins'];
  napImprints: ConstructLabSnapshot['queuedNextNapImprints'];
  onClose: () => void;
};

export function ConstructNapOverlay(props: ConstructNapOverlayProps) {
  useEffect(() => {
    if (!props.visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [props.visible, props.onClose]);

  if (!props.visible) return null;

  const isHypnoMode = props.hypno.active;

  return (
    <div
      className={css({
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        bg: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      })}
      onClick={props.onClose}
    >
      <div
        className={css({
          width: '100%',
          maxWidth: '720px',
          maxHeight: '80vh',
          border: '1px solid rgba(245,158,11,0.35)',
          borderRadius: '16px',
          bg: 'aic.panel',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 0 40px rgba(245,158,11,0.12)',
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className={css({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '14px 18px',
            borderBottom: '1px solid token(colors.aic.border)',
            bg: 'rgba(245,158,11,0.04)',
          })}
        >
          <div
            className={css({
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            })}
          >
            <h3
              className={css({
                margin: 0,
                fontSize: '14px',
                fontWeight: 700,
                color: 'aic.text',
              })}
            >
              {isHypnoMode
                ? `Hypno Session (${props.hypno.stage})`
                : 'Nap Mode'}
            </h3>
          </div>
          <div
            className={css({
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            })}
          >
            {isHypnoMode ? (
              <span className={cx(chipClass, chipWarningClass)}>
                plan: {props.hypno.pendingPlan ? 'pending' : 'applied'}
              </span>
            ) : null}
            <span
              className={cx(
                chipClass,
                props.hypno.active ? chipWarningClass : chipAccentClass,
              )}
            >
              {props.hypno.stage}
            </span>
            <button type="button" onClick={props.onClose}>
              Close
            </button>
          </div>
        </header>

        <div className={css({ flex: 1, overflowY: 'auto' })}>
          <div className={sectionClass}>
            <p className={sectionLabelClass}>Status</p>
            <p
              className={css({
                margin: '4px 0 0',
                color: 'aic.textMuted',
                fontSize: '12px',
              })}
            >
              {isHypnoMode
                ? `Hypno session active in ${props.hypno.stage} stage. ${props.hypno.pendingPlan ? 'Plan is pending review.' : 'Plan has been applied.'}`
                : `Nap cycle ${props.hypno.stage === 'completed' ? 'completed' : 'idle'}. Compaction clears queued work and consolidates context.`}
            </p>
          </div>

          {isHypnoMode && props.hypno.lastReviewReply ? (
            <div className={sectionClass}>
              <p className={sectionLabelClass}>Last Review Reply</p>
              <p
                className={css({
                  margin: '6px 0 0',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  color: 'aic.text',
                  whiteSpace: 'pre-wrap',
                })}
              >
                {props.hypno.lastReviewReply}
              </p>
            </div>
          ) : null}

          {props.napQueued.length > 0 ? (
            <div className={sectionClass}>
              <p className={sectionLabelClass}>
                Queued Context Opens ({props.napQueued.length})
              </p>
              <div
                className={css({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  marginTop: '6px',
                })}
              >
                {props.napQueued.map((q) => (
                  <p
                    key={q.id}
                    className={cx(
                      textMutedClass,
                      monoClass,
                      css({ fontSize: '11px' }),
                    )}
                  >
                    {q.path}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {props.napImprints.length > 0 ? (
            <div className={sectionClass}>
              <p className={sectionLabelClass}>
                Queued Imprints ({props.napImprints.length})
              </p>
              <div
                className={css({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  marginTop: '6px',
                })}
              >
                {props.napImprints.map((q) => (
                  <p
                    key={q.id}
                    className={css({
                      margin: 0,
                      fontSize: '11px',
                      color: 'aic.textMuted',
                      lineHeight: 1.4,
                    })}
                  >
                    {q.text}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {props.toolLog.length > 0 ? (
            <div className={css({ padding: '12px 18px' })}>
              <p className={sectionLabelClass}>
                Tool Log ({props.toolLog.length})
              </p>
              <div
                className={css({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  marginTop: '6px',
                })}
              >
                {props.toolLog.slice(0, 20).map((t) => (
                  <div
                    key={t.id}
                    className={css({
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '4px 0',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                    })}
                  >
                    <span
                      className={css({
                        color: 'aic.accent',
                        fontWeight: 600,
                        flexShrink: 0,
                      })}
                    >
                      {t.tool}
                    </span>
                    <span
                      className={css({
                        color: 'aic.textMuted',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      })}
                    >
                      {t.command}
                    </span>
                    <span
                      className={css({
                        color: 'aic.textSubtle',
                        flexShrink: 0,
                      })}
                    >
                      {new Date(t.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
