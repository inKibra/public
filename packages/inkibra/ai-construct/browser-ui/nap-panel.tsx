import type { ConstructLabSnapshot } from '../lab/types';
import { css, cx } from '../styled-system/css';
import {
  chipAccentClass,
  chipClass,
  chipWarningClass,
  emptyStateClass,
  monoClass,
  panelClass,
  panelHeaderClass,
  panelTitleClass,
  scrollBodyClass,
  sectionClass,
  sectionLabelClass,
  textMutedClass,
} from './styles';

export type ConstructNapPanelBodyProps = {
  hypno: ConstructLabSnapshot['hypno'];
  toolLog: ConstructLabSnapshot['toolLog'];
  napQueued: ConstructLabSnapshot['queuedNextNapPins'];
  napImprints: ConstructLabSnapshot['queuedNextNapImprints'];
};

export type ConstructNapPanelProps = ConstructNapPanelBodyProps & {
  focused?: boolean;
};

/**
 * The scrollable body of the nap panel — reusable inside the tabbed center workspace.
 */
export function ConstructNapPanelBody(props: ConstructNapPanelBodyProps) {
  const isHypnoMode = props.hypno.active;
  const isEmpty =
    !isHypnoMode &&
    !props.hypno.lastReviewReply &&
    props.napQueued.length === 0 &&
    props.napImprints.length === 0 &&
    props.toolLog.length === 0;

  return (
    <div className={cx(scrollBodyClass, css({ flex: 1, minHeight: 0 }))}>
      {/* Status */}
      <div className={sectionClass}>
        <p className={sectionLabelClass}>Status</p>
        <p
          className={css({
            margin: '4px 0 0',
            color: 'aic.textMuted',
            fontSize: '12px',
            lineHeight: 1.5,
          })}
        >
          {isHypnoMode
            ? `Hypno session active in ${props.hypno.stage} stage. ${props.hypno.pendingPlan ? 'Plan is pending review.' : 'Plan has been applied.'}`
            : `Nap cycle ${props.hypno.stage === 'completed' ? 'completed' : 'idle'}. Compaction clears queued work and consolidates context.`}
        </p>
      </div>

      {/* Last review reply */}
      {props.hypno.lastReviewReply ? (
        <div className={sectionClass}>
          <p className={sectionLabelClass}>Last Review Reply</p>
          <p
            className={css({
              margin: '6px 0 0',
              fontSize: '12px',
              lineHeight: 1.55,
              color: 'aic.text',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            })}
          >
            {props.hypno.lastReviewReply}
          </p>
        </div>
      ) : null}

      {/* Queued context opens */}
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

      {/* Queued imprints */}
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
                  lineHeight: 1.45,
                })}
              >
                {q.text}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {/* Tool log */}
      {props.toolLog.length > 0 ? (
        <div className={css({ padding: '12px 18px' })}>
          <p className={sectionLabelClass}>Tool Log ({props.toolLog.length})</p>
          <div
            className={css({
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              marginTop: '6px',
            })}
          >
            {props.toolLog.slice(0, 30).map((t) => (
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
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
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

      {/* Empty state */}
      {isEmpty ? (
        <div className={emptyStateClass}>No nap activity yet.</div>
      ) : null}
    </div>
  );
}

/**
 * Standalone nap panel — panel shell + header + body.
 * Use ConstructNapPanelBody directly when embedding inside another panel.
 */
export function ConstructNapPanel(props: ConstructNapPanelProps) {
  const isHypnoMode = props.hypno.active;

  return (
    <section
      className={cx(
        panelClass,
        css({
          minHeight: 0,
          borderColor: isHypnoMode
            ? 'rgba(245,158,11,0.45)'
            : props.focused
              ? 'aic.accent'
              : 'aic.border',
        }),
      )}
    >
      <header
        className={cx(
          panelHeaderClass,
          isHypnoMode ? css({ bg: 'rgba(245,158,11,0.04)' }) : undefined,
        )}
      >
        <h3 className={panelTitleClass}>
          {isHypnoMode ? `Hypno (${props.hypno.stage})` : 'Nap Mode'}
        </h3>
        <div
          className={css({ display: 'flex', alignItems: 'center', gap: '6px' })}
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
        </div>
      </header>
      <ConstructNapPanelBody
        hypno={props.hypno}
        toolLog={props.toolLog}
        napQueued={props.napQueued}
        napImprints={props.napImprints}
      />
    </section>
  );
}
