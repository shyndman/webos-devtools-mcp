import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import pkg from '../../package.json' with {type: 'json'};
import buildInfo from '../../dist/build-info.json' with {type: 'json'};

export function registerStaticResources(server: McpServer): void {
  server.registerResource(
    'about/version',
    'resource://about/version',
    {
      title: 'Server Version',
      description: 'Version information for the WebOS DevTools MCP server.',
      mimeType: 'text/plain',
    },
    async () => {
      const info = [
        ['name', pkg.name ?? 'unknown'],
        ['version', pkg.version ?? '0.0.0'],
        ['node', process.version],
        ['gitCommit', buildInfo?.commit ?? 'unknown'],
        ['gitDirty', buildInfo?.dirty === true ? 'yes' : buildInfo?.dirty === false ? 'no' : 'unknown'],
        ['buildGeneratedAt', buildInfo?.generatedAt ?? 'unknown'],
      ];

      const text = info.map(([key, value]) => `${key}: ${value}`).join('\n');

      return {
        contents: [
          {
            text,
            uri: 'resource://about/version',
            mimeType: 'text/plain',
          },
        ],
      };
    },
  );
}
