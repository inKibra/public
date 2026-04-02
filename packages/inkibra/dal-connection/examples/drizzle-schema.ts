/**
 * Drizzle Schema Definitions (Example)
 *
 * This file demonstrates the new defineCollection() fluent API.
 * drizzle-kit will use these exports for push/studio.
 *
 * Usage:
 *   bun db:push    - Push schema to PGlite database (./dev-db)
 *   bun db:studio  - Launch Drizzle Studio at http://localhost:4983
 */

import { defineCollection, type ModelBase } from '../collection-builder';

// ============================================================================
// Example Model Types
// ============================================================================

// --- Social Collection Models ---

interface Post extends ModelBase {
  id: string;
  type: 'POST';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  postId: string;
  authorId: string;
  status: 'draft' | 'published' | 'archived';
  title: string;
  content: string;
  tags: string[];
}

interface Comment extends ModelBase {
  id: string;
  type: 'COMMENT';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  commentId: string;
  parentPostId: string;
  authorId: string;
  content: string;
}

interface Reaction extends ModelBase {
  id: string;
  type: 'REACTION';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  targetId: string; // postId or commentId
  targetType: 'POST' | 'COMMENT';
  authorId: string;
  emoji: string;
}

// --- E-Commerce Collection Models ---

interface Customer extends ModelBase {
  id: string;
  type: 'CUSTOMER';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  customerId: string;
  email: string;
  name: string;
  tier: 'basic' | 'premium' | 'vip';
}

interface Order extends ModelBase {
  id: string;
  type: 'ORDER';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  orderId: string;
  customerId: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  total: number;
}

interface OrderItem extends ModelBase {
  id: string;
  type: 'ORDER_ITEM';
  version: number;
  created: string;
  modified: string;
  deleted?: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: number;
}

// ============================================================================
// Discriminators
// ============================================================================

function hasType(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Record<string, unknown>).type === 'string'
  );
}

const isPost = (data: unknown): data is Post =>
  hasType(data) && data.type === 'POST';

const isComment = (data: unknown): data is Comment =>
  hasType(data) && data.type === 'COMMENT';

const isReaction = (data: unknown): data is Reaction =>
  hasType(data) && data.type === 'REACTION';

const isCustomer = (data: unknown): data is Customer =>
  hasType(data) && data.type === 'CUSTOMER';

const isOrder = (data: unknown): data is Order =>
  hasType(data) && data.type === 'ORDER';

const isOrderItem = (data: unknown): data is OrderItem =>
  hasType(data) && data.type === 'ORDER_ITEM';

// ============================================================================
// Social Collection
// ============================================================================

/**
 * Social collection: Posts, Comments, Reactions
 *
 * Partitions:
 * - post_partition: Groups posts with their comments and reactions
 * - author_partition: Groups all content by author
 */
export const social = defineCollection('social')
  .addPartition('post_partition')
  .addPartition('author_partition')

  .addModel('POST', {
    version: 1,
    valueIndexes: ['authorId', 'status'] as const,
    arrayIndexes: ['tags'] as const,
    partitions: {
      post_partition: 'postId',
      author_partition: 'authorId',
    },
    discriminator: isPost,
  })

  .addModel('COMMENT', {
    version: 1,
    valueIndexes: ['authorId'] as const,
    partitions: {
      post_partition: 'parentPostId',
      author_partition: 'authorId',
    },
    discriminator: isComment,
  })

  .addModel('REACTION', {
    version: 1,
    valueIndexes: ['authorId', 'targetType', 'emoji'] as const,
    partitions: {
      post_partition: 'targetId',
      author_partition: 'authorId',
    },
    discriminator: isReaction,
  })

  .addIndex({ fields: ['authorId', 'created'], name: 'author_timeline' })

  .build();

// ============================================================================
// E-Commerce Collection
// ============================================================================

/**
 * E-Commerce collection: Customers, Orders, OrderItems
 *
 * Partitions:
 * - customer_partition: Groups customers with their orders
 * - order_partition: Groups orders with their items
 */
export const ecommerce = defineCollection('ecommerce')
  .addPartition('customer_partition')
  .addPartition('order_partition')

  .addModel('CUSTOMER', {
    version: 1,
    valueIndexes: ['email', 'tier'] as const,
    partitions: {
      customer_partition: 'customerId',
    },
    discriminator: isCustomer,
  })

  .addModel('ORDER', {
    version: 1,
    valueIndexes: ['customerId', 'status'] as const,
    partitions: {
      customer_partition: 'customerId',
      order_partition: 'orderId',
    },
    discriminator: isOrder,
  })

  .addModel('ORDER_ITEM', {
    version: 1,
    valueIndexes: ['productId'] as const,
    partitions: {
      order_partition: 'orderId',
    },
    discriminator: isOrderItem,
  })

  .addIndex({ fields: ['customerId', 'created'], name: 'customer_orders' })
  .addIndex({ fields: ['status', 'created'], name: 'orders_by_status' })

  .build();

// ============================================================================
// Export Tables for drizzle-kit
// ============================================================================

export const socialTable = social.table;
export const ecommerceTable = ecommerce.table;

// ============================================================================
// Usage Examples
// ============================================================================

/*
// --- Social Collection Usage ---

await social.initialize(logger, driver);

// Get all posts by an author
const authorPosts = await social.POST.find(logger, {
  filter: { authorId: Filter.eq('user_123') },
  orderBy: { field: 'created', direction: 'DESC' },
});

// Get a post with all its comments and reactions
const postData = await social.findByPartition(
  logger,
  'post_partition',
  'post_abc',
  { types: ['POST', 'COMMENT', 'REACTION'] }
);

// Get all content by an author (posts, comments, reactions)
const authorContent = await social.findByPartition(
  logger,
  'author_partition',
  'user_123'
);


// --- E-Commerce Collection Usage ---

await ecommerce.initialize(logger, driver);

// Get all orders for a customer
const customerOrders = await ecommerce.ORDER.find(logger, {
  filter: { customerId: Filter.eq('cust_456') },
  orderBy: { field: 'created', direction: 'DESC' },
});

// Get customer with all their orders
const customerData = await ecommerce.findByPartition(
  logger,
  'customer_partition',
  'cust_456',
  { types: ['CUSTOMER', 'ORDER'] }
);

// Get order with all its items
const orderData = await ecommerce.findByPartition(
  logger,
  'order_partition',
  'order_789',
  { types: ['ORDER', 'ORDER_ITEM'] }
);

// Find pending orders
const pendingOrders = await ecommerce.ORDER.find(logger, {
  filter: { status: Filter.eq('pending') },
  limit: 50,
});
*/
