import {z} from 'zod';

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import {StorageManager, type SetCookieOptions} from '../storageManager.js';
import type {PageSession} from '../pageSession.js';

const listCookiesShape = {
  url: z
    .string()
    .url('Provide a valid URL to scope cookies (optional).')
    .optional(),
} as const;

const setCookieShape = {
  url: z
    .string()
    .url('URL used to scope the cookie. Required.'),
  name: z
    .string()
    .min(1, 'Cookie name is required.'),
  value: z.string().default(''),
  domain: z.string().optional(),
  path: z.string().optional(),
  secure: z.boolean().default(false),
  httpOnly: z.boolean().default(false),
  sameSite: z
    .enum(['Strict', 'Lax', 'None'])
    .optional()
    .describe('Cookie SameSite attribute.'),
  expires: z
    .number()
    .int()
    .optional()
    .describe('Unix timestamp (seconds) when the cookie expires.'),
} as const;

const deleteCookieShape = {
  name: z
    .string()
    .min(1, 'Cookie name is required.'),
  url: z.string().url().optional(),
  domain: z.string().optional(),
  path: z.string().optional(),
} as const;

const setLocalStorageShape = {
  key: z
    .string()
    .min(1, 'Key must be provided.'),
  value: z.string().default(''),
} as const;

const removeLocalStorageShape = {
  key: z
    .string()
    .min(1, 'Key must be provided.'),
} as const;

export function registerStorageTools(
  server: McpServer,
  session: PageSession,
): void {
  const storage = new StorageManager(session);

  server.registerTool(
    'storage_list_cookies',
    {
      description: 'List cookies available to the current page context.',
      inputSchema: listCookiesShape,
    },
    async ({url}: {url?: string}) => {
      try {
        const cookies = await storage.listCookies(url);
        if (!cookies.length) {
          return {
            content: [
              {
                type: 'text',
                text: 'No cookies found.',
              },
            ],
          };
        }
        const lines = cookies.map(cookie => {
          const attrs = [
            cookie.domain ? `domain=${cookie.domain}` : undefined,
            cookie.path ? `path=${cookie.path}` : undefined,
            cookie.secure ? 'secure' : undefined,
            cookie.httpOnly ? 'httpOnly' : undefined,
            cookie.sameSite ? `sameSite=${cookie.sameSite}` : undefined,
            cookie.session ? 'session=1' : undefined,
            cookie.expires ? `expires=${new Date(cookie.expires * 1000).toISOString()}` : undefined,
          ].filter(Boolean);
          return `${cookie.name}=${cookie.value}${attrs.length ? ' (' + attrs.join(', ') + ')' : ''}`;
        });
        return {
          content: [
            {
              type: 'text',
              text: lines.join('\n'),
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
                  ? `Failed to list cookies: ${error.message}`
                  : 'Failed to list cookies.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'storage_set_cookie',
    {
      description: 'Create or update a cookie for the current browser context.',
      inputSchema: setCookieShape,
    },
    async (args: SetCookieOptions) => {
      try {
        await storage.setCookie(args);
        return {
          content: [
            {
              type: 'text',
              text: `Set cookie ${args.name} for ${args.url}.`,
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
                  ? `Failed to set cookie: ${error.message}`
                  : 'Failed to set cookie.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'storage_delete_cookie',
    {
      description: 'Delete a cookie by name and optional scope.',
      inputSchema: deleteCookieShape,
    },
    async ({name, url, domain, path}: {name: string; url?: string; domain?: string; path?: string}) => {
      try {
        await storage.deleteCookie({name, url, domain, path});
        return {
          content: [
            {
              type: 'text',
              text: `Deleted cookie ${name}.`,
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
                  ? `Failed to delete cookie: ${error.message}`
                  : 'Failed to delete cookie.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'storage_clear_cookies',
    {
      description: 'Clear all browser cookies for the current session.',
    },
    async () => {
      try {
        await storage.clearCookies();
        return {
          content: [
            {
              type: 'text',
              text: 'Cleared all cookies for this browser context.',
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
                  ? `Failed to clear cookies: ${error.message}`
                  : 'Failed to clear cookies.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'storage_list_local_storage',
    {
      description: 'List all key/value pairs from window.localStorage.',
    },
    async () => {
      try {
        const entries = await storage.listLocalStorage();
        if (!entries.length) {
          return {
            content: [
              {
                type: 'text',
                text: 'localStorage is empty.',
              },
            ],
          };
        }
        const lines = entries.map(entry => `${entry.key}=${entry.value ?? 'null'}`);
        return {
          content: [
            {
              type: 'text',
              text: lines.join('\n'),
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
                  ? `Failed to read localStorage: ${error.message}`
                  : 'Failed to read localStorage.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'storage_set_local_storage',
    {
      description: 'Set a localStorage key to a string value.',
      inputSchema: setLocalStorageShape,
    },
    async ({key, value}: {key: string; value: string}) => {
      try {
        await storage.setLocalStorageItem(key, value);
        return {
          content: [
            {
              type: 'text',
              text: `Set localStorage[${key}]`,
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
                  ? `Failed to set localStorage: ${error.message}`
                  : 'Failed to set localStorage.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'storage_remove_local_storage',
    {
      description: 'Remove a key from localStorage if it exists.',
      inputSchema: removeLocalStorageShape,
    },
    async ({key}: {key: string}) => {
      try {
        await storage.removeLocalStorageItem(key);
        return {
          content: [
            {
              type: 'text',
              text: `Removed localStorage[${key}]`,
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
                  ? `Failed to remove localStorage item: ${error.message}`
                  : 'Failed to remove localStorage item.',
            },
          ],
        };
      }
    },
  );
}
