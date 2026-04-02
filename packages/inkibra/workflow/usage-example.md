# @inkibra/workflow - Usage Examples

This document provides comprehensive examples of how to use the @inkibra/workflow system.

## Setup

### 0. Function Workflow DX (OpenWorkflow-style) with Concurrency + Cron

```typescript
import { createLogger } from '@inkibra/logger';
import {
  createWorkflowSystem,
  DalWorkflowStorage,
  createRedisWorkflowConcurrencyManager,
  event,
  workflow,
} from '@inkibra/workflow';
import { createDriver } from '@inkibra/dal-connection';
import Redis from 'ioredis';

const logger = createLogger({ level: 'info' });
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
});

const driver = await createDriver({
  databaseUrl: process.env.DATABASE_URL,
});
const storage = new DalWorkflowStorage(driver, logger);
await storage.initialize();

const concurrencyManager = createRedisWorkflowConcurrencyManager(redis, {
  prefix: 'workflow:concurrency',
});

const system = await createWorkflowSystem({
  storage,
  logger,
  redis,
  queueName: 'workflow-jobs',
  workerConcurrency: 20,
  startWorker: true,
  runtimeOptions: {
    concurrency: {
      manager: concurrencyManager,
      leaseMs: 30_000,
      retryDelayMs: 1_000,
      workflows: {
        userSignup: 50, // max active executions for this workflow type
      },
      resources: {
        'send-email': 10, // max active send-email steps globally
      },
    },
  },
});

await system.queue.setGlobalConcurrency(100);

export const userSignup = workflow(
  {
    name: 'userSignup',
    version: '2.0.0',
    events: {
      welcomeOpened: event<{ userId: string }>(
        (snap) => `welcome:${snap.userId}:opened`,
      ),
    },
  },
  async ({ input, step, events }) => {
    const user = await step.run({ name: 'create-user' }, async () => {
      return await createUser(input.email);
    });

    await step.run(
      { name: 'send-welcome-email', resource: 'send-email' },
      async () => {
        await sendWelcomeEmail(user.email);
        return { sent: true };
      },
    );

    const wait = await step.waitForAny({
      name: 'wait-for-open',
      tokens: [events.welcomeOpened.token({ userId: user.id })],
      timeout: '7 days',
    });

    if (wait.timedOut) {
      await step.run(
        { name: 'send-followup', resource: 'send-email' },
        async () => {
          await sendFollowupEmail(user.email);
          return { followup: true };
        },
      );
    }

    return { status: 'done', userId: user.id };
  },
);

// Start immediately (queued)
await system.queue.scheduleStart(userSignup.name, userSignup.version, {
  email: 'user@example.com',
});

// Run on cron (misfires skip to latest)
await system.scheduler.upsert({
  id: 'daily-user-signup-reminder',
  workflow: userSignup,
  input: { email: 'batch@example.com' },
  pattern: '0 9 * * *',
  tz: 'America/New_York',
  misfirePolicy: 'skip_to_latest',
});
```

This flow enforces concurrency on actively executing stages only (not waiting/sleeping instances).

### 1. Initialize Storage and Runtime with BullMQ (Recommended)

```typescript
import { createDriver } from '@inkibra/dal-connection';
import { createLogger } from '@inkibra/logger';
import { DalWorkflowStorage } from '@inkibra/workflow/storage-dal';
import { createWorkflowSystem } from '@inkibra/workflow/system';
import Redis from 'ioredis';

// Initialize logger
const logger = createLogger({ level: 'info' });

// Initialize Redis connection
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
});

// Initialize DAL driver (works with DAL-supported backends)
const dal = await createDriver({
  databaseUrl: process.env.DATABASE_URL,
});

// Initialize workflow storage via DAL collections
const storage = new DalWorkflowStorage(dal, logger);
await storage.initialize();

const system = await createWorkflowSystem({
  storage,
  logger,
  redis,
  queueName: 'workflow-jobs',
  workerConcurrency: 10,
  startWorker: true,
});
```

**Architecture**:
- **Jobs as primitives**: Jobs drive workflow execution, not polling
- **Worker as entry point**: Jobs execute → Worker calls runtime → Stage executes → Runtime creates next job
- **DAL collections for state**: State storage separated from coordination
- **Workflows auto-register**: `defineWorkflow()` automatically registers for worker retrieval

## Example 1: Simple Sequential Workflow

A basic workflow with sequential stages and a sleep delay.

```typescript
import { defineWorkflow, stage, sleep, complete } from '@inkibra/workflow';
import type { Snapshot } from '@inkibra/workflow/types';

// Define the workflow
export const userOnboarding = defineWorkflow('userOnboarding', {
  start: stage(async (input: { email: string; name: string }) => {
    // Create user in database
    const userId = await createUser(input.email, input.name);
    
    return {
      snapshot: {
        userId,
        email: input.email,
        name: input.name,
        createdAt: new Date().toISOString(),
      } as Snapshot<{
        userId: string;
        email: string;
        name: string;
        createdAt: string;
      }>,
      next: 'sendWelcome',
    };
  }),

  sendWelcome: stage(async (snap) => {
    // Send welcome email
    await emailService.send({
      to: snap.email,
      template: 'welcome',
      data: { name: snap.name },
    });

    // Wait 7 days before follow-up
    return sleep('7 days', {
      snapshot: snap,
      next: 'sendFollowUp',
    });
  }),

  sendFollowUp: stage(async (snap) => {
    // Send follow-up email
    await emailService.send({
      to: snap.email,
      template: 'followup',
      data: { name: snap.name, joinedDays: 7 },
    });

    return complete({
      result: {
        userId: snap.userId,
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    });
  }),
});

// Start the workflow
const instance = await runtime.startWorkflow(userOnboarding, {
  email: 'user@example.com',
  name: 'John Doe',
});

console.log('Workflow started:', instance.id);
```

## Example 2: Event-Driven Workflow

A workflow that waits for external events before proceeding.

```typescript
import { defineWorkflow, stage, waitFor, sleep, complete, withCapture } from '@inkibra/workflow';
import type { Snapshot } from '@inkibra/workflow/types';

// Define the workflow with events
export const documentApproval = defineWorkflow(
  'documentApproval',
  
  // Event declarations
  {
    events: {
      documentSigned: withCapture<Snapshot<{ documentId: string }>>(
        (snap) => `doc:${snap.documentId}:signed`,
      ),
      managerApproved: withCapture<Snapshot<{ documentId: string }>>(
        (snap) => `doc:${snap.documentId}:manager:approved`,
      ),
    },
  },
  
  // Stages
  {
    start: stage(async (input: { documentId: string; userId: string }) => {
      // Create approval request
      const approvalId = await createApprovalRequest(input.documentId, input.userId);
      
      return {
        snapshot: {
          documentId: input.documentId,
          userId: input.userId,
          approvalId,
          requestedAt: new Date().toISOString(),
        } as Snapshot<{
          documentId: string;
          userId: string;
          approvalId: string;
          requestedAt: string;
        }>,
        next: 'waitForSignature',
      };
    }),

    waitForSignature: stage(async (snap, runtime) => {
      // Notify user to sign
      await notifyUser(snap.userId, 'Please sign the document');

      // Wait for signature event with 30 day timeout
      return waitFor({
        token: runtime.events.documentSigned.capture(snap),
        snapshot: snap,
        timeout: sleep('30 days', { snapshot: snap, next: 'signatureTimeout' }),
      });
    }),

    signatureTimeout: stage(async (snap) => {
      // Handle timeout
      await cancelApproval(snap.approvalId);
      
      return complete({
        result: {
          status: 'timeout',
          reason: 'Document not signed within 30 days',
        },
      });
    }),

    waitForManagerApproval: stage(async (snap, runtime) => {
      // Notify manager
      await notifyManager(snap.documentId);

      // Wait for manager approval with 14 day timeout
      return waitFor({
        token: runtime.events.managerApproved.capture(snap),
        snapshot: snap,
        timeout: sleep('14 days', { snapshot: snap, next: 'approvalTimeout' }),
      });
    }),

    approvalTimeout: stage(async (snap) => {
      await cancelApproval(snap.approvalId);
      
      return complete({
        result: {
          status: 'timeout',
          reason: 'Manager approval not received within 14 days',
        },
      });
    }),

    finalize: stage(async (snap) => {
      // Finalize document
      await finalizeDocument(snap.documentId);
      
      return complete({
        result: {
          status: 'approved',
          documentId: snap.documentId,
          completedAt: new Date().toISOString(),
        },
      });
    }),
  },
);

// Start the workflow
const instance = await runtime.startWorkflow(documentApproval, {
  documentId: 'doc-123',
  userId: 'user-456',
});

// Later, emit events when they occur
await runtime.emitEvent({
  workflowName: 'documentApproval',
  eventName: 'documentSigned',
  token: 'doc:doc-123:signed',
  payload: { signedAt: new Date().toISOString(), signedBy: 'user-456' },
});

await runtime.emitEvent({
  workflowName: 'documentApproval',
  eventName: 'managerApproved',
  token: 'doc:doc-123:manager:approved',
  payload: { approvedAt: new Date().toISOString(), approvedBy: 'manager-789' },
});
```

## Example 3: Multiple Event Coordination

A workflow that waits for multiple events before proceeding.

```typescript
import { defineWorkflow, stage, waitFor, complete, withCapture } from '@inkibra/workflow';
import type { Snapshot } from '@inkibra/workflow/types';

export const deploymentWorkflow = defineWorkflow(
  'deployment',
  
  {
    events: {
      testsPassed: withCapture<Snapshot<{ deploymentId: string }>>(
        (snap) => `deploy:${snap.deploymentId}:tests:passed`,
      ),
      securityApproved: withCapture<Snapshot<{ deploymentId: string }>>(
        (snap) => `deploy:${snap.deploymentId}:security:approved`,
      ),
      reviewApproved: withCapture<Snapshot<{ deploymentId: string }>>(
        (snap) => `deploy:${snap.deploymentId}:review:approved`,
      ),
    },
  },
  
  {
    start: stage(async (input: { branch: string; commitSha: string }) => {
      const deploymentId = await createDeployment(input.branch, input.commitSha);
      
      return {
        snapshot: {
          deploymentId,
          branch: input.branch,
          commitSha: input.commitSha,
        } as Snapshot<{
          deploymentId: string;
          branch: string;
          commitSha: string;
        }>,
        next: 'waitForApprovals',
      };
    }),

    waitForApprovals: stage(async (snap, runtime) => {
      // Trigger checks
      await triggerTests(snap.deploymentId);
      await requestSecurityReview(snap.deploymentId);
      await requestCodeReview(snap.deploymentId);

      // Wait for ALL three events before proceeding
      return waitFor.all(
        [
          runtime.events.testsPassed.capture(snap),
          runtime.events.securityApproved.capture(snap),
          runtime.events.reviewApproved.capture(snap),
        ],
        {
          snapshot: snap,
          timeout: sleep('2 hours', { snapshot: snap, next: 'escalate' }),
        },
      );
    }),

    escalate: stage(async (snap) => {
      await notifyTeam('Deployment waiting for approvals');
      
      return complete({
        result: {
          status: 'escalated',
          reason: 'Not all approvals received within 2 hours',
        },
      });
    }),

    deploy: stage(async (snap) => {
      // Deploy the application
      await deployToProduction(snap.deploymentId);
      
      return complete({
        result: {
          status: 'deployed',
          deploymentId: snap.deploymentId,
          deployedAt: new Date().toISOString(),
        },
      });
    }),
  },
);
```

## Example 4: Conditional Branching

A workflow with conditional logic determining the next stage.

```typescript
import { defineWorkflow, stage, complete } from '@inkibra/workflow';
import type { Snapshot } from '@inkibra/workflow/types';

export const orderProcessing = defineWorkflow('orderProcessing', {
  start: stage(async (input: { orderId: string; amount: number }) => {
    const order = await getOrder(input.orderId);
    
    return {
      snapshot: {
        orderId: input.orderId,
        amount: input.amount,
        customerId: order.customerId,
        isVip: order.customer.vip,
      } as Snapshot<{
        orderId: string;
        amount: number;
        customerId: string;
        isVip: boolean;
      }>,
      next: 'checkInventory',
    };
  }),

  checkInventory: stage(async (snap) => {
    const available = await checkInventory(snap.orderId);
    
    return {
      snapshot: { ...snap, inventoryAvailable: available },
      next: available ? 'processPayment' : 'handleOutOfStock',
    };
  }),

  handleOutOfStock: stage(async (snap) => {
    await notifyCustomer(snap.customerId, 'Items out of stock');
    
    return complete({
      result: { status: 'cancelled', reason: 'out_of_stock' },
    });
  }),

  processPayment: stage(async (snap) => {
    const paymentResult = await processPayment(snap.orderId, snap.amount);
    
    return {
      snapshot: { ...snap, paymentId: paymentResult.id },
      next: snap.isVip ? 'expeditedShipping' : 'standardShipping',
    };
  }),

  expeditedShipping: stage(async (snap) => {
    await createShipment(snap.orderId, { priority: 'expedited' });
    
    return complete({
      result: {
        status: 'shipped',
        shipmentType: 'expedited',
        orderId: snap.orderId,
      },
    });
  }),

  standardShipping: stage(async (snap) => {
    await createShipment(snap.orderId, { priority: 'standard' });
    
    return complete({
      result: {
        status: 'shipped',
        shipmentType: 'standard',
        orderId: snap.orderId,
      },
    });
  }),
});
```

## Example 5: Error Handling with Retry

A workflow demonstrating error handling and retry logic.

```typescript
import { defineWorkflow, stage, failure, complete } from '@inkibra/workflow';
import type { Snapshot } from '@inkibra/workflow/types';

export const dataProcessing = defineWorkflow('dataProcessing', {
  start: stage(async (input: { datasetId: string }) => {
    return {
      snapshot: {
        datasetId: input.datasetId,
        attempts: 0,
      } as Snapshot<{
        datasetId: string;
        attempts: number;
      }>,
      next: 'processData',
    };
  }),

  processData: stage(async (snap) => {
    try {
      const result = await processLargeDataset(snap.datasetId);
      
      return {
        snapshot: { ...snap, result },
        next: 'validateResults',
      };
    } catch (error) {
      // Retry up to 3 times with exponential backoff
      if (snap.attempts < 3) {
        return failure({
          reason: 'Processing failed',
          data: { error: String(error), attempt: snap.attempts + 1 },
          retry: {
            maxAttempts: 3,
            backoffMs: Math.pow(2, snap.attempts) * 1000,
          },
        });
      }
      
      // Max retries reached, move to error handling stage
      return {
        snapshot: { ...snap, error: String(error) },
        next: 'handleError',
      };
    }
  }),

  handleError: stage(async (snap) => {
    await notifyAdmins('Data processing failed', snap);
    
    return complete({
      result: {
        status: 'failed',
        datasetId: snap.datasetId,
        error: snap.error,
      },
    });
  }),

  validateResults: stage(async (snap) => {
    const valid = await validateResults(snap.result);
    
    if (!valid) {
      return {
        snapshot: snap,
        next: 'handleError',
      };
    }
    
    return complete({
      result: {
        status: 'success',
        datasetId: snap.datasetId,
        result: snap.result,
      },
    });
  }),
});
```

## Querying Workflow State

You can query workflow instances directly through DAL-backed workflow storage:

```typescript
// Get workflow instance
const instance = await storage.getInstance('workflow-instance-id');
console.log('Current stage:', instance?.currentStage);
console.log('Status:', instance?.status);
console.log('Snapshot:', instance?.snapshot);

// Get workflow events
const events = await storage.getEvents('workflow-instance-id');
for (const event of events) {
  console.log(`${event.timestamp}: ${event.eventType}`, event.payload);
}

// Get due timers
const dueTimers = await storage.getDueTimers(new Date().toISOString());
console.log('Due timers:', dueTimers.length);
```

## Best Practices

1. **Keep snapshots minimal**: Only include data needed for remaining stages
2. **Use deterministic IDs**: Generate IDs consistently (e.g., `user:${userId}:action`)
3. **Handle timeouts**: Always provide timeout handlers for waitFor
4. **Test stage functions**: Test each stage in isolation with mock dependencies
5. **Version workflows**: Use workflow versions when making breaking changes
6. **Monitor events**: Track event emissions and workflow progress
7. **Clean up completed workflows**: Archive or delete old completed instances

## Troubleshooting

### Workflow stuck in "waiting" state
- Check if event tokens match exactly
- Verify events are being emitted correctly
- Check if timeout was configured

### Worker not processing timers
- Verify worker is running (`worker.isRunning()`)
- Check DAL/Redis connectivity
- Review worker logs for errors

### Instance not found
- Verify instance ID is correct
- Check if instance was completed/deleted
- Ensure correct scope/bucket configuration
