import {z} from 'zod';

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import type {PageSession} from '../pageSession.js';

const listenerShape = {
  target: z
    .enum(['selector', 'document', 'window'])
    .default('selector')
    .describe('Inspect listeners on a selector, document, or window.'),
  selector: z
    .string()
    .min(1, 'Provide a CSS selector when target is "selector".')
    .optional(),
  includeAncestors: z
    .boolean()
    .default(false)
    .describe('Whether to include listeners from ancestor nodes / prototypes.'),
  depth: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(1)
    .describe('Depth to traverse up the DOM / prototype chain when includeAncestors is true.'),
  eventTypes: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter by event types (e.g., click, keydown).'),
  maxListeners: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe('Limit the number of listeners returned.'),
} as const;

const listenerArgsSchema = z.object(listenerShape);
type ListenerArgs = z.infer<typeof listenerArgsSchema>;

export function registerEventListenerTools(
  server: McpServer,
  session: PageSession,
): void {
  server.registerTool(
    'dom_list_event_listeners',
    {
      description: 'List DOM event listeners attached to an element, document, or window.',
      inputSchema: listenerShape,
    },
    async ({
      target,
      selector,
      includeAncestors,
      depth,
      eventTypes,
      maxListeners,
    }: ListenerArgs) => {
      try {
        const client = await session.getClient();
        let objectId: string | undefined;
        const release = async () => {
          if (objectId) {
            await session
              .sendCommand('Runtime.releaseObject', {objectId})
              .catch(() => {});
          }
        };

        try {
          if (target === 'window') {
            const {result} = await session.sendCommand<{
              result: {objectId?: string | null};
            }>('Runtime.evaluate', {
              expression: 'window',
              objectGroup: 'event-listeners',
            });
            objectId = result.objectId ?? undefined;
          } else if (target === 'document') {
            const {result} = await session.sendCommand<{
              result: {objectId?: string | null};
            }>('Runtime.evaluate', {
              expression: 'document',
              objectGroup: 'event-listeners',
            });
            objectId = result.objectId ?? undefined;
          } else {
            if (!selector) {
              throw new Error('selector is required when target is "selector".');
            }
            const {root} = await session.sendCommand<{root: {nodeId: number}}>(
              'DOM.getDocument',
              {depth: 0, pierce: true},
            );
            const {nodeId} = await session.sendCommand<{nodeId: number}>(
              'DOM.querySelector',
              {
                nodeId: root.nodeId,
                selector,
              },
            );
            if (!nodeId) {
              throw new Error(`No element matches selector "${selector}".`);
            }
            const resolved = await client.DOM.resolveNode({nodeId});
            objectId = resolved.object?.objectId ?? undefined;
          }

          if (!objectId) {
            throw new Error('Unable to resolve object for event listener inspection.');
          }

          const {listeners} = await client.DOMDebugger.getEventListeners({
            objectId,
            depth: includeAncestors ? depth : 0,
          });

          const filtered = (listeners ?? []).filter(listener => {
            if (eventTypes?.length) {
              return eventTypes.includes(listener.type);
            }
            return true;
          });

          const limited = filtered.slice(0, maxListeners);
          if (!limited.length) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No event listeners found for the specified target.',
                },
              ],
            };
          }

          const lines = limited.map((listener, index) => formatListener(listener, index));
          if (filtered.length > limited.length) {
            lines.push(`… ${filtered.length - limited.length} more listener(s) truncated.`);
          }

          return {
            content: [
              {
                type: 'text',
                text: lines.join('\n\n'),
              },
            ],
          };
        } finally {
          await release();
          await session
            .sendCommand('Runtime.releaseObjectGroup', {
              objectGroup: 'event-listeners',
            })
            .catch(() => {});
        }
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Failed to list event listeners: ${error.message}`
                  : 'Failed to list event listeners.',
            },
          ],
        };
      }
    },
  );
}

function formatListener(
  listener: {
    type: string;
    useCapture?: boolean;
    passive?: boolean;
    once?: boolean;
    handler?: {className?: string; description?: string};
    location?: {
      scriptId?: string;
      lineNumber?: number;
      columnNumber?: number;
    };
    scriptId?: string;
    lineNumber?: number;
    columnNumber?: number;
  },
  index: number,
): string {
  const flags = [
    listener.useCapture ? 'capture' : 'bubble',
    listener.passive ? 'passive' : undefined,
    listener.once ? 'once' : undefined,
  ].filter(Boolean);
  const header = `#${index + 1} ${listener.type}${flags.length ? ` (${flags.join(', ')})` : ''}`;

  const handlerName = listener.handler?.className ?? listener.handler?.description ?? 'anonymous function';

  const location = listener.location ?? {
    scriptId: listener.scriptId,
    lineNumber: listener.lineNumber,
    columnNumber: listener.columnNumber,
  };
  const position = location?.scriptId
    ? `script ${location.scriptId}:${(location.lineNumber ?? 0) + 1}:${(location.columnNumber ?? 0) + 1}`
    : 'script location unavailable';

  return [
    header,
    `handler: ${handlerName}`,
    `location: ${position}`,
  ].join('\n');
}
