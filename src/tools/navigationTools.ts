import {z} from 'zod';

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import type {PageSession, NavigateOptions, ReloadOptions} from '../pageSession.js';

const navigateShape = {
  url: z
    .string()
    .url('Provide a valid URL (e.g., https://example.com).'),
  waitForLoad: z
    .boolean()
    .default(true)
    .describe('Wait for the next load event before returning.'),
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(120_000)
    .default(15_000)
    .describe('Maximum time to wait for page load in milliseconds.'),
} as const;

const reloadShape = {
  ignoreCache: z
    .boolean()
    .default(false)
    .describe('If true, bypasses the browser cache during reload.'),
  waitForLoad: z
    .boolean()
    .default(true)
    .describe('Wait for the next load event before returning.'),
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(120_000)
    .default(15_000)
    .describe('Maximum time to wait for page load in milliseconds.'),
} as const;

interface NavigateArgs {
  url: string;
  waitForLoad: boolean;
  timeoutMs: number;
}

interface ReloadArgs {
  ignoreCache: boolean;
  waitForLoad: boolean;
  timeoutMs: number;
}

export function registerNavigationTools(
  server: McpServer,
  session: PageSession,
): void {
  server.registerTool(
    'page_navigate',
    {
      description: 'Navigate the page to a new URL.',
      inputSchema: navigateShape,
    },
    async ({url, waitForLoad, timeoutMs}: NavigateArgs) => {
      try {
        const options: NavigateOptions = {
          waitForLoad,
          timeoutMs,
        };
        await session.navigate(url, options);
        return {
          content: [
            {
              type: 'text',
              text: `Navigated to ${url}${waitForLoad ? ' (waited for load event).' : '.'}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Navigation failed: ${error.message}`
                  : 'Navigation failed.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'page_reload',
    {
      description: 'Reload the current page.',
      inputSchema: reloadShape,
    },
    async ({ignoreCache, waitForLoad, timeoutMs}: ReloadArgs) => {
      try {
        const options: ReloadOptions = {
          ignoreCache,
          waitForLoad,
          timeoutMs,
        };
        await session.reload(options);
        return {
          content: [
            {
              type: 'text',
              text: `Reloaded page${ignoreCache ? ' (cache ignored)' : ''}${waitForLoad ? ' and waited for load event.' : '.'}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Reload failed: ${error.message}`
                  : 'Reload failed.',
            },
          ],
        };
      }
    },
  );
}
