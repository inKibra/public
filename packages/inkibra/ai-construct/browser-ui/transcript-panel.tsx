import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { deriveTranscriptEntryDeliveryStatus } from '../live/delivery-state';
import type { ConstructSnapshotTranscriptMessage } from '../live/snapshot-types';
import { css, cx } from '../styled-system/css';
import {
  chipAccentClass,
  chipClass,
  chipWarningClass,
  panelClass,
  panelHeaderClass,
  panelTitleClass,
  scrollBodyClass,
} from './styles';

type TranscriptMessage = ConstructSnapshotTranscriptMessage;

export type ConstructTranscriptPanelBodyProps = {
  transcript: TranscriptMessage[];
  hypnoActive: boolean;
  commandInFlight: boolean;
  runtimeNotices?: Array<{
    id: string;
    level: 'warning' | 'error';
    message: string;
  }>;
};

export type ConstructTranscriptPanelProps =
  ConstructTranscriptPanelBodyProps & {
    focused?: boolean;
    title?: string;
  };

const roleLabel = {
  user: 'You',
  assistant: 'Construct',
  system: 'System',
} as const;

// Bubble variant styles hoisted to top-level so panda can statically extract them.
const bubbleBase = css({
  borderRadius: '12px',
  padding: '12px',
  maxWidth: '88%',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
});

const bubbleHypnoUserClass = css({
  bg: 'rgba(245,158,11,0.08)',
  border: '1px solid rgba(245,158,11,0.22)',
  alignSelf: 'flex-start',
});

const bubbleHypnoConstructClass = css({
  bg: 'rgba(245,158,11,0.08)',
  border: '1px solid rgba(245,158,11,0.22)',
  alignSelf: 'flex-end',
});

const bubbleUserClass = css({
  bg: 'rgba(59,130,246,0.10)',
  border: '1px solid rgba(59,130,246,0.18)',
  alignSelf: 'flex-start',
});

const bubbleAssistantClass = css({
  bg: 'rgba(125,211,252,0.07)',
  border: '1px solid token(colors.aic.accentStrong)',
  alignSelf: 'flex-end',
});

const bubbleSystemClass = css({
  bg: 'rgba(255,255,255,0.03)',
  border: '1px solid token(colors.aic.border)',
  alignSelf: 'center',
  maxWidth: '94%',
});

function bubbleClass(msg: TranscriptMessage): string {
  if (msg.kind === 'hypno-review') {
    return cx(
      bubbleBase,
      msg.role === 'user' ? bubbleHypnoUserClass : bubbleHypnoConstructClass,
    );
  }
  if (msg.role === 'user') {
    return cx(bubbleBase, bubbleUserClass);
  }
  if (msg.role === 'assistant') {
    return cx(bubbleBase, bubbleAssistantClass);
  }
  return cx(bubbleBase, bubbleSystemClass);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function kindChip(kind: TranscriptMessage['kind']): ReactNode {
  if (kind === 'hypno-review') {
    return <span className={cx(chipClass, chipWarningClass)}>hypno</span>;
  }
  if (kind === 'tool') {
    return <span className={chipClass}>tool</span>;
  }
  if (kind === 'decision') {
    return <span className={chipClass}>decision</span>;
  }
  return null;
}

function deliveryStatusIcon(msg: TranscriptMessage): ReactNode {
  if (msg.role !== 'user' || msg.kind !== 'chat') return null;
  const status = deriveTranscriptEntryDeliveryStatus(msg);
  const baseClass = css({
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: '2px',
    fontSize: '11px',
  });
  switch (status) {
    case 'sending':
      return (
        <span
          className={cx(baseClass, css({ color: 'rgba(255,255,255,0.4)' }))}
        >
          ...
        </span>
      );
    case 'sent':
      return (
        <span
          className={cx(baseClass, css({ color: 'rgba(255,255,255,0.45)' }))}
        >
          v
        </span>
      );
    case 'seen':
      return (
        <span className={cx(baseClass, css({ color: 'aic.success' }))}>vv</span>
      );
    case 'durable':
      return (
        <span className={cx(baseClass, css({ color: 'aic.accent' }))}>vv</span>
      );
    default:
      return null;
  }
}

export function isTranscriptTimestampDurable(
  transcript: TranscriptMessage[],
  index: number,
): boolean {
  const msg = transcript[index];
  if (!msg) return false;
  if (msg.role === 'user' && msg.kind === 'chat') {
    return deriveTranscriptEntryDeliveryStatus(msg) === 'durable';
  }
  if (msg.role === 'assistant') {
    for (let i = index - 1; i >= 0; i -= 1) {
      const prev = transcript[i];
      if (!prev) continue;
      if (prev.role === 'user' && prev.kind === 'chat') {
        return deriveTranscriptEntryDeliveryStatus(prev) === 'durable';
      }
    }
  }
  return false;
}

/**
 * The scrollable body of the transcript — reusable inside the tabbed center workspace.
 */
export function ConstructTranscriptPanelBody(
  props: ConstructTranscriptPanelBodyProps,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const transcriptCount = props.transcript.length;

  useEffect(() => {
    void transcriptCount;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [transcriptCount]);

  return (
    <div
      ref={scrollRef}
      className={cx(
        scrollBodyClass,
        css({
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
        }),
      )}
    >
      {props.transcript.length === 0 &&
      (!props.runtimeNotices || props.runtimeNotices.length === 0) ? (
        <div
          className={css({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'aic.textSubtle',
            fontSize: '13px',
            fontStyle: 'italic',
          })}
        >
          No transcript yet.
        </div>
      ) : (
        <div
          className={css({
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '14px',
          })}
        >
          {props.runtimeNotices?.map((notice) => (
            <div
              key={notice.id}
              className={css({
                borderRadius: '10px',
                padding: '8px 10px',
                fontSize: '12px',
                border: '1px solid',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                maxWidth: '100%',
                borderColor:
                  notice.level === 'error'
                    ? 'rgba(239,68,68,0.5)'
                    : 'rgba(245,158,11,0.45)',
                bg:
                  notice.level === 'error'
                    ? 'rgba(239,68,68,0.12)'
                    : 'rgba(245,158,11,0.12)',
                color: notice.level === 'error' ? 'aic.error' : 'aic.warning',
              })}
            >
              {notice.message}
            </div>
          ))}
          {props.transcript.map((msg, index) => {
            const durableTs = isTranscriptTimestampDurable(
              props.transcript,
              index,
            );
            return (
              <div key={msg.id} className={bubbleClass(msg)}>
                <div
                  className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '2px',
                  })}
                >
                  <strong
                    className={css({
                      fontSize: '11px',
                      color: 'aic.textMuted',
                    })}
                  >
                    {roleLabel[msg.role]}
                  </strong>
                  {kindChip(msg.kind)}
                  {msg.lane && msg.lane !== 'conversation' ? (
                    <span
                      className={css({
                        fontSize: '8px',
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        bg: 'rgba(100, 200, 255, 0.15)',
                        color: 'rgba(100, 200, 255, 0.8)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      })}
                    >
                      {msg.lane}
                    </span>
                  ) : null}
                </div>
                <p
                  className={css({
                    margin: 0,
                    fontSize: '13px',
                    lineHeight: 1.55,
                    color: 'aic.text',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  })}
                >
                  {msg.content}
                </p>
                <p
                  className={css({
                    margin: 0,
                    fontSize: '10px',
                    color: durableTs ? 'aic.accent' : 'aic.textSubtle',
                    alignSelf: 'flex-end',
                    marginTop: '2px',
                  })}
                >
                  {formatTime(msg.createdAt)} {deliveryStatusIcon(msg)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Standalone transcript panel — panel shell + header + body.
 * Use ConstructTranscriptPanelBody directly when embedding inside another panel.
 */
export function ConstructTranscriptPanel(props: ConstructTranscriptPanelProps) {
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
      <div className={panelHeaderClass}>
        <h3 className={panelTitleClass}>{props.title ?? 'Transcript'}</h3>
        {props.hypnoActive ? (
          <span className={cx(chipClass, chipWarningClass)}>hypno active</span>
        ) : null}
        {props.commandInFlight ? (
          <span className={cx(chipClass, chipAccentClass)}>running</span>
        ) : null}
      </div>
      <ConstructTranscriptPanelBody
        transcript={props.transcript}
        hypnoActive={props.hypnoActive}
        commandInFlight={props.commandInFlight}
        runtimeNotices={props.runtimeNotices}
      />
    </section>
  );
}
