/**
 * Example workflows demonstrating the @inkibra/workflow system
 */

import {
  complete,
  defineWorkflow,
  sleep,
  stage,
  waitFor,
  withCapture,
} from './index';
import type { Snapshot } from './types';

type UserOnboardingSnapshot = Snapshot<{
  email: string;
  name: string;
  userId?: string;
  createdAt?: string;
}>;

type DocumentApprovalSnapshot = Snapshot<{
  documentId: string;
  recipientEmail: string;
  invoiceId?: string;
  createdAt?: string;
}>;

type ProjectLaunchSnapshot = Snapshot<{
  projectId: string;
  name: string;
  createdAt?: string;
}>;

/**
 * Example 1: Simple sequential workflow with sleep
 */
export const userOnboarding = defineWorkflow<UserOnboardingSnapshot>(
  'userOnboarding',
  {
    start: stage(async (input: UserOnboardingSnapshot) => {
      // Create user account
      const userId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      console.log('Creating user:', input.email);

      return {
        snapshot: {
          userId,
          email: input.email,
          name: input.name,
          createdAt,
        },
        next: 'sendWelcome',
      };
    }),

    sendWelcome: stage(async (snap) => {
      console.log('Sending welcome email to:', snap.email);

      // In real implementation, send email here
      // await sendEmail(snap.email, 'Welcome!', ...);

      return sleep('7 days', {
        snapshot: snap,
        next: 'sendFollowUp',
      });
    }),

    sendFollowUp: stage(async (snap) => {
      console.log('Sending follow-up email to:', snap.email);

      // In real implementation, send follow-up email
      // await sendEmail(snap.email, 'How are you doing?', ...);

      return complete({
        result: {
          userId: snap.userId ?? 'unknown',
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      });
    }),
  },
);

/**
 * Example 2: Event-driven workflow with waitFor
 */
export const documentApproval = defineWorkflow<DocumentApprovalSnapshot>(
  'documentApproval',

  // Event declarations
  {
    events: {
      documentSigned: withCapture<Snapshot<{ documentId: string }>>(
        (snap) => `document:${snap.documentId}:signed`,
      ),
      paymentReceived: withCapture<DocumentApprovalSnapshot>(
        (snap) => `payment:${snap.invoiceId}:received`,
      ),
    },
  },

  // Stages
  {
    start: stage(async (input: DocumentApprovalSnapshot) => {
      const invoiceId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      console.log('Starting document approval for:', input.documentId);

      return {
        snapshot: {
          documentId: input.documentId,
          recipientEmail: input.recipientEmail,
          invoiceId,
          createdAt,
        },
        next: 'sendForSignature',
      };
    }),

    sendForSignature: stage(async (snap, runtime) => {
      console.log('Sending document for signature:', snap.documentId);

      // In real implementation, send document
      // await sendDocumentForSignature(snap.documentId, snap.recipientEmail);

      if (!runtime) {
        throw new Error('Runtime context required for event operations');
      }

      const documentSigned = runtime.events.documentSigned;
      if (!documentSigned) {
        throw new Error('documentSigned event not configured');
      }

      return waitFor({
        token: documentSigned.capture(snap),
        snapshot: snap,
        timeout: sleep('14 days', {
          snapshot: snap,
          next: 'escalateSignature',
        }),
      });
    }),

    escalateSignature: stage(async (snap) => {
      console.log('Escalating unsigned document:', snap.documentId);

      return complete({
        result: {
          status: 'timeout',
          reason: 'Document not signed within 14 days',
        },
      });
    }),

    documentSignedHandler: stage(async (snap, runtime) => {
      console.log('Document signed:', snap.documentId);

      // Generate invoice
      console.log('Generating invoice:', snap.invoiceId ?? 'unknown');

      if (!runtime) {
        throw new Error('Runtime context required for event operations');
      }

      const paymentReceived = runtime.events.paymentReceived;
      if (!paymentReceived) {
        throw new Error('paymentReceived event not configured');
      }

      return waitFor({
        token: paymentReceived.capture(snap),
        snapshot: snap,
        timeout: sleep('30 days', { snapshot: snap, next: 'escalatePayment' }),
      });
    }),

    escalatePayment: stage(async (snap) => {
      console.log('Escalating unpaid invoice:', snap.invoiceId ?? 'unknown');

      return complete({
        result: {
          status: 'timeout',
          reason: 'Payment not received within 30 days',
        },
      });
    }),

    paymentReceivedHandler: stage(async (snap) => {
      console.log('Payment received for invoice:', snap.invoiceId ?? 'unknown');

      return complete({
        result: {
          status: 'completed',
          documentId: snap.documentId,
          invoiceId: snap.invoiceId ?? 'unknown',
          completedAt: new Date().toISOString(),
        },
      });
    }),
  },
);

/**
 * Example 3: Workflow with multiple event coordination
 */
export const projectLaunch = defineWorkflow<ProjectLaunchSnapshot>(
  'projectLaunch',

  {
    events: {
      designApproved: withCapture<Snapshot<{ projectId: string }>>(
        (snap) => `project:${snap.projectId}:design:approved`,
      ),
      codeReviewed: withCapture<ProjectLaunchSnapshot>(
        (snap) => `project:${snap.projectId}:code:reviewed`,
      ),
      testsPassed: withCapture<ProjectLaunchSnapshot>(
        (snap) => `project:${snap.projectId}:tests:passed`,
      ),
    },
  },

  {
    start: stage(async (input: ProjectLaunchSnapshot) => {
      console.log('Starting project launch:', input.projectId);

      return {
        snapshot: {
          projectId: input.projectId,
          name: input.name,
          createdAt: new Date().toISOString(),
        },
        next: 'waitForApprovals',
      };
    }),

    waitForApprovals: stage(async (snap, runtime) => {
      console.log('Waiting for all approvals for project:', snap.projectId);

      if (!runtime) {
        throw new Error('Runtime context required for event operations');
      }

      const designApproved = runtime.events.designApproved;
      const codeReviewed = runtime.events.codeReviewed;
      const testsPassed = runtime.events.testsPassed;
      if (!designApproved || !codeReviewed || !testsPassed) {
        throw new Error('Required project launch events are not configured');
      }

      // Wait for all three events before proceeding
      return waitFor.all(
        [
          designApproved.capture(snap),
          codeReviewed.capture(snap),
          testsPassed.capture(snap),
        ],
        {
          snapshot: snap,
          timeout: sleep('7 days', { snapshot: snap, next: 'escalate' }),
        },
      );
    }),

    escalate: stage(async (snap) => {
      console.log('Escalating delayed project:', snap.projectId);

      return complete({
        result: {
          status: 'timeout',
          reason: 'Not all approvals received within 7 days',
        },
      });
    }),

    deploy: stage(async (snap) => {
      console.log('Deploying project:', snap.projectId);

      // In real implementation, trigger deployment
      // await deployProject(snap.projectId);

      return complete({
        result: {
          status: 'deployed',
          projectId: snap.projectId,
          deployedAt: new Date().toISOString(),
        },
      });
    }),
  },
);
