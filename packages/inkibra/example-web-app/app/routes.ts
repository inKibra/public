/**
 * Example route tree using the fluent builder API.
 * Covers boards and blog with parallel outlets and a [PARENT] replacement.
 */

import {
  createAppRouteTree,
  defineLoaderSchema,
  PARENT,
  SerializableResult,
  StatusCode,
  strategy,
} from '@inkibra/router';
import {
  getCurrentUserRoute,
  loginRoute,
  logoutRoute,
  SessionCodec,
} from '../api/routes/auth';
// Blog API routes
import {
  createBlogPostRoute,
  getBlogPostRoute,
  listBlogPostsRoute,
} from '../api/routes/blog';
// Boards API routes
import {
  createBoardRoute,
  createListRoute,
  getBoardRoute,
  listBoardsRoute,
} from '../api/routes/boards';
import {
  createChannelRoute,
  getChannelRoute,
  getMessagesRoute,
  listChannelsRoute,
  sendMessageRoute,
} from '../api/routes/chat';
// Task API routes
import {
  createTaskRoute,
  deleteTaskRoute,
  getTaskRoute,
  listAllTasksRoute,
  listTasksRoute,
  updateTaskRoute,
} from '../api/routes/tasks';
import { chatMessagesRoute } from '../api/streams';

// Loader schemas (reuse existing validators)
import {
  validateBlogPostLoaderResponse,
  validateBlogPostsLoaderResponse,
  validateBoardLoaderResponse,
  validateBoardsLoaderResponse,
  validateChannelDetailLoaderResponse,
  validateChannelsLoaderResponse,
  validateLoaderError,
  validateTaskPanelQueryTaskId,
} from '../schemas';

// Components (reuse existing pages)
const Layout = strategy.sync(() => import('./routes/layout'));
const BoardsList = strategy.sync(() => import('./routes/boards/list'));
const BoardDetail = strategy.lazy(() => import('./routes/boards/board'));
const BlogLayout = strategy.static(() => import('./routes/blog/layout'));
const BlogPost = strategy.lazy(() => import('./routes/blog/post'));
const BlogNew = strategy.lazy(() => import('./routes/blog/new'));
const TaskPanel = strategy.sync(() => import('./task-panel'));
const ChatList = strategy.sync(() => import('./routes/chat/list'));
const ChatChannel = strategy.lazy(() => import('./routes/chat/channel'));
const Login = strategy.sync(() => import('./routes/login'));

// Loader schemas
const boardsLoaderSchema = defineLoaderSchema({
  response: validateBoardsLoaderResponse,
  error: validateLoaderError,
});

const boardDetailLoaderSchema = defineLoaderSchema({
  response: validateBoardLoaderResponse,
  error: validateLoaderError,
});

const blogListLoaderSchema = defineLoaderSchema({
  response: validateBlogPostsLoaderResponse,
  error: validateLoaderError,
});

const blogPostLoaderSchema = defineLoaderSchema({
  response: validateBlogPostLoaderResponse,
  error: validateLoaderError,
});

const channelsLoaderSchema = defineLoaderSchema({
  response: validateChannelsLoaderResponse,
  error: validateLoaderError,
});

const channelDetailLoaderSchema = defineLoaderSchema({
  response: validateChannelDetailLoaderResponse,
  error: validateLoaderError,
});

export const appRoutes = createAppRouteTree({ session: SessionCodec })
  .api({
    login: loginRoute,
    logout: logoutRoute,
    getCurrentUser: getCurrentUserRoute,
  })
  .page({
    component: Layout,
  })
  .outlets((o) => ({
    taskPanel: o
      .outlet('taskPanel', {
        querySchema: {
          taskId: validateTaskPanelQueryTaskId,
        },
      })
      .segments((s) => ({
        // Duplicate boards/blog segments for task panel
        boards: s
          .leaf('boards')
          .api({
            getTask: getTaskRoute,
            listAllTasks: listAllTasksRoute,
          })
          .page({
            component: TaskPanel,
          }),
        blog: s
          .leaf('blog')
          .api({
            getTask: getTaskRoute,
            listAllTasks: listAllTasksRoute,
          })
          .page({
            component: TaskPanel,
          }),
      })),
    main: o.outlet('main').segments((s) => ({
      // Login
      login: s.leaf('login').api({ login: loginRoute }).page({
        component: Login,
      }),

      // Chat
      channels: s
        .segment('channels')
        .api({
          listChannels: listChannelsRoute,
          createChannel: createChannelRoute,
        })
        .page({
          loader: {
            schema: channelsLoaderSchema,
            load: async (api, { ctx }) => {
              if (ctx.session === null) {
                return SerializableResult.toErr(
                  { type: 'Unauthorized', message: 'Session required' },
                  StatusCode.NOT_AUTHENTICATED,
                );
              }
              return api.listChannels.execute(
                { pathParams: {}, pathQuery: {}, body: {}, files: undefined },
                { session: ctx.session },
              );
            },
          },
          component: ChatList,
        })
        .outlets((o2) => ({
          main: o2.outlet('main').segments((s2) => ({
            [':channelId']: s2
              .leaf(':channelId')
              .api({
                getChannel: getChannelRoute,
                getMessages: getMessagesRoute,
                sendMessage: sendMessageRoute,
                // Event streams are now passed alongside API routes
                chatMessages: chatMessagesRoute,
              })
              .page({
                loader: {
                  schema: channelDetailLoaderSchema,
                  load: async (api, { params, ctx }) => {
                    const channelId = params.channelId;
                    if (!channelId) {
                      return SerializableResult.toErr(
                        { type: 'NotFound' },
                        StatusCode.NOT_FOUND,
                      );
                    }
                    const [channelRes, messagesRes] = await Promise.all([
                      api.getChannel.execute(
                        {
                          pathParams: { channelId },
                          pathQuery: {},
                          body: {},
                          files: undefined,
                        },
                        { session: ctx.session },
                      ),
                      api.getMessages.execute(
                        {
                          pathParams: { channelId },
                          pathQuery: {},
                          body: {},
                          files: undefined,
                        },
                        { session: ctx.session },
                      ),
                    ]);
                    if (channelRes.type !== 'Ok') return channelRes;
                    if (messagesRes.type !== 'Ok') return messagesRes;
                    return SerializableResult.toOk(
                      {
                        channel: channelRes.value,
                        messages: messagesRes.value,
                      },
                      StatusCode.OK,
                    );
                  },
                },
                component: ChatChannel,
              }),
          })),
        })),

      // Boards
      boards: s
        .segment('boards')
        .api({ listBoards: listBoardsRoute, createBoard: createBoardRoute })
        .page({
          loader: {
            schema: boardsLoaderSchema,
            load: async (api, { ctx }) => {
              if (ctx.session === null) {
                return SerializableResult.toErr(
                  { type: 'Unauthorized', message: 'Session required' },
                  StatusCode.NOT_AUTHENTICATED,
                );
              }
              return api.listBoards.execute(
                { pathParams: {}, pathQuery: {}, body: {}, files: undefined },
                { session: ctx.session },
              );
            },
          },
          component: BoardsList,
        })
        .outlets((o2) => ({
          // Parallel main outlet for board detail
          main: o2.outlet('main').segments((s2) => ({
            [':boardId']: s2
              .leaf(':boardId')
              .api({
                getBoard: getBoardRoute,
                createBoard: createBoardRoute,
                createList: createListRoute,
                // Task routes for queries/mutations
                listTasks: listTasksRoute,
                createTask: createTaskRoute,
                updateTask: updateTaskRoute,
                deleteTask: deleteTaskRoute,
              })
              .page({
                loader: {
                  schema: boardDetailLoaderSchema,
                  load: async (api, { params, ctx }) => {
                    const boardId = params.boardId;
                    if (!boardId) {
                      return SerializableResult.toErr(
                        { type: 'NotFound' },
                        StatusCode.NOT_FOUND,
                      );
                    }
                    return api.getBoard.execute(
                      {
                        pathParams: { boardId },
                        pathQuery: {},
                        body: {},
                        files: undefined,
                      },
                      { session: ctx.session },
                    );
                  },
                },
                component: BoardDetail,
              }),
          })),

          // Replacement outlet for "new board" (renders in parent)
          [PARENT]: o2.replacement((s2) => ({
            new: s2.leaf('new').api({ createBoard: createBoardRoute }).page({
              component: BoardsList,
            }),
          })),
        })),

      // Blog
      blog: s
        .segment('blog')
        .api({ listBlogPosts: listBlogPostsRoute })
        .page({
          loader: {
            schema: blogListLoaderSchema,
            load: async (api) =>
              api.listBlogPosts.execute(
                { pathParams: {}, pathQuery: {}, body: {}, files: undefined },
                {},
              ),
          },
          component: BlogLayout,
        })
        .outlets((o2) => ({
          // Main outlet for post detail (component expects 'main')
          main: o2.outlet('main').segments((s2) => ({
            [':postId']: s2
              .leaf(':postId')
              .api({
                getBlogPost: getBlogPostRoute,
                createBlogPost: createBlogPostRoute,
              })
              .page({
                loader: {
                  schema: blogPostLoaderSchema,
                  load: async (api, { params }) => {
                    const postId = params.postId;
                    if (!postId) {
                      return SerializableResult.toErr(
                        { type: 'NotFound' },
                        StatusCode.NOT_FOUND,
                      );
                    }
                    return api.getBlogPost.execute(
                      {
                        pathParams: { postId },
                        pathQuery: {},
                        body: {},
                        files: undefined,
                      },
                      {},
                    );
                  },
                },
                component: BlogPost,
              }),
          })),

          // Replacement outlet for "new post" (renders in parent)
          [PARENT]: o2.replacement((s2) => ({
            new: s2
              .leaf('new')
              .api({ createBlogPost: createBlogPostRoute })
              .page({
                component: BlogNew,
              }),
          })),
        })),
    })),
  }));

// Note: Page props types are now defined in each component file.
// Use: type MyPageProps = RoutePageProps<typeof appRoutes.$pages.main.myRoute>
