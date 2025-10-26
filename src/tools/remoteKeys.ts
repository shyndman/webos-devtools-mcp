import {z} from 'zod';

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import type {PageSession} from '../pageSession.js';

const KEY_MAP: Record<string, {key: string; code: string; keyCode: number}> = {
  up: {key: 'ArrowUp', code: 'ArrowUp', keyCode: 38},
  down: {key: 'ArrowDown', code: 'ArrowDown', keyCode: 40},
  left: {key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37},
  right: {key: 'ArrowRight', code: 'ArrowRight', keyCode: 39},
  ok: {key: 'Enter', code: 'Enter', keyCode: 13},
  back: {key: 'GoBack', code: 'BrowserBack', keyCode: 461},
  red: {key: 'F1', code: 'F1', keyCode: 403},
  green: {key: 'F2', code: 'F2', keyCode: 404},
  yellow: {key: 'F3', code: 'F3', keyCode: 405},
  blue: {key: 'F4', code: 'F4', keyCode: 406},
  home: {key: 'Home', code: 'Home', keyCode: 36},
  menu: {key: 'ContextMenu', code: 'ContextMenu', keyCode: 93},
  info: {key: 'Info', code: 'Info', keyCode: 457},
  exit: {key: 'Exit', code: 'Exit', keyCode: 464},
  channelup: {key: 'ChannelUp', code: 'ChannelUp', keyCode: 402},
  channeldown: {key: 'ChannelDown', code: 'ChannelDown', keyCode: 401},
  volumeup: {key: 'AudioVolumeUp', code: 'AudioVolumeUp', keyCode: 175},
  volumedown: {key: 'AudioVolumeDown', code: 'AudioVolumeDown', keyCode: 174},
  mute: {key: 'AudioVolumeMute', code: 'AudioVolumeMute', keyCode: 173},
  digit0: {key: '0', code: 'Digit0', keyCode: 48},
  digit1: {key: '1', code: 'Digit1', keyCode: 49},
  digit2: {key: '2', code: 'Digit2', keyCode: 50},
  digit3: {key: '3', code: 'Digit3', keyCode: 51},
  digit4: {key: '4', code: 'Digit4', keyCode: 52},
  digit5: {key: '5', code: 'Digit5', keyCode: 53},
  digit6: {key: '6', code: 'Digit6', keyCode: 54},
  digit7: {key: '7', code: 'Digit7', keyCode: 55},
  digit8: {key: '8', code: 'Digit8', keyCode: 56},
  digit9: {key: '9', code: 'Digit9', keyCode: 57},
  play: {key: 'MediaPlay', code: 'MediaPlay', keyCode: 179},
  pause: {key: 'MediaPause', code: 'MediaPause', keyCode: 19},
  stop: {key: 'MediaStop', code: 'MediaStop', keyCode: 178},
  fastforward: {key: 'MediaFastForward', code: 'MediaFastForward', keyCode: 228},
  rewind: {key: 'MediaRewind', code: 'MediaRewind', keyCode: 227},
};

const dispatchShape = {
  key: z
    .enum(Object.keys(KEY_MAP) as [keyof typeof KEY_MAP, ...Array<keyof typeof KEY_MAP>])
    .describe('Logical key to dispatch (e.g., up, left, ok, red).'),
  repeat: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(1)
    .describe('Number of key repeat events to send.'),
  delayMs: z
    .number()
    .int()
    .min(0)
    .max(2000)
    .default(0)
    .describe('Delay in milliseconds between repeats.'),
  customKey: z
    .string()
    .optional()
    .describe('Override DOM key value (optional).'),
  customCode: z
    .string()
    .optional()
    .describe('Override DOM code value (optional).'),
  customKeyCode: z
    .number()
    .int()
    .optional()
    .describe('Override Windows virtual key code (optional).'),
} as const;

const textShape = {
  text: z
    .string()
    .min(1, 'Provide text to send.')
    .max(256, 'Limit text to a reasonable size for remote input.'),
} as const;

export function registerRemoteKeyTools(
  server: McpServer,
  session: PageSession,
): void {
  const dispatchArgsSchema = z.object(dispatchShape);
  type DispatchArgs = z.infer<typeof dispatchArgsSchema>;

  const textArgsSchema = z.object(textShape);
  type TextArgs = z.infer<typeof textArgsSchema>;

  server.registerTool(
    'remote_press_key',
    {
      description: 'Dispatches a remote control key (with optional repeats).',
      inputSchema: dispatchShape,
    },
    async ({key, repeat, delayMs, customKey, customCode, customKeyCode}: DispatchArgs) => {
      const mapping = KEY_MAP[key];
      if (!mapping && (!customKey || customKeyCode === undefined)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unsupported key: ${key}. Provide customKey/customKeyCode to override.`,
            },
          ],
        };
      }
      const keyValue = customKey ?? mapping?.key ?? 'Unidentified';
      const codeValue = customCode ?? mapping?.code ?? 'Unidentified';
      const keyCode = customKeyCode ?? mapping?.keyCode ?? 0;
      const client = await session.getClient();
      for (let i = 0; i < repeat; i++) {
        await client.Input.dispatchKeyEvent({
          type: 'keyDown',
          key: keyValue,
          code: codeValue,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode,
          unmodifiedText: keyValue.length === 1 ? keyValue : undefined,
          text: keyValue.length === 1 ? keyValue : undefined,
        });
        await client.Input.dispatchKeyEvent({
          type: 'keyUp',
          key: keyValue,
          code: codeValue,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode,
        });
        if (delayMs > 0 && i + 1 < repeat) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Pressed ${key}${repeat > 1 ? ` x${repeat}` : ''}.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'remote_type_text',
    {
      description: 'Send a text string via character key events.',
      inputSchema: textShape,
    },
    async ({text}: TextArgs) => {
      const client = await session.getClient();
      await client.Input.insertText({text});
      return {
        content: [
          {
            type: 'text',
            text: `Typed ${text.length} character${text.length === 1 ? '' : 's'}.`,
          },
        ],
      };
    },
  );
}
