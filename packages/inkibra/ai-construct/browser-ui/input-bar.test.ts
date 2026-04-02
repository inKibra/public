import { describe, expect, test } from 'bun:test';
import { buildChatAction } from './input-bar';

describe('buildChatAction', () => {
  test('uses the selected input lane for chat actions', () => {
    expect(buildChatAction('hello there', 'agent:frontend')).toEqual({
      action: 'chat',
      message: 'hello there',
      lane: 'agent:frontend',
    });
  });

  test('falls back to the conversation lane when no active lane is set', () => {
    expect(buildChatAction('hello there')).toEqual({
      action: 'chat',
      message: 'hello there',
      lane: 'conversation',
    });
  });

  test('trims the active lane before dispatching', () => {
    expect(buildChatAction('hello there', '  agent:reviewer  ')).toEqual({
      action: 'chat',
      message: 'hello there',
      lane: 'agent:reviewer',
    });
  });
});
