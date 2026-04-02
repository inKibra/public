/**
 * Storybook config for self-testing.
 */

import { defineStorybookConfig } from '../../config';

export default defineStorybookConfig({
  rules: [{ pattern: '*.story.tsx', kind: 'component' }],
});
