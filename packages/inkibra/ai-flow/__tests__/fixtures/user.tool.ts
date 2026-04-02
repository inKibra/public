/**
 * Test fixture for plugin transformation tests.
 * This file should be transformed by the codeBindingPlugin.
 */

import { defineCodeBinding } from '../../codemode';

type User = {
  id: string;
  name: string;
  email: string;
};

type Email = {
  to: string;
  subject: string;
  body: string;
};

/**
 * Fetches a user by ID from the database
 */
export const fetchUser = defineCodeBinding(async function fetchUser({
  userId,
}: {
  userId: string;
}): Promise<User> {
  // Mock implementation
  return {
    id: userId,
    name: 'Test User',
    email: 'test@example.com',
  };
});

/**
 * Sends an email to a recipient
 */
export const sendEmail = defineCodeBinding(async function sendEmail({
  to,
  subject,
  body,
}: Email): Promise<{
  sent: boolean;
  messageId: string;
}> {
  // Mock implementation - use params to avoid unused warnings
  console.log(
    `Sending to: ${to}, subject: ${subject}, body length: ${body.length}`,
  );
  return {
    sent: true,
    messageId: `msg-${Date.now()}`,
  };
});

/**
 * A simple sync function without parameters
 */
export const getServerTime = defineCodeBinding(
  async function getServerTime(): Promise<string> {
    return new Date().toISOString();
  },
);

// Helper to simulate internal usage - not transformed because it's not a defineCodeBinding binding
export const internalHelper = async (): Promise<void> => {
  // Arrow functions and const declarations are not transformed by the plugin
  // unless explicitly wrapped in defineCodeBinding(...)
};
