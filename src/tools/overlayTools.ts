import {z} from 'zod';

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import {OverlayManager} from '../overlayManager.js';
import type {PageSession} from '../pageSession.js';

const highlightShape = {
  selector: z
    .string()
    .min(1)
    .optional()
    .describe('CSS selector for the element to highlight.'),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(600000)
    .default(2 * 60 * 1000)
    .describe('Duration the overlay should remain visible (default 2 minutes).'),
  includeMargin: z
    .boolean()
    .default(false),
  includePadding: z
    .boolean()
    .default(false),
  showInfo: z
    .boolean()
    .default(true),
  color: z
    .array(z.number().min(0).max(255))
    .length(4)
    .optional()
    .describe('RGBA fill color (0-255 each component).'),
  borderColor: z
    .array(z.number().min(0).max(255))
    .length(4)
    .optional()
    .describe('RGBA border color (0-255 each component).'),
} as const;

export function registerOverlayTools(
  server: McpServer,
  session: PageSession,
): void {
  const overlay = new OverlayManager(session);
  const highlightArgsSchema = z.object(highlightShape);
  type HighlightArgs = z.infer<typeof highlightArgsSchema>;

  server.registerTool(
    'overlay_highlight',
    {
      description: 'Highlight the element matching a selector.',
      inputSchema: highlightShape,
    },
    async ({
      selector,
      durationMs,
      includeMargin,
      includePadding,
      showInfo,
      color,
      borderColor,
    }: HighlightArgs): Promise<any> => {
      if (!selector) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'selector is required for overlay_highlight.',
            },
          ],
        };
      }

      try {
        const {screenshot} = await overlay.highlight({
          selector,
          durationMs,
          includeMargin,
          includePadding,
          showInfo,
          color: color ? toOverlayColor(color) : undefined,
          borderColor: borderColor ? toOverlayColor(borderColor) : undefined,
        });
        const content: Array<
          | {type: 'text'; text: string}
          | {type: 'image'; data: string; mimeType: string}
        > = [
          {
            type: 'text',
            text: `Highlighted ${selector} for ${Math.round((durationMs ?? 120000) / 1000)} seconds.`,
          },
        ];
        if (screenshot) {
          content.push({
            type: 'image',
            data: screenshot,
            mimeType: 'image/png',
          });
        }
        return {
          content,
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Failed to highlight: ${error.message}`
                  : 'Failed to highlight element.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'overlay_highlight_focused',
    {
      description: 'Highlight the currently focused element (document.activeElement).',
    },
    async (): Promise<any> => {
      try {
        const {screenshot} = await overlay.highlightFocused();
        const content: Array<
          | {type: 'text'; text: string}
          | {type: 'image'; data: string; mimeType: string}
        > = [
          {
            type: 'text',
            text: 'Highlighted focused element.',
          },
        ];
        if (screenshot) {
          content.push({
            type: 'image',
            data: screenshot,
            mimeType: 'image/png',
          });
        }
        return {
          content,
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Failed to highlight focused element: ${error.message}`
                  : 'Failed to highlight focused element.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'overlay_hide',
    {
      description: 'Hide any active overlay highlight immediately.',
    },
    async (): Promise<any> => {
      await overlay.hide();
      return {
        content: [
          {
            type: 'text',
            text: 'Overlay hidden.',
          },
        ],
      };
    },
  );
}

function toOverlayColor([r, g, b, a]: number[]): {r: number; g: number; b: number; a: number} {
  return {
    r,
    g,
    b,
    a: a / 255,
  };
}
