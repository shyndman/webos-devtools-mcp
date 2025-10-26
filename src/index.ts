import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import type {ZodRawShape} from 'zod';

import {LogKind, PageSession} from './pageSession.js';
import {registerDomTools} from './tools/domTools.js';
import {registerDomActions} from './tools/domActions.js';
import {registerNavigationTools} from './tools/navigationTools.js';
import {registerStorageTools} from './tools/storageTools.js';
import {registerNetworkTools} from './tools/networkTools.js';
import {registerRemoteKeyTools} from './tools/remoteKeys.js';

const LOG_KIND_TUPLE: [LogKind, ...LogKind[]] = [
  'console',
  'exception',
  'log',
];
const SUPPORTED_LOG_KINDS = LOG_KIND_TUPLE;

const evaluateArgsShape = {
  expression: z
    .string()
    .min(1, 'Provide a JavaScript expression to evaluate.'),
  awaitPromise: z
    .boolean()
    .default(true)
    .describe('Await promise results before returning.'),
  returnByValue: z
    .boolean()
    .default(true)
    .describe('Return primitive values instead of object previews.'),
} satisfies ZodRawShape;
const evaluateArgsSchema = z.object(evaluateArgsShape);
type EvaluateArgs = z.infer<typeof evaluateArgsSchema>;

const logsArgsShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe('Maximum number of entries to return.'),
  kinds: z
    .array(z.enum(LOG_KIND_TUPLE))
    .describe('Filter by entry kinds.')
    .optional(),
  newestFirst: z
    .boolean()
    .default(true)
    .describe('Return newest entries first (default true).'),
} satisfies ZodRawShape;
const logsArgsSchema = z.object(logsArgsShape);
type LogsArgs = z.infer<typeof logsArgsSchema>;

const screenshotArgsShape = {
  format: z
    .enum(['png', 'jpeg', 'webp'])
    .default('png')
    .describe('Image format. Quality applies only to jpeg/webp.'),
  quality: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Quality (0-100) for jpeg/webp screenshots.'),
  fullPage: z
    .boolean()
    .default(false)
    .describe(
      'Capture beyond the viewport if supported (maps to captureBeyondViewport).',
    ),
} satisfies ZodRawShape;
const screenshotArgsSchema = z.object(screenshotArgsShape);
type ScreenshotArgs = z.infer<typeof screenshotArgsSchema>;

function resolveEndpoint(argv: string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith('--endpoint=')) {
      return arg.split('=')[1];
    }
    if (arg.startsWith('--page-ws-endpoint=')) {
      return arg.split('=')[1];
    }
  }

  const endpointFlagIndex = argv.findIndex(
    arg => arg === '--endpoint' || arg === '--page-ws-endpoint',
  );
  if (endpointFlagIndex !== -1 && endpointFlagIndex + 1 < argv.length) {
    return argv[endpointFlagIndex + 1];
  }

  return process.env.PAGE_WS_ENDPOINT;
}

function assertEndpoint(endpoint: string | undefined): string {
  if (!endpoint) {
    throw new Error(
      'Missing page WebSocket endpoint. Pass --endpoint ws://... or set PAGE_WS_ENDPOINT.',
    );
  }
  try {
    const url = new URL(endpoint);
    if (!url.protocol.startsWith('ws')) {
      throw new Error('WebSocket endpoint must use ws:// or wss://');
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid endpoint URL';
    throw new Error(`Invalid --endpoint value: ${message}`);
  }
  return endpoint;
}

function createServerInstructions(endpointHint: string): string {
  return [
    'Minimal MCP server that connects directly to a Chrome DevTools page socket.',
    'Provide the page WebSocket URL with --endpoint or PAGE_WS_ENDPOINT.',
    `Example: webos-devtools-mcp --endpoint ${endpointHint}`,
    'Tools: evaluate_expression, list_logs, clear_logs, take_screenshot.',
  ].join('\n');
}

function formatEntries(entries: Awaited<ReturnType<PageSession['getEntries']>>): string {
  if (!entries.length) {
    return 'No log entries collected yet.';
  }
  return entries
    .map(entry => {
      const parts = [
        `#${entry.id}`,
        entry.timestamp.toISOString(),
        entry.kind.toUpperCase(),
        entry.level.toUpperCase(),
        entry.message,
      ];
      if (entry.url) {
        parts.push(`@ ${entry.url}`);
      }
      if (entry.source) {
        parts.push(`[${entry.source}]`);
      }
      return parts.join(' | ');
    })
    .join('\n');
}

async function main(): Promise<void> {
  const endpoint = assertEndpoint(resolveEndpoint(process.argv.slice(2)));
  const session = new PageSession(endpoint);
  await session.connect();

  const server = new McpServer(
    {
      name: 'webos-devtools-mcp',
      version: '0.1.0',
      description: 'Page-scoped Chrome DevTools MCP server',
    },
    {
      instructions: createServerInstructions(endpoint),
    },
  );

  server.registerTool(
    'evaluate_expression',
    {
      description: 'Evaluate a JavaScript expression in the attached page.',
      inputSchema: evaluateArgsShape,
    },
    async ({expression, awaitPromise = true, returnByValue = true}: EvaluateArgs) => {
      try {
        const result = await session.evaluate(expression, {
          awaitPromise,
          returnByValue,
        });
        const description = result.description
          ? `\nDescription: ${result.description}`
          : '';
        return {
          content: [
            {
              type: 'text',
              text: `Type: ${result.type}\nValue: ${result.value}${description}`,
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Evaluation failed.';
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'list_logs',
    {
      description:
        'List buffered console messages, runtime exceptions, and log entries.',
      inputSchema: logsArgsShape,
    },
    async ({
      limit = 20,
      kinds,
      newestFirst = true,
    }: LogsArgs): Promise<{
      content: Array<{type: 'text'; text: string}>;
    }> => {
      const entries = session.getEntries({
        limit,
        kinds: kinds?.length ? kinds : undefined,
        newestFirst,
      });
      const text = formatEntries(entries);
      return {
        content: [
          {
            type: 'text',
            text,
          },
        ],
      };
    },
  );

  server.registerTool('clear_logs', {
    description: 'Clear the buffered log entries.',
  }, async () => {
    session.clearEntries();
    return {
      content: [
        {
          type: 'text',
          text: 'Cleared log buffer.',
        },
      ],
    };
  });

  server.registerTool(
    'take_screenshot',
    {
      description: 'Capture a screenshot of the attached page.',
      inputSchema: screenshotArgsShape,
    },
    async ({format = 'png', quality, fullPage = false}: ScreenshotArgs) => {
      if (quality !== undefined && format === 'png') {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'The quality parameter is only supported for jpeg and webp captures.',
            },
          ],
        };
      }
      try {
        const {data, mimeType} = await session.captureScreenshot({
          format,
          quality,
          captureBeyondViewport: fullPage,
        });
        return {
          content: [
            {
              type: 'image',
              data,
              mimeType,
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Screenshot failed.';
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        };
      }
    },
  );

  registerDomTools(server, session);
  registerDomActions(server, session);
  registerNavigationTools(server, session);
  registerStorageTools(server, session);
  registerNetworkTools(server, session);
  registerRemoteKeyTools(server, session);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await session.dispose();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('Fatal error starting MCP server:', error);
  process.exit(1);
});
