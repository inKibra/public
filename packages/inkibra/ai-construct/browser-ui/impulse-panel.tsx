import type {
  ConstructLabSnapshot,
  ConstructRuntimeSnapshot,
} from '../lab/types';
import type { ConstructInFlightItem } from '../live/in-flight';
import type {
  ConstructLiveResponseDecision,
  ConstructLiveResponseHistory,
} from '../live/selectors';
import { css, cx } from '../styled-system/css';
import {
  chipAccentClass,
  chipClass,
  chipWarningClass,
  dotClass,
  monoClass,
  panelClass,
  panelHeaderClass,
  panelTitleClass,
  scrollBodyClass,
  sectionLabelClass,
  textSubtleClass,
} from './styles';

export type ConstructImpulsePanelProps = {
  inFlightItems: ConstructInFlightItem[];
  impulses: ConstructRuntimeSnapshot['impulses'];
  scheduledResponses: ConstructRuntimeSnapshot['scheduledResponses'];
  liveDecisionEntries: ConstructLiveResponseDecision[];
  liveResponseHistories: ConstructLiveResponseHistory[];
  selectedResponseId?: string;
  recentDecisions?: ConstructRuntimeSnapshot['decisions'];
  liveImpulseThinkingById: Record<string, string>;
  runtimeState: ConstructRuntimeSnapshot['runtimeState'];
  residency: ConstructRuntimeSnapshot['residency'];
  napQueued: ConstructLabSnapshot['queuedNextNapPins'];
  napImprints: ConstructLabSnapshot['queuedNextNapImprints'];
  hypnoActive: boolean;
  hypnoStage: string;
  hypnoPendingPlan: boolean;
  hypnoLastReviewReply?: string;
  onSelectResponse?: (responseId: string) => void;
  focused?: boolean;
};

function chipToneClass(kind?: 'accent' | 'warning'): string {
  if (kind === 'accent') return chipAccentClass;
  if (kind === 'warning') return chipWarningClass;
  return '';
}

function ImpulseStatusDot(props: { status: string }) {
  const bgColor =
    props.status === 'running'
      ? 'aic.success'
      : props.status === 'completed'
        ? 'rgba(255,255,255,0.3)'
        : 'aic.warning';
  return <span className={cx(dotClass, css({ flexShrink: 0, bg: bgColor }))} />;
}

function inFlightStageLabel(stage: ConstructInFlightItem['stage']): string {
  switch (stage) {
    case 'impulse-running':
      return 'impulse';
    case 'scheduler-running':
      return 'scheduler';
    case 'responding':
      return 'responding';
    case 'scheduled':
      return 'scheduled';
    case 'awaiting-durable':
      return 'awaiting durable';
    case 'dropped':
      return 'dropped';
    default:
      return stage;
  }
}

function formatClockTime(iso: string | undefined): string {
  if (!iso) return 'unknown';
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'unknown';
  }
}

export function summarizeImpulseActivity(
  impulse: ConstructImpulsePanelProps['impulses'][number],
): string {
  if (impulse.profile.includes('heartbeat')) return 'heartbeat';
  if (impulse.profile.includes('self_reminder')) return 'reminder';
  if (impulse.profile.includes('system_event')) return 'system event';
  if (impulse.profile.includes('conversation')) return 'conversation';
  return impulse.pool.replaceAll('_', ' ');
}

export function getVisibleImpulseActivity(
  impulses: ConstructImpulsePanelProps['impulses'],
) {
  return [...impulses]
    .sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
    )
    .slice(0, 6);
}

export function ConstructImpulsePanel(props: ConstructImpulsePanelProps) {
  const panelTitle = props.hypnoActive
    ? `Hypno Document (${props.hypnoStage})`
    : `In Flight (${props.inFlightItems.length})`;
  const awakeLabel = props.residency.awake ? 'awake' : 'sleeping';
  const visibleImpulses = getVisibleImpulseActivity(props.impulses);
  const decisionRunning = props.liveDecisionEntries.some(
    (entry) => entry.state === 'live',
  );
  const hasScheduledResponses = props.scheduledResponses.length > 0;

  return (
    <section
      className={cx(
        panelClass,
        css({
          minHeight: 0,
          borderColor: props.focused
            ? props.hypnoActive
              ? 'aic.warning'
              : 'aic.accent'
            : 'aic.border',
        }),
      )}
    >
      <header className={panelHeaderClass}>
        <h3 className={panelTitleClass}>{panelTitle}</h3>
        <div className={css({ display: 'flex', gap: '4px' })}>
          {(props.runtimeState as Record<string, unknown>).schedulerPolling ? (
            <span className={cx(chipClass, chipWarningClass)}>polling</span>
          ) : null}
          <span className={chipClass}>
            {props.runtimeState.activeImpulses} active
          </span>
          <span className={chipClass}>
            {props.runtimeState.activeResponses} responding
          </span>
          {props.runtimeState.scheduledResponses > 0 ? (
            <span className={chipClass}>
              {props.runtimeState.scheduledResponses} queued
            </span>
          ) : null}
        </div>
      </header>

      <div className={cx(scrollBodyClass, css({ padding: 0 }))}>
        {props.hypnoActive ? (
          <div
            className={css({
              padding: '14px',
              fontSize: '13px',
              lineHeight: 1.6,
              color: 'aic.text',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            })}
          >
            {props.hypnoLastReviewReply ??
              `[${props.hypnoStage} stage running...]`}
          </div>
        ) : (
          <div
            className={css({
              minHeight: 0,
              display: 'grid',
              gridTemplateRows: 'auto minmax(0, 1fr) minmax(0, 1fr) auto',
              gap: '6px',
            })}
          >
            <div
              className={css({
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              })}
            >
              <div
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 12px 4px',
                })}
              >
                <p className={sectionLabelClass}>Construct</p>
                <span
                  className={cx(
                    chipClass,
                    css({
                      marginLeft: 'auto',
                      height: '16px',
                      fontSize: '9px',
                    }),
                    props.residency.awake ? chipAccentClass : '',
                  )}
                >
                  {awakeLabel}
                </span>
                {props.residency.status ? (
                  <span
                    className={cx(
                      chipClass,
                      css({ height: '16px', fontSize: '9px' }),
                      props.residency.status === 'active'
                        ? chipAccentClass
                        : '',
                    )}
                  >
                    {props.residency.status}
                  </span>
                ) : null}
              </div>
              <div
                className={css({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '10px 12px 0',
                })}
              >
                <p className={textSubtleClass}>
                  Last active:{' '}
                  {props.residency.lastActiveAt
                    ? new Date(props.residency.lastActiveAt).toLocaleTimeString(
                        [],
                        {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        },
                      )
                    : 'unknown'}
                </p>
              </div>
              <div
                className={css({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '0 12px 8px',
                })}
              >
                {visibleImpulses.map((impulse) => {
                  const thinking = props.liveImpulseThinkingById[impulse.id];
                  const statusTone =
                    impulse.status === 'running'
                      ? 'accent'
                      : impulse.status === 'queued' ||
                          impulse.status === 'error'
                        ? 'warning'
                        : undefined;
                  return (
                    <div
                      key={impulse.id}
                      className={css({
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.08)',
                        bg: 'rgba(255,255,255,0.02)',
                        padding: '7px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                      })}
                    >
                      <div
                        className={css({
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                        })}
                      >
                        <ImpulseStatusDot status={impulse.status} />
                        <p
                          className={css({
                            margin: 0,
                            fontSize: '11px',
                            fontWeight: 600,
                            color: 'aic.text',
                          })}
                        >
                          {impulse.summary}
                        </p>
                        <span
                          className={cx(
                            chipClass,
                            css({
                              height: '16px',
                              fontSize: '9px',
                              marginLeft: 'auto',
                            }),
                            statusTone ? chipToneClass(statusTone) : '',
                          )}
                        >
                          {impulse.status}
                        </span>
                      </div>
                      <div
                        className={css({
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          flexWrap: 'wrap',
                        })}
                      >
                        <span
                          className={cx(
                            chipClass,
                            css({ height: '16px', fontSize: '9px' }),
                          )}
                        >
                          {summarizeImpulseActivity(impulse)}
                        </span>
                        <span
                          className={cx(
                            chipClass,
                            css({ height: '16px', fontSize: '9px' }),
                          )}
                        >
                          {impulse.pool}
                        </span>
                        <span
                          className={css({
                            margin: 0,
                            color: 'aic.textSubtle',
                            fontSize: '11px',
                          })}
                        >
                          {formatClockTime(impulse.startedAt)}
                        </span>
                      </div>
                      {thinking ? (
                        <p
                          className={css({
                            margin: 0,
                            fontSize: '11px',
                            lineHeight: 1.45,
                            color: 'aic.textMuted',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          })}
                        >
                          {thinking}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {visibleImpulses.length === 0 ? (
                  <p className={textSubtleClass}>No recent impulses</p>
                ) : null}
              </div>
            </div>

            <div
              className={css({
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              })}
            >
              <div
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 12px 4px',
                })}
              >
                <p className={sectionLabelClass}>In Flight</p>
                <span
                  className={cx(
                    chipClass,
                    css({
                      height: '16px',
                      fontSize: '9px',
                      marginLeft: 'auto',
                    }),
                    props.runtimeState.activeImpulses > 0
                      ? chipAccentClass
                      : '',
                  )}
                >
                  {props.runtimeState.activeImpulses} active
                </span>
                <span
                  className={cx(
                    chipClass,
                    css({ height: '16px', fontSize: '9px' }),
                    props.runtimeState.activeResponses > 0
                      ? chipAccentClass
                      : '',
                  )}
                >
                  {props.runtimeState.activeResponses} responding
                </span>
                {props.runtimeState.scheduledResponses > 0 ? (
                  <span
                    className={cx(
                      chipClass,
                      css({ height: '16px', fontSize: '9px' }),
                    )}
                  >
                    {props.runtimeState.scheduledResponses} queued
                  </span>
                ) : null}
              </div>
              <div className={css({ minHeight: 0, overflowY: 'auto' })}>
                <div
                  className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    padding: '0 12px 8px',
                  })}
                >
                  {props.inFlightItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={css({
                        textAlign: 'left',
                        borderRadius: '10px',
                        border:
                          item.selectedResponseId === props.selectedResponseId
                            ? '1px solid token(colors.aic.accentStrong)'
                            : '1px solid token(colors.aic.border)',
                        bg:
                          item.selectedResponseId === props.selectedResponseId
                            ? 'aic.accentSoft'
                            : 'rgba(255,255,255,0.02)',
                        padding: '8px',
                        cursor: item.selectedResponseId ? 'pointer' : 'default',
                      })}
                      onClick={() => {
                        if (item.selectedResponseId)
                          props.onSelectResponse?.(item.selectedResponseId);
                      }}
                    >
                      <div
                        className={css({
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        })}
                      >
                        <div
                          className={css({
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          })}
                        >
                          <ImpulseStatusDot
                            status={
                              item.stage === 'responding' ||
                              item.stage === 'scheduler-running' ||
                              item.stage === 'impulse-running'
                                ? 'running'
                                : item.stage === 'durable' ||
                                    item.stage === 'awaiting-durable' ||
                                    item.stage === 'dropped'
                                  ? 'completed'
                                  : 'queued'
                            }
                          />
                          {item.thinkingText ? (
                            <span
                              className={css({
                                width: '10px',
                                height: '10px',
                                borderRadius: '50%',
                                border: '1.5px solid rgba(125,211,252,0.22)',
                                borderTopColor: 'aic.accent',
                                display: 'inline-block',
                              })}
                            />
                          ) : null}
                          <p
                            className={css({
                              margin: 0,
                              fontSize: '11px',
                              fontWeight: 600,
                              color: 'aic.text',
                            })}
                          >
                            {item.message}
                          </p>
                        </div>
                        <div
                          className={css({
                            display: 'flex',
                            gap: '4px',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                          })}
                        >
                          <span
                            className={cx(
                              chipClass,
                              css({ height: '16px', fontSize: '9px' }),
                              item.stage === 'responding' ||
                                item.stage === 'scheduler-running' ||
                                item.stage === 'impulse-running'
                                ? chipAccentClass
                                : item.stage === 'scheduled' ||
                                    item.stage === 'sent' ||
                                    item.stage === 'dropped'
                                  ? chipWarningClass
                                  : '',
                            )}
                          >
                            {inFlightStageLabel(item.stage)}
                          </span>
                          {item.deliveryState ? (
                            <span
                              className={cx(
                                chipClass,
                                css({ height: '16px', fontSize: '9px' }),
                              )}
                            >
                              {item.deliveryState}
                            </span>
                          ) : null}
                          {item.urgency ? (
                            <span
                              className={cx(
                                chipClass,
                                css({ height: '16px', fontSize: '9px' }),
                              )}
                            >
                              {item.urgency}
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={css({
                            margin: 0,
                            fontSize: '11px',
                            color: 'aic.textMuted',
                          })}
                        >
                          {item.activeImpulseIds.length > 0
                            ? `impulses: ${item.activeImpulseIds.join(', ')}`
                            : item.responseIds.length > 0
                              ? `responses: ${item.responseIds.join(', ')}`
                              : (item.factId ?? item.id)}
                        </p>
                        {item.thinkingText ? (
                          <p
                            className={css({
                              margin: 0,
                              fontSize: '11px',
                              lineHeight: 1.45,
                              color: 'aic.textMuted',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            })}
                          >
                            {item.thinkingText}
                          </p>
                        ) : item.schedulerText ? (
                          <p
                            className={css({
                              margin: 0,
                              fontSize: '11px',
                              lineHeight: 1.45,
                              color: 'aic.textMuted',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            })}
                          >
                            {item.schedulerText}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  ))}
                  {props.inFlightItems.length === 0 ? (
                    <p
                      className={css({
                        margin: 0,
                        color: 'aic.textMuted',
                        textAlign: 'center',
                        padding: '8px',
                        fontSize: '12px',
                      })}
                    >
                      Nothing in flight
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div
              className={css({
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              })}
            >
              <div
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 12px 4px',
                })}
              >
                <p className={sectionLabelClass}>Scheduler</p>
                <span
                  className={cx(
                    chipClass,
                    css({
                      marginLeft: 'auto',
                      height: '16px',
                      fontSize: '9px',
                    }),
                    decisionRunning ? chipWarningClass : '',
                  )}
                >
                  {decisionRunning
                    ? 'running'
                    : hasScheduledResponses
                      ? 'scheduled'
                      : 'idle'}
                </span>
              </div>
              <div className={css({ minHeight: 0, overflowY: 'auto' })}>
                <div
                  className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    padding: '0 12px 8px',
                  })}
                >
                  {props.liveDecisionEntries.map((decision) => (
                    <button
                      key={decision.id}
                      type="button"
                      className={css({
                        textAlign: 'left',
                        cursor: 'pointer',
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        padding: '6px 8px',
                        borderRadius: '8px',
                        bg:
                          decision.responseId === props.selectedResponseId
                            ? 'aic.accentSoft'
                            : 'rgba(255,255,255,0.02)',
                        border:
                          decision.state === 'live'
                            ? '1px solid token(colors.aic.accentStrong)'
                            : '1px solid rgba(125,211,252,0.08)',
                      })}
                      onClick={() =>
                        props.onSelectResponse?.(decision.responseId)
                      }
                    >
                      <p
                        className={cx(
                          monoClass,
                          css({
                            margin: 0,
                            color: 'aic.textSubtle',
                            fontSize: '11px',
                          }),
                        )}
                      >
                        {decision.stage} · {decision.status}{' '}
                        {decision.state === 'live' ? '(live)' : '(recent)'}
                      </p>
                      {decision.scheduledBy ? (
                        <p
                          className={css({
                            margin: 0,
                            color: 'aic.textSubtle',
                            fontSize: '11px',
                          })}
                        >
                          from {decision.scheduledBy}
                        </p>
                      ) : null}
                      {decision.decision ? (
                        <p
                          className={css({
                            margin: 0,
                            color: 'aic.textSubtle',
                            fontSize: '11px',
                          })}
                        >
                          outcome: {decision.decision}
                          {decision.reason ? ` · ${decision.reason}` : ''}
                        </p>
                      ) : null}
                      <p
                        className={css({
                          margin: 0,
                          fontSize: '11px',
                          lineHeight: 1.45,
                          color: 'aic.textMuted',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        })}
                      >
                        {decision.text}
                      </p>
                    </button>
                  ))}
                  {!decisionRunning &&
                  props.liveDecisionEntries.length === 0 ? (
                    <p
                      className={css({
                        margin: 0,
                        color: 'aic.textMuted',
                        textAlign: 'center',
                        padding: '8px',
                        fontSize: '12px',
                      })}
                    >
                      Scheduler idle
                    </p>
                  ) : null}
                  {props.scheduledResponses.map((response) => (
                    <button
                      key={response.id}
                      type="button"
                      className={css({
                        textAlign: 'left',
                        cursor: 'pointer',
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        padding: '6px 8px',
                        borderRadius: '8px',
                        bg:
                          response.id === props.selectedResponseId
                            ? 'aic.accentSoft'
                            : 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      })}
                      onClick={() => props.onSelectResponse?.(response.id)}
                    >
                      <p
                        className={cx(
                          monoClass,
                          css({
                            margin: 0,
                            color: 'aic.textSubtle',
                            fontSize: '11px',
                          }),
                        )}
                      >
                        scheduled · {response.urgency}
                      </p>
                      <p
                        className={css({
                          margin: 0,
                          color: 'aic.textSubtle',
                          fontSize: '11px',
                        })}
                      >
                        from {response.scheduledBy}
                      </p>
                      <p
                        className={css({
                          margin: 0,
                          fontSize: '11px',
                          color: 'aic.text',
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        })}
                      >
                        {response.intent}
                      </p>
                      {response.waitForIdleTargets &&
                      response.waitForIdleTargets.length > 0 ? (
                        <p
                          className={css({
                            margin: 0,
                            color: 'aic.textSubtle',
                            fontSize: '11px',
                          })}
                        >
                          waitFor:{' '}
                          {response.waitForIdleTargets
                            .map((target) => `${target.kind}:${target.name}`)
                            .join(', ')}
                        </p>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              className={css({
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              })}
            >
              <div
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 12px 4px',
                })}
              >
                <p className={sectionLabelClass}>Nap Queue</p>
                <span
                  className={cx(
                    chipClass,
                    css({
                      height: '16px',
                      fontSize: '9px',
                      marginLeft: 'auto',
                    }),
                  )}
                >
                  {props.napQueued.length + props.napImprints.length}
                </span>
              </div>
              <div className={css({ minHeight: 0, overflowY: 'auto' })}>
                <div
                  className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    padding: '0 12px 10px',
                  })}
                >
                  {props.napQueued.length > 0 ? (
                    <div>
                      <p
                        className={css({
                          margin: '0 0 3px',
                          color: 'aic.textSubtle',
                          fontSize: '11px',
                        })}
                      >
                        Queued opens:
                      </p>
                      {props.napQueued.map((q) => (
                        <p
                          key={q.id}
                          className={cx(
                            monoClass,
                            css({
                              margin: 0,
                              fontSize: '10px',
                              color: 'aic.textMuted',
                            }),
                          )}
                        >
                          {q.path}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {props.napImprints.length > 0 ? (
                    <div>
                      <p
                        className={css({
                          margin: '4px 0 3px',
                          color: 'aic.textSubtle',
                          fontSize: '11px',
                        })}
                      >
                        Queued imprints:
                      </p>
                      {props.napImprints.map((q) => (
                        <p
                          key={q.id}
                          className={css({
                            margin: 0,
                            fontSize: '10px',
                            color: 'aic.textMuted',
                            lineHeight: 1.4,
                          })}
                        >
                          {q.text}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {props.napQueued.length === 0 &&
                  props.napImprints.length === 0 ? (
                    <p className={textSubtleClass}>Nothing queued</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
