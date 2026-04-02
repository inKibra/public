/**
 * Example story file for self-testing AST extraction.
 */

import type { StoryProps, StoryVariant } from '../../types';

// Default variant - basic story
export const Default = {
  meta: {
    label: 'Example Component',
    category: 'examples',
    components: ['ExampleComponent'],
  },
  review: {
    enabled: true,
  },
  vrt: {
    enabled: false,
  },
  Story: (props: StoryProps) => {
    return (
      <div>
        <h1>Example Component</h1>
        <p>This is an example story for testing AST extraction.</p>
        <button
          type="button"
          onClick={() => props.onOutput?.({ clicked: true })}
        >
          Click Me
        </button>
      </div>
    );
  },
} satisfies StoryVariant;

// WithError variant - different state
export const WithError = {
  meta: {
    label: 'Example with Error',
    category: 'examples',
    tags: ['error-state'],
  },
  review: {
    enabled: true,
    shots: {
      sequences: [
        {
          id: 'error',
          shots: [{ id: 'error-visible' }],
        },
      ],
    },
  },
  vrt: {
    enabled: true,
  },
  Story: (props: StoryProps) => {
    return (
      <div>
        <h1>Example Component</h1>
        <p style={{ color: 'red' }}>Error: Something went wrong!</p>
      </div>
    );
  },
} satisfies StoryVariant;

// Loading variant - with custom ID
export const Loading = {
  meta: {
    id: 'custom-loading-id',
    label: 'Example Loading State',
  },
  // No review/vrt - should use defaults
  Story: () => {
    return (
      <div>
        <h1>Loading...</h1>
        <div>Spinner would go here</div>
      </div>
    );
  },
} satisfies StoryVariant;
