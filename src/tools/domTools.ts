import {z} from 'zod';

import {DomInspector, type SelectorSummary} from '../domInspector.js';
import type {PageSession} from '../pageSession.js';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

const selectorShape = {
  selector: z
    .string()
    .min(1, 'Provide a CSS selector (e.g., #app, .button).'),
} as const;

const describeShape = {
  ...selectorShape,
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional zero-based index when multiple elements match.'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1)
    .describe('Maximum number of matches to return when index is not specified.'),
  includeOuterHtml: z
    .boolean()
    .default(false)
    .describe('Include a snippet of the element outer HTML in the response.'),
} as const;

const outerHtmlShape = {
  ...selectorShape,
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional zero-based index of the element to return.'),
} as const;

const accessibilityShape = {
  selector: z
    .string()
    .min(1)
    .optional()
    .describe('Optional CSS selector to focus on a subtree. Defaults to full tree.'),
  maxDepth: z
    .number()
    .int()
    .min(0)
    .max(6)
    .default(2)
    .describe('Maximum depth to traverse in the accessibility tree (default 2).'),
  maxNodes: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(200)
    .describe('Maximum nodes to include when fetching the full tree.'),
} as const;

interface DescribeArgs {
  selector: string;
  index?: number;
  maxResults: number;
  includeOuterHtml: boolean;
}

interface OuterHtmlArgs {
  selector: string;
  index?: number;
}

interface AccessibilityArgs {
  selector?: string;
  maxDepth: number;
  maxNodes: number;
}

const ATTRIBUTE_DISPLAY_LIMIT = 8;

export function registerDomTools(server: McpServer, session: PageSession): void {
  const inspector = new DomInspector(session);

  server.registerTool(
    'dom_query_selector',
    {
      description: 'Inspect the first element that matches a CSS selector.',
      inputSchema: describeShape,
    },
    async ({selector, index, maxResults, includeOuterHtml}: DescribeArgs) => {
      try {
        const summaries = await inspector.describeSelector({
          selector,
          index,
          maxResults,
          includeOuterHtml,
        });
        const text = formatSummaries(summaries, includeOuterHtml);
        return {
          content: [
            {
              type: 'text',
              text,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'DOM query failed.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'dom_get_outer_html',
    {
      description: 'Return the full outer HTML of the first matching element.',
      inputSchema: outerHtmlShape,
    },
    async ({selector, index}: OuterHtmlArgs) => {
      try {
        const outerHTML = await inspector.getOuterHTML(selector, index);
        return {
          content: [
            {
              type: 'text',
              text: outerHTML,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Unable to fetch outer HTML.',
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'dom_accessibility_tree',
    {
      description:
        'Dump the accessibility tree for the page or a targeted subtree.',
      inputSchema: accessibilityShape,
    },
    async ({selector, maxDepth, maxNodes}: AccessibilityArgs) => {
      try {
        const tree = await inspector.getAccessibilityTree({
          selector,
          maxDepth,
          maxNodes,
        });
        return {
          content: [
            {
              type: 'text',
              text: tree,
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
                  ? error.message
                  : 'Failed to retrieve accessibility tree.',
            },
          ],
        };
      }
    },
  );
}

function formatSelectorSummary(
  summary: SelectorSummary,
  includeOuterHtml: boolean,
): string {
  const lines: string[] = [];
  lines.push(`Selector: ${summary.selector}`);
  lines.push(`Match index: ${summary.index}`);
  lines.push(`Node: <${summary.nodeName.toLowerCase()}> (#${summary.nodeId})`);
  lines.push(`Backend node id: ${summary.backendNodeId}`);

  const attributes = Object.entries(summary.attributes);
  if (attributes.length) {
    const display = attributes.slice(0, ATTRIBUTE_DISPLAY_LIMIT);
    const attrText = display
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    const extra = attributes.length > display.length
      ? ` (+${attributes.length - display.length} more)`
      : '';
    lines.push(`Attributes: ${attrText}${extra}`);
  } else {
    lines.push('Attributes: none');
  }

  if (typeof summary.childNodeCount === 'number') {
    lines.push(`Child nodes: ${summary.childNodeCount}`);
  }

  if (summary.textSnippet) {
    lines.push(`Text snippet: ${summary.textSnippet}`);
  }

  if (includeOuterHtml && summary.outerHTMLSnippet) {
    lines.push('Outer HTML snippet:');
    lines.push(summary.outerHTMLSnippet);
  }

  return lines.join('\n');
}

function formatSummaries(
  summaries: SelectorSummary[],
  includeOuterHtml: boolean,
): string {
    if (!summaries.length) {
      return 'No matches found.';
    }
    if (summaries.length === 1) {
      return formatSelectorSummary(summaries[0]!, includeOuterHtml);
    }
    return summaries
      .map((summary, idx) => {
        const header = `Match ${idx + 1}/${summaries.length} (index ${summary.index})`;
        return `${header}\n${formatSelectorSummary(summary, includeOuterHtml)}`;
      })
      .join('\n\n---\n\n');
}
