import {z} from 'zod';

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import {NetworkRecorder, type NetworkRequestRecord} from '../networkRecorder.js';
import type {PageSession} from '../pageSession.js';

const listRequestsShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe('Maximum number of requests to return.'),
  includeHeaders: z
    .boolean()
    .default(false)
    .describe('Include request/response headers in the output.'),
  methods: z
    .array(z.string())
    .optional()
    .describe('Filter to specific HTTP methods (e.g., GET, POST).'),
  onlyFailed: z
    .boolean()
    .default(false)
    .describe('Include only failed requests.'),
  resourceTypes: z
    .array(z.string())
    .optional()
    .describe('Filter by resource types reported by Chrome (e.g., XHR, Document).'),
} as const;

const bodyShape = {
  requestId: z
    .string()
    .min(1, 'Provide the requestId from network_list_requests.'),
  kind: z
    .enum(['response', 'request'])
    .default('response')
    .describe('Choose response to fetch response body, request for outbound payload.'),
} as const;

export function registerNetworkTools(
  server: McpServer,
  session: PageSession,
): void {
  const recorder = new NetworkRecorder(session);

  server.registerTool('network_start_capture', {
    description: 'Begin capturing network activity for the current page.',
  }, async () => {
    await recorder.start();
    return {
      content: [
        {
          type: 'text',
          text: 'Network capture started.',
        },
      ],
    };
  });

  server.registerTool('network_stop_capture', {
    description: 'Stop capturing network activity.',
  }, async () => {
    await recorder.stop();
    const count = recorder.getRequests().length;
    return {
      content: [
        {
          type: 'text',
          text: `Network capture stopped. Recorded ${count} request${count === 1 ? '' : 's'}.`,
        },
      ],
    };
  });

  server.registerTool('network_clear_capture', {
    description: 'Clear captured network requests.',
  }, async () => {
    recorder.clear();
    return {
      content: [
        {
          type: 'text',
          text: 'Cleared captured network requests.',
        },
      ],
    };
  });

  const listArgsSchema = z.object(listRequestsShape);
  type ListArgs = z.infer<typeof listArgsSchema>;

  const bodyArgsSchema = z.object(bodyShape);
  type BodyArgs = z.infer<typeof bodyArgsSchema>;

  server.registerTool(
    'network_list_requests',
    {
      description: 'List captured network requests with optional filtering.',
      inputSchema: listRequestsShape,
    },
    async ({
      limit,
      includeHeaders,
      methods,
      onlyFailed,
      resourceTypes,
    }: ListArgs) => {
      const requests = recorder.getRequests();
      const filtered = requests.filter(request => {
        if (methods?.length && !methods.includes(request.method)) {
          return false;
        }
        if (onlyFailed && !request.errorText && request.status && request.status < 400) {
          return false;
        }
        if (resourceTypes?.length && request.resourceType && !resourceTypes.includes(request.resourceType)) {
          return false;
        }
        return true;
      });
      const selected = filtered.slice(0, limit);
      if (!selected.length) {
        return {
          content: [
            {
              type: 'text',
              text: 'No requests matched the specified filters.',
            },
          ],
        };
      }
      const lines = selected.map(record => formatRequest(record, includeHeaders));
      return {
        content: [
          {
            type: 'text',
            text: lines.join('\n\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'network_get_request_body',
    {
      description: 'Retrieve the response or request body for a captured request.',
      inputSchema: bodyShape,
    },
    async ({requestId, kind}: BodyArgs) => {
      if (kind === 'request') {
        const data = await recorder.getRequestPostData(requestId);
        if (data == null) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'No request body available or request not found.',
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: data,
            },
          ],
        };
      }

      const responseBody = await recorder.getResponseBody(requestId);
      if (!responseBody) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'No response body available or request not found.',
            },
          ],
        };
      }
      if (responseBody.base64Encoded) {
        return {
          content: [
            {
              type: 'text',
              text: '(Response body is base64 encoded; returning inline base64.)',
            },
            {
              type: 'text',
              text: responseBody.body,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: responseBody.body,
          },
        ],
      };
    },
  );
}

function formatRequest(record: NetworkRequestRecord, includeHeaders: boolean): string {
  const status = record.status ? `${record.status} ${record.statusText ?? ''}`.trim() : record.errorText ?? 'pending';
  const duration = record.startTime && record.endTime
    ? ` (${((record.endTime - record.startTime) * 1000).toFixed(0)} ms)`
    : '';
  const lines = [
    `${record.requestId} | ${record.method} ${record.url}`,
    `status: ${status}${duration}`,
    record.resourceType ? `type: ${record.resourceType}` : undefined,
    record.encodedDataLength !== undefined ? `size: ${record.encodedDataLength} bytes` : undefined,
    record.fromCache ? 'from cache' : undefined,
  ].filter(Boolean);

  if (includeHeaders) {
    if (record.requestHeaders && Object.keys(record.requestHeaders).length) {
      lines.push('request headers:', formatHeaders(record.requestHeaders));
    }
    if (record.responseHeaders && Object.keys(record.responseHeaders).length) {
      lines.push('response headers:', formatHeaders(record.responseHeaders));
    }
  }

  return lines.join('\n');
}

function formatHeaders(headers: Record<string, unknown>): string {
  return Object.entries(headers)
    .map(([key, value]) => `  ${key}: ${String(value)}`)
    .join('\n');
}
