import {z} from 'zod';

import {DomActions} from '../domActions.js';
import type {PageSession} from '../pageSession.js';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

const selectorShape = {
  selector: z
    .string()
    .min(1, 'Provide a CSS selector targeting an element.'),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional zero-based index when multiple elements match.'),
} as const;

const clickArgsSchema = z.object(selectorShape);
type ClickArgs = z.infer<typeof clickArgsSchema>;

const typeArgsSchema = z.object({
  ...selectorShape,
  text: z
    .string()
    .describe('Text to insert into the element.'),
  replace: z
    .boolean()
    .default(true)
    .describe('Replace existing value (true) or append (false).'),
  submit: z
    .boolean()
    .default(false)
    .describe('Attempt to submit the containing form after typing.'),
});
type TypeArgs = z.infer<typeof typeArgsSchema>;

export function registerDomActions(
  server: McpServer,
  session: PageSession,
): void {
  const actions = new DomActions(session);

  server.registerTool(
    'dom_click',
    {
      description: 'Trigger a click on the element matched by a selector.',
      inputSchema: clickArgsSchema.shape,
    },
    async ({selector, index}: ClickArgs) => {
      try {
        await actions.click({selector, index});
        return {
          content: [
            {
              type: 'text',
              text: `Clicked element ${selector}${index !== undefined ? ` (index ${index})` : ''}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Click failed.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'dom_type_text',
    {
      description: 'Set or append text content in an element matched by a selector.',
      inputSchema: typeArgsSchema.shape,
    },
    async ({selector, text, index, replace, submit}: TypeArgs) => {
      try {
        await actions.type({selector, text, index, replace, submit});
        const action = replace ? 'Set' : 'Appended';
        const suffix = submit ? ' and submitted form' : '';
        return {
          content: [
            {
              type: 'text',
              text: `${action} text on ${selector}${index !== undefined ? ` (index ${index})` : ''}${suffix}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Typing failed.',
            },
          ],
        };
      }
    },
  );
}
