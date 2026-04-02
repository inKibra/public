import type { ChangeEvent, KeyboardEvent, Ref } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ConstructLabAction } from '../lab/types';
import { css, cx } from '../styled-system/css';
import { chipAccentClass, chipClass, chipWarningClass } from './styles';

export type ConstructInputBarProps = {
  hypnoActive: boolean;
  hypnoStage: string;
  onAction: (action: ConstructLabAction) => void;
  activeLane?: string;
  availableLanes?: string[];
  onSelectLane?: (lane: string) => void;
  commandInFlight?: boolean;
  /** When true, the bar is locked — shown while edit mode is active. */
  editModeActive?: boolean;
};

type CommandContext = Pick<
  ConstructInputBarProps,
  'activeLane' | 'hypnoActive'
>;

type CommandDef = {
  name: string;
  description: string;
  execute: (
    args: string,
    onAction: ConstructInputBarProps['onAction'],
    context: CommandContext,
  ) => void;
  when?: (context: CommandContext) => boolean;
};

const COMMANDS: CommandDef[] = [
  {
    name: 'nap',
    description: 'Trigger a nap cycle',
    execute: (_args, onAction) => onAction({ action: 'nap' }),
  },
  {
    name: 'hypno',
    description: 'Start a hypno session',
    execute: (_args, onAction) => onAction({ action: 'startHypno' }),
    when: (p) => !p.hypnoActive,
  },
  {
    name: 'update',
    description: 'Apply the current hypno plan',
    execute: (_args, onAction) => onAction({ action: 'updateHypno' }),
    when: (p) => p.hypnoActive,
  },
  {
    name: 'accept',
    description: 'Accept and commit hypno changes',
    execute: (_args, onAction) => onAction({ action: 'acceptHypno' }),
    when: (p) => p.hypnoActive,
  },
  {
    name: 'cancel',
    description: 'Cancel the hypno session',
    execute: (_args, onAction) => onAction({ action: 'cancelHypno' }),
    when: (p) => p.hypnoActive,
  },
  {
    name: 'steer',
    description: 'Send a steering directive',
    execute: (args, onAction, props) => {
      const lane = props.activeLane?.trim();
      if (!args.trim() || !lane) return;
      onAction({ action: 'steer', directive: args.trim(), lane });
    },
  },
  {
    name: 'rate',
    description: 'Rate the last response',
    execute: (args, onAction, props) => {
      const lane = props.activeLane?.trim();
      if (!lane) return;
      const rating =
        args.trim().toLowerCase() === 'unhelpful' ? 'unhelpful' : 'helpful';
      onAction({ action: 'rate', rating, lane });
    },
  },
  {
    name: 'pin',
    description: 'Pin a file to context on next nap',
    execute: (args, onAction) => {
      if (args.trim())
        onAction({
          action: 'queueNextNapPin',
          path: args.trim(),
        });
    },
  },
  {
    name: 'queue-imprint',
    description: 'Queue an imprint for next nap',
    execute: (args, onAction) => {
      if (args.trim())
        onAction({ action: 'queueNextNapImprint', text: args.trim() });
    },
  },
];

function InputEl(props: {
  ref?: Ref<HTMLTextAreaElement>;
  className?: string;
  placeholder?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return <textarea rows={1} {...props} />;
}

export function buildChatAction(
  message: string,
  activeLane?: string,
): Extract<ConstructLabAction, { action: 'chat' }> {
  return {
    action: 'chat',
    message,
    lane: activeLane?.trim() || 'conversation',
  };
}

export function ConstructInputBar(props: ConstructInputBarProps) {
  const {
    activeLane,
    availableLanes,
    commandInFlight,
    editModeActive,
    hypnoActive,
    hypnoStage,
    onAction,
    onSelectLane,
  } = props;
  const [value, setValue] = useState('');
  const [showOverlay, setShowOverlay] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [laneDropdownOpen, setLaneDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const laneBtnRef = useRef<HTMLButtonElement | null>(null);
  const laneDropdownRef = useRef<HTMLDivElement | null>(null);

  const isCommand = value.startsWith(':');
  const commandQuery = isCommand
    ? (value.slice(1).split(' ')[0]?.toLowerCase() ?? '')
    : '';
  const commandContext = useMemo<CommandContext>(
    () => ({ activeLane, hypnoActive }),
    [activeLane, hypnoActive],
  );
  const visibleCommands = useMemo(
    () => COMMANDS.filter((cmd) => !cmd.when || cmd.when(commandContext)),
    [commandContext],
  );
  const filteredCommands = useMemo(() => {
    if (!isCommand) return [];
    if (commandQuery === '') return visibleCommands;
    return visibleCommands.filter((cmd) => cmd.name.startsWith(commandQuery));
  }, [isCommand, commandQuery, visibleCommands]);

  const laneLabel = activeLane?.trim() || 'conversation';
  const selectableLanes = availableLanes ?? [];
  const showLaneSelector =
    selectableLanes.length > 0 && typeof onSelectLane === 'function';

  useEffect(() => {
    setShowOverlay(isCommand && filteredCommands.length > 0);
    setSelectedIdx(0);
    if (isCommand) {
      setLaneDropdownOpen(false);
    }
  }, [isCommand, filteredCommands.length]);

  useEffect(() => {
    if (!laneDropdownOpen) return;
    const handler = (event: MouseEvent) => {
      if (
        laneBtnRef.current?.contains(event.target as Node) ||
        laneDropdownRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setLaneDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [laneDropdownOpen]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (isCommand) {
      const parts = trimmed.slice(1).split(' ');
      const cmdName = parts[0]?.toLowerCase() ?? '';
      const cmdArgs = parts.slice(1).join(' ');
      const cmd = visibleCommands.find((c) => c.name === cmdName);
      if (cmd) cmd.execute(cmdArgs, onAction, commandContext);
    } else if (hypnoActive) {
      onAction({ action: 'chatHypnoReview', text: trimmed });
    } else {
      onAction(buildChatAction(trimmed, activeLane));
    }

    setValue('');
    setShowOverlay(false);
  }, [
    value,
    isCommand,
    visibleCommands,
    onAction,
    commandContext,
    hypnoActive,
    activeLane,
  ]);

  const executeCommand = useCallback(
    (cmd: CommandDef) => {
      const parts = value.slice(1).split(' ');
      const cmdArgs = parts.slice(1).join(' ');
      cmd.execute(cmdArgs, onAction, commandContext);
      setValue('');
      setShowOverlay(false);
    },
    [value, onAction, commandContext],
  );

  // Auto-resize textarea when the input value changes.

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const key = e?.key;
      if (key === 'Enter') {
        if (showOverlay) {
          // Command overlay: Enter selects the highlighted command
          e.preventDefault();
          const selectedCommand = filteredCommands[selectedIdx];
          if (selectedCommand) executeCommand(selectedCommand);
        }
        // Otherwise: let Enter produce a newline (default textarea behavior)
      } else if (key === 'ArrowUp' && showOverlay) {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (key === 'ArrowDown' && showOverlay) {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(filteredCommands.length - 1, i + 1));
      } else if (key === 'Escape') {
        setShowOverlay(false);
      }
    },
    [showOverlay, filteredCommands, selectedIdx, executeCommand],
  );

  const placeholder = hypnoActive
    ? `Hypno review (${hypnoStage}) — chat to discuss, :update to apply, :accept to commit`
    : 'Type a message or : for commands';

  if (editModeActive) {
    return (
      <div
        className={css({
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: '14px',
          border: '1px solid rgba(245,158,11,0.35)',
          bg: 'rgba(245,158,11,0.04)',
        })}
      >
        <span className={cx(chipClass, chipWarningClass)}>edit mode</span>
        <span
          className={css({
            fontSize: '12px',
            color: 'aic.textSubtle',
            fontStyle: 'italic',
          })}
        >
          Lab paused — editing context files. Exit edit mode to resume.
        </span>
      </div>
    );
  }

  if (commandInFlight && !hypnoActive) {
    return (
      <div
        className={css({
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: '14px',
          border: '1px solid rgba(125,211,252,0.28)',
          bg: 'rgba(125,211,252,0.05)',
        })}
      >
        <span className={cx(chipClass, chipAccentClass)}>running</span>
        <span
          className={css({
            fontSize: '12px',
            color: 'aic.textSubtle',
            fontStyle: 'italic',
          })}
        >
          Command in progress — wait for the nap cycle to finish.
        </span>
      </div>
    );
  }

  return (
    <div
      className={css({
        display: 'flex',
        alignItems: 'flex-end',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '14px',
        border: '1px solid token(colors.aic.border)',
        bg: 'aic.panel',
        position: 'relative',
      })}
    >
      {showOverlay ? (
        <div
          className={css({
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: '4px',
            border: '1px solid token(colors.aic.border)',
            borderRadius: '12px',
            bg: 'aic.panel',
            overflow: 'hidden',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
            zIndex: 50,
          })}
        >
          <div
            className={css({
              padding: '8px 12px',
              borderBottom: '1px solid token(colors.aic.border)',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'aic.textSubtle',
            })}
          >
            Commands
          </div>
          {filteredCommands.map((cmd, i) => (
            <div
              key={cmd.name}
              className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 12px',
                cursor: 'pointer',
                bg: i === selectedIdx ? 'aic.accentSoft' : 'transparent',
              })}
              onMouseEnter={() => setSelectedIdx(i)}
              onClick={() => executeCommand(cmd)}
            >
              <p
                className={css({
                  margin: 0,
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'aic.text',
                  fontFamily: 'monospace',
                })}
              >
                :{cmd.name}
              </p>
              <p
                className={css({
                  margin: 0,
                  fontSize: '11px',
                  color: 'aic.textMuted',
                  flex: 1,
                })}
              >
                {cmd.description}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {hypnoActive ? (
        <span className={cx(chipClass, chipWarningClass)}>{hypnoStage}</span>
      ) : null}

      {showLaneSelector ? (
        <div className={css({ position: 'relative', flexShrink: 0 })}>
          <button
            ref={laneBtnRef}
            type="button"
            title="Steering and feedback commands use this lane."
            className={css({
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              height: '28px',
              padding: '0 10px',
              borderRadius: '999px',
              border: '1px solid token(colors.aic.border)',
              bg: 'rgba(255,255,255,0.04)',
              color: 'aic.textMuted',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
            })}
            onClick={() => setLaneDropdownOpen((open) => !open)}
          >
            <span>Lane</span>
            <span
              className={css({
                color: 'aic.text',
                fontFamily: 'monospace',
              })}
            >
              {laneLabel}
            </span>
            <span>▾</span>
          </button>
          {laneDropdownOpen && laneBtnRef.current ? (
            <div
              ref={laneDropdownRef}
              style={{
                bottom: 'calc(100% + 6px)',
                left: 0,
              }}
              className={css({
                position: 'absolute',
                minWidth: '160px',
                padding: '4px',
                borderRadius: '10px',
                border: '1px solid token(colors.aic.border)',
                bg: 'aic.panel',
                boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
                zIndex: 60,
              })}
            >
              {selectableLanes.map((lane) => (
                <button
                  key={lane}
                  type="button"
                  onClick={() => {
                    onSelectLane?.(lane);
                    setLaneDropdownOpen(false);
                  }}
                  className={css({
                    display: 'block',
                    width: '100%',
                    padding: '6px 8px',
                    border: 'none',
                    borderRadius: '6px',
                    bg: lane === laneLabel ? 'aic.accentSoft' : 'transparent',
                    color: lane === laneLabel ? 'aic.accent' : 'aic.textMuted',
                    fontSize: '11px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                  })}
                >
                  {lane}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <InputEl
        ref={inputRef}
        className={css({
          flex: 1,
          minHeight: '34px',
          maxHeight: '160px',
          bg: 'transparent',
          border: 'none',
          color: 'aic.text',
          fontSize: '13px',
          outline: 'none',
          resize: 'none',
          lineHeight: '1.4',
          overflow: 'auto',
        })}
        placeholder={placeholder}
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
          setValue(e.currentTarget.value)
        }
        onKeyDown={handleKeyDown}
      />

      {!isCommand ? (
        <button
          type="button"
          className={css({
            minWidth: '32px',
            height: '32px',
            borderRadius: '8px',
            border: '1px solid token(colors.aic.accentStrong)',
            bg: 'aic.accent',
            color: 'black',
            cursor: value.trim() ? 'pointer' : 'default',
            opacity: value.trim() ? 1 : 0.4,
            flexShrink: 0,
          })}
          disabled={!value.trim()}
          onClick={submit}
        >
          Send
        </button>
      ) : null}

      {!showOverlay && !isCommand ? (
        <div
          className={css({
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'aic.textSubtle',
            fontSize: '10px',
            cursor: 'pointer',
            flexShrink: 0,
          })}
          onClick={() => {
            setValue(':');
            inputRef.current?.focus?.();
          }}
        >
          <span>^</span>
          <span className={css({ fontFamily: 'monospace' })}>:</span>
        </div>
      ) : null}
    </div>
  );
}
