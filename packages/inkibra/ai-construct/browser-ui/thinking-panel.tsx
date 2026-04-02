import { useEffect, useMemo, useState } from 'react';
import {
  type ConstructLiveResponseHistory,
  getLatestConstructLiveResponseAttempt,
  parseConstructDraftMessages,
} from '../live/selectors';
import { css, cx } from '../styled-system/css';
import {
  chipClass,
  chipWarningClass,
  panelClass,
  panelHeaderClass,
  panelTitleClass,
  scrollBodyClass,
  sectionLabelClass,
} from './styles';

export type ConstructThinkingPanelProps = {
  hypnoActive: boolean;
  hypnoStage: string;
  hypnoLastReviewReply?: string;
  liveResponseHistories: ConstructLiveResponseHistory[];
  selectedResponseId?: string;
  onSelectResponse?: (responseId: string) => void;
  commandInFlight: boolean;
  focused?: boolean;
};

function formatEvaluationText(args: {
  decision?: string;
  status?: string;
  reason?: string;
  schedulerDecisionText?: string;
  generateThinking?: string;
  evalDraftText?: string;
}): string {
  const parts = [
    args.reason
      ? `${args.decision ?? args.status ?? 'pending'} - ${args.reason}`
      : args.schedulerDecisionText || args.status,
    args.generateThinking,
    args.evalDraftText,
  ].filter((value): value is string => Boolean(value?.trim()));
  return parts.join('\n\n');
}

const idleEmptyClass = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  color: 'aic.textSubtle',
  fontSize: '12px',
  fontStyle: 'italic',
  padding: '16px',
  textAlign: 'center',
});

export function ConstructThinkingPanel(props: ConstructThinkingPanelProps) {
  const panelTitle = props.hypnoActive ? 'Hypno Evaluation' : 'Thinking';
  const selectedHistory = useMemo(() => {
    if (props.selectedResponseId) {
      return props.liveResponseHistories.find(
        (history) => history.responseId === props.selectedResponseId,
      );
    }
    return props.liveResponseHistories[0];
  }, [props.liveResponseHistories, props.selectedResponseId]);

  const [selectedAttemptId, setSelectedAttemptId] = useState<
    string | undefined
  >();
  useEffect(() => {
    setSelectedAttemptId(
      getLatestConstructLiveResponseAttempt(selectedHistory)?.id,
    );
  }, [selectedHistory]);

  const selectedAttemptIndex = useMemo(() => {
    if (!selectedHistory || !selectedAttemptId) return -1;
    return selectedHistory.attempts.findIndex(
      (attempt) => attempt.id === selectedAttemptId,
    );
  }, [selectedAttemptId, selectedHistory]);

  const selectedAttempt = useMemo(() => {
    if (!selectedHistory) return undefined;
    return (
      selectedHistory.attempts[selectedAttemptIndex] ??
      getLatestConstructLiveResponseAttempt(selectedHistory)
    );
  }, [selectedAttemptIndex, selectedHistory]);

  const parsedDraftMessages = useMemo(
    () => parseConstructDraftMessages(selectedAttempt?.draftText),
    [selectedAttempt?.draftText],
  );

  const currentDraftText = useMemo(() => {
    if (parsedDraftMessages.length > 0) {
      return parsedDraftMessages.map((message) => message.text).join('\n\n');
    }
    return selectedAttempt?.draftText?.trim() ?? '';
  }, [parsedDraftMessages, selectedAttempt?.draftText]);

  const currentDraftLabel = parsedDraftMessages[0]?.label ?? 'Draft';
  const currentEvaluationText = useMemo(
    () =>
      formatEvaluationText({
        decision: selectedAttempt?.decision,
        status: selectedAttempt?.status,
        reason: selectedAttempt?.reason,
        schedulerDecisionText: selectedAttempt?.schedulerDecisionText,
        generateThinking: selectedAttempt?.generateThinking,
        evalDraftText: selectedAttempt?.evalDraftText,
      }),
    [selectedAttempt],
  );

  const canGoPrev = selectedHistory ? selectedAttemptIndex > 0 : false;
  const canGoNext = selectedHistory
    ? selectedAttemptIndex >= 0 &&
      selectedAttemptIndex < selectedHistory.attempts.length - 1
    : false;
  const hasContent = Boolean(currentDraftText || currentEvaluationText);

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
        {props.hypnoActive ? (
          <span className={cx(chipClass, chipWarningClass)}>
            {props.hypnoStage}
          </span>
        ) : null}
        {props.commandInFlight && !props.hypnoActive ? (
          <span className={cx(chipClass, chipWarningClass)}>command</span>
        ) : null}
      </header>
      <div
        className={cx(
          scrollBodyClass,
          css({
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px',
          }),
        )}
      >
        {props.hypnoActive ? (
          props.hypnoLastReviewReply ? (
            <div
              className={css({
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                borderRadius: '10px',
                border: '1px solid token(colors.aic.border)',
                bg: 'rgba(255,255,255,0.02)',
                padding: '10px 12px',
              })}
            >
              <p className={sectionLabelClass}>Current Evaluation</p>
              <p
                className={css({
                  margin: 0,
                  fontSize: '11px',
                  lineHeight: 1.5,
                  color: 'aic.textMuted',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                })}
              >
                {props.hypnoLastReviewReply}
              </p>
            </div>
          ) : (
            <div className={idleEmptyClass}>Awaiting evaluation...</div>
          )
        ) : props.liveResponseHistories.length === 0 ? (
          <div className={idleEmptyClass}>
            {props.commandInFlight ? 'Command in progress...' : '(idle)'}
          </div>
        ) : selectedHistory ? (
          <>
            <div
              className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
                minWidth: 0,
              })}
            >
              <p
                className={css({
                  margin: 0,
                  minWidth: 0,
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: 'aic.textSubtle',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                })}
              >
                {selectedHistory.scheduledBy ?? selectedHistory.responseId}
              </p>
              <span className={chipClass}>{selectedHistory.status}</span>
              {selectedHistory.urgency ? (
                <span className={chipClass}>{selectedHistory.urgency}</span>
              ) : null}
            </div>

            {selectedHistory.attempts.length > 0 ? (
              <div
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  minHeight: '28px',
                })}
              >
                <button
                  type="button"
                  disabled={!canGoPrev}
                  onClick={() => {
                    if (canGoPrev && selectedHistory)
                      setSelectedAttemptId(
                        selectedHistory.attempts[selectedAttemptIndex - 1]?.id,
                      );
                  }}
                >
                  Prev
                </button>
                <span
                  className={cx(
                    chipClass,
                    css({ minWidth: '92px', justifyContent: 'center' }),
                  )}
                >
                  Attempt {Math.max(selectedAttemptIndex + 1, 1)} of{' '}
                  {selectedHistory.attempts.length}
                </span>
                <button
                  type="button"
                  disabled={!canGoNext}
                  onClick={() => {
                    if (canGoNext && selectedHistory)
                      setSelectedAttemptId(
                        selectedHistory.attempts[selectedAttemptIndex + 1]?.id,
                      );
                  }}
                >
                  Next
                </button>
                {selectedAttempt ? (
                  <span className={cx(chipClass, css({ marginLeft: 'auto' }))}>
                    {selectedAttempt.status}
                  </span>
                ) : null}
              </div>
            ) : null}

            {hasContent && selectedAttempt ? (
              <>
                <div
                  className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    minWidth: 0,
                  })}
                >
                  <p className={sectionLabelClass}>Current Draft</p>
                  {currentDraftText ? (
                    <div
                      className={css({
                        borderRadius: '12px',
                        border: '1px solid token(colors.aic.accentStrong)',
                        bg: 'aic.accentSoft',
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        maxWidth: '100%',
                        minWidth: 0,
                      })}
                    >
                      <div
                        className={css({
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          minWidth: 0,
                        })}
                      >
                        <p
                          className={css({
                            margin: 0,
                            color: 'aic.textSubtle',
                            fontSize: '11px',
                          })}
                        >
                          {currentDraftLabel}
                        </p>
                      </div>
                      <p
                        className={css({
                          margin: 0,
                          fontSize: '13px',
                          lineHeight: 1.55,
                          color: 'aic.text',
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        })}
                      >
                        {currentDraftText}
                      </p>
                    </div>
                  ) : (
                    <p
                      className={css({
                        margin: 0,
                        color: 'aic.textSubtle',
                        fontStyle: 'italic',
                        fontSize: '11px',
                      })}
                    >
                      Awaiting draft...
                    </p>
                  )}
                </div>
                <div
                  className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    minWidth: 0,
                  })}
                >
                  <p className={sectionLabelClass}>Current Evaluation</p>
                  <div
                    className={css({
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      borderRadius: '10px',
                      border: '1px solid token(colors.aic.border)',
                      bg: 'rgba(255,255,255,0.02)',
                      padding: '10px 12px',
                      minWidth: 0,
                    })}
                  >
                    {currentEvaluationText ? (
                      <p
                        className={css({
                          margin: 0,
                          fontSize: '11px',
                          lineHeight: 1.5,
                          color: 'aic.textMuted',
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        })}
                      >
                        {currentEvaluationText}
                      </p>
                    ) : (
                      <p
                        className={css({
                          margin: 0,
                          color: 'aic.textSubtle',
                          fontStyle: 'italic',
                          fontSize: '11px',
                        })}
                      >
                        Awaiting evaluation...
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className={idleEmptyClass}>
                Waiting for a live response to inspect.
              </div>
            )}
          </>
        ) : (
          <div className={idleEmptyClass}>Select a response to inspect.</div>
        )}
      </div>
    </section>
  );
}
