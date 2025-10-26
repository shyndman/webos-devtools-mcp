import {z} from 'zod';

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import {ConsoleStreamManager, type ConsoleStreamOptions} from '../consoleStreamManager.js';
import type {PageSession} from '../pageSession.js';

const subscribeShape = {
  levels: z
    .array(z.enum(['log', 'debug', 'info', 'warn', 'error']))
    .optional()
    .describe('Console levels to stream. Default: all.'),
  includeExceptions: z
    .boolean()
    .default(true)
    .describe('Whether to stream uncaught exceptions.'),
  includeStack: z
    .boolean()
    .default(false)
    .describe('Include stack trace (first few frames) in each streamed message.'),
} as const;

export function registerConsoleStreamTools(
  server: McpServer,
  session: PageSession,
): void {
  const manager = new ConsoleStreamManager(session, server);

  server.registerTool(
    'console_subscribe',
    {
      description: 'Begin streaming console output in real time.',
      inputSchema: subscribeShape,
    },
    async (args: ConsoleStreamOptions = {}): Promise<any> => {
      await manager.subscribe(args);
      return {
        content: [
          {
            type: 'text',
            text: `Console streaming enabled (${(args.levels ?? ['log','debug','info','warn','error']).join(', ')})`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'console_unsubscribe',
    {
      description: 'Stop streaming console output.',
    },
    async (): Promise<any> => {
      if (!manager.active) {
        return {
          content: [
            {
              type: 'text',
              text: 'Console streaming was not active.',
            },
          ],
        };
      }
      await manager.unsubscribe();
      return {
        content: [
          {
            type: 'text',
            text: 'Console streaming disabled.',
          },
        ],
      };
    },
  );

  server.registerTool(
    'console_stream_status',
    {
      description: 'Report current console streaming status.',
    },
    async (): Promise<any> => {
      if (!manager.active) {
        return {
          content: [
            {
              type: 'text',
              text: 'Console streaming is inactive.',
            },
          ],
        };
      }
      const opts = manager.options ?? {};
      return {
        content: [
          {
            type: 'text',
            text: `Console streaming active. Levels: ${(opts.levels ?? ['log','debug','info','warn','error']).join(', ')}; includeExceptions=${opts.includeExceptions ?? true}; includeStack=${opts.includeStack ?? false}`,
          },
        ],
      };
    },
  );
}
