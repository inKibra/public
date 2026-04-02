/**
 * Split a construct response into multiple messages.
 *
 * Splits on triple-or-more consecutive newlines (deliberate message breaks).
 * Standard paragraph spacing (double newline) stays within a single message.
 * Also supports legacy `\n---\n` separator format.
 */
export function splitConstructResponseMessages(
  content: string,
  maxMessages: number,
): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  // Legacy format: MESSAGE 1: ... --- MESSAGE 2: ...
  const legacy = splitLegacyConstructMessages(normalized, maxMessages);
  if (legacy.length > 1) {
    return legacy;
  }
  // Split on 3+ consecutive newlines, but not inside fenced code blocks.
  const messages: string[] = [];
  let current: string[] = [];
  let insideFence = false;
  let blankCount = 0;

  for (const line of normalized.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      insideFence = !insideFence;
      blankCount = 0;
      current.push(line);
      continue;
    }

    if (!insideFence && line.trim() === '') {
      blankCount++;
      if (blankCount >= 2 && current.length > 0) {
        const text = current.join('\n').trim();
        if (text) messages.push(text);
        current = [];
        blankCount = 0;
        if (messages.length >= maxMessages) return messages;
        continue;
      }
      current.push(line);
      continue;
    }

    blankCount = 0;
    current.push(line);
  }

  const remaining = current.join('\n').trim();
  if (remaining && messages.length < maxMessages) {
    messages.push(remaining);
  }

  return messages.length > 0 ? messages : [normalized];
}

function splitLegacyConstructMessages(
  content: string,
  maxMessages: number,
): string[] {
  const blocks = content
    .split(/\n---\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) {
    return [content.trim()];
  }

  const messages: string[] = [];
  for (const block of blocks) {
    const cleaned = block.replace(/^MESSAGE\s+\d+:\s*/i, '').trim();
    if (cleaned) {
      messages.push(cleaned);
    }
    if (messages.length >= maxMessages) {
      break;
    }
  }

  return messages;
}
