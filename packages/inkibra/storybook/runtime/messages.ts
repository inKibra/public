/**
 * @inkibra/storybook - Runtime Message Protocol
 *
 * Defines the postMessage protocol between iframe (story) and parent (chrome).
 */

// ============================================================================
// Shared Runtime Constants
// ============================================================================

/**
 * DOM id for the controls host rendered by the chrome app.
 * Iframe stories can portal interactive controls into this node.
 */
export const SB_CONTROLS_HOST_ID = '__sb-controls-root';

/**
 * Browser CustomEvent names emitted by iframe runtime.
 * Useful for Playwright and integration tests without private globals.
 */
export const SB_EVENT_READY = 'sb:ready';
export const SB_EVENT_OUTPUT = 'sb:output';
export const SB_EVENT_ERROR = 'sb:error';

// ============================================================================
// Message Types: Iframe → Parent
// ============================================================================

/**
 * Story has mounted and is ready.
 */
export type SbReadyMessage = {
  type: 'SB_READY';
  storyId: string;
  sessionId?: string;
};

/**
 * Story emitted output via onOutput callback.
 */
export type SbOutputMessage = {
  type: 'SB_OUTPUT';
  storyId: string;
  data: unknown;
  timestamp: number;
  sessionId?: string;
};

/**
 * Story registered an input panel.
 */
export type SbRegisterInputMessage = {
  type: 'SB_REGISTER_INPUT';
  storyId: string;
  hasPanel: boolean;
  sessionId?: string;
  panelHtml?: string;
  panelText?: string;
};

/**
 * Story encountered an error.
 */
export type SbErrorMessage = {
  type: 'SB_ERROR';
  storyId: string;
  message: string;
  stack?: string;
  sessionId?: string;
};

/**
 * All messages sent from iframe to parent.
 */
export type IframeToParentMessage =
  | SbReadyMessage
  | SbOutputMessage
  | SbRegisterInputMessage
  | SbErrorMessage;

// ============================================================================
// Message Types: Parent → Iframe
// ============================================================================

/**
 * Parent instructs iframe to load a story.
 * (Optional - can also just set iframe src)
 */
export type SbSetStoryMessage = {
  type: 'SB_SET_STORY';
  storyId: string;
};

/**
 * All messages sent from parent to iframe.
 */
export type ParentToIframeMessage = SbSetStoryMessage;

// ============================================================================
// Type Guards
// ============================================================================

const IFRAME_MESSAGE_TYPES = [
  'SB_READY',
  'SB_OUTPUT',
  'SB_REGISTER_INPUT',
  'SB_ERROR',
] as const;

/**
 * Check if a message is a valid iframe→parent message.
 */
export function isIframeMessage(data: unknown): data is IframeToParentMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { type?: unknown };
  return (
    typeof msg.type === 'string' &&
    IFRAME_MESSAGE_TYPES.includes(
      msg.type as (typeof IFRAME_MESSAGE_TYPES)[number],
    )
  );
}

/**
 * Post a message to the parent window.
 */
export function postToParent(message: IframeToParentMessage): void {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, '*');
  }
}

/**
 * Post a message to an iframe.
 */
export function postToIframe(
  iframe: HTMLIFrameElement,
  message: ParentToIframeMessage,
): void {
  iframe.contentWindow?.postMessage(message, '*');
}
