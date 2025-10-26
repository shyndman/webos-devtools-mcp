import type CDP from 'chrome-remote-interface';

import type {PageSession} from './pageSession.js';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ConsoleStreamOptions {
  levels?: Array<'log' | 'debug' | 'info' | 'warn' | 'error'>;
  includeExceptions?: boolean;
  includeStack?: boolean;
}

const DEFAULT_LEVELS: ConsoleStreamOptions['levels'] = [
  'log',
  'debug',
  'info',
  'warn',
  'error',
];

export class ConsoleStreamManager {
  #session: PageSession;
  #server: McpServer;
  #client?: CDP.Client;
  #subscription?: ConsoleStreamOptions;
  #consoleListener?: (...args: unknown[]) => void;
  #exceptionListener?: (...args: unknown[]) => void;

  constructor(session: PageSession, server: McpServer) {
    this.#session = session;
    this.#server = server;
  }

  get active(): boolean {
    return !!this.#subscription;
  }

  get options(): ConsoleStreamOptions | undefined {
    return this.#subscription;
  }

  async subscribe(options: ConsoleStreamOptions): Promise<void> {
    const client = await this.#session.getClient();
    await client.Runtime.enable().catch(() => {});
    this.#client = client;

    const normalized: ConsoleStreamOptions = {
      levels: options.levels?.length ? options.levels : DEFAULT_LEVELS,
      includeExceptions: options.includeExceptions ?? true,
      includeStack: options.includeStack ?? false,
    };

    this.#subscription = normalized;

    if (!this.#consoleListener) {
      this.#consoleListener = (...args: unknown[]) => {
        const event = (args[0] ?? {}) as ConsoleEvent;
        this.#handleConsoleEvent(event);
      };
      client.on('Runtime.consoleAPICalled', this.#consoleListener);
    }

    if (!this.#exceptionListener) {
      this.#exceptionListener = (...args: unknown[]) => {
        const event = (args[0] ?? {}) as ExceptionEvent;
        this.#handleException(event);
      };
      client.on('Runtime.exceptionThrown', this.#exceptionListener);
    }
  }

  async unsubscribe(): Promise<void> {
    const client = this.#client ?? (await this.#session.getClient());
    if (this.#consoleListener) {
      removeListener(client, 'Runtime.consoleAPICalled', this.#consoleListener);
      this.#consoleListener = undefined;
    }
    if (this.#exceptionListener) {
      removeListener(client, 'Runtime.exceptionThrown', this.#exceptionListener);
      this.#exceptionListener = undefined;
    }
    this.#subscription = undefined;
  }

  #handleConsoleEvent(event: ConsoleEvent): void {
    if (!this.#subscription) {
      return;
    }

    const streamLevel = mapConsoleTypeToStreamLevel(event.type);
    if (!this.#subscription.levels?.includes(streamLevel)) {
      return;
    }

    const loggingLevel = mapConsoleTypeToLoggingLevel(event.type);
    const text = formatConsoleMessage(event);
    const stack = this.#subscription.includeStack
      ? formatStack(event.stackTrace)
      : undefined;
    this.#sendLogging(loggingLevel, text, stack);
  }

  #handleException(event: ExceptionEvent): void {
    if (!this.#subscription?.includeExceptions) {
      return;
    }
    const message = event.exceptionDetails.text ?? event.exceptionDetails.exception?.description ?? 'Unhandled exception';
    const stack = this.#subscription.includeStack
      ? formatStack(event.exceptionDetails.stackTrace)
      : undefined;
    this.#sendLogging('error', `[exception] ${message}`, stack);
  }

  #sendLogging(level: 'debug' | 'info' | 'warning' | 'error', message: string, stack?: string): void {
    const composed = stack ? `${message}\n${stack}` : message;
    void this.#server.server.sendLoggingMessage({
      level,
      message: composed,
    }).catch(() => {});
  }
}

interface ConsoleArg {
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  type?: string;
}

interface StackFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface StackTrace {
  callFrames?: StackFrame[];
}

interface ConsoleEvent {
  type: string;
  args?: ConsoleArg[];
  stackTrace?: StackTrace;
}

interface ExceptionEvent {
  exceptionDetails: {
    text?: string;
    exception?: {
      description?: string;
    };
    stackTrace?: StackTrace;
  };
}

function mapConsoleTypeToStreamLevel(type: ConsoleEvent['type']): 'log' | 'debug' | 'info' | 'warn' | 'error' {
  switch (type) {
    case 'assert':
    case 'error':
      return 'error';
    case 'warning':
      return 'warn';
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    default:
      return 'log';
  }
}

function mapConsoleTypeToLoggingLevel(type: ConsoleEvent['type']): 'debug' | 'info' | 'warning' | 'error' {
  switch (type) {
    case 'assert':
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'debug':
      return 'debug';
    case 'info':
    case 'log':
    case 'dir':
    case 'dirxml':
      return 'info';
    default:
      return 'info';
  }
}

function formatConsoleMessage(event: ConsoleEvent): string {
  const header = `[console.${event.type}]`;
  const args = event.args ?? [];
  const formattedArgs = args.map(arg => describeRemoteObject(arg)).join(' ');
  return `${header} ${formattedArgs}`.trim();
}

function describeRemoteObject(object: ConsoleArg): string {
  if (object.value !== undefined) {
    const value = object.value;
    if (typeof value === 'object' && value !== null) {
      try {
        return JSON.stringify(value);
      } catch {
        return '[object]';
      }
    }
    return String(value);
  }
  if (object.unserializableValue) {
    return object.unserializableValue;
  }
  if (object.description) {
    return object.description;
  }
  return object.type ?? 'undefined';
}

function formatStack(stack?: StackTrace): string | undefined {
  if (!stack?.callFrames?.length) {
    return undefined;
  }
  const firstFrames = stack.callFrames.slice(0, 5);
  const lines = firstFrames.map(frame => {
    const location = `${frame.url ?? '<anonymous>'}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
    return `  at ${frame.functionName || '<anonymous>'} (${location})`;
  });
  return lines.length ? lines.join('\n') : undefined;
}

function removeListener(
  client: CDP.Client,
  event: string,
  handler: (...args: unknown[]) => void,
): void {
  const candidate = client as unknown as {
    off?: (e: string, h: (...args: unknown[]) => void) => void;
    removeListener?: (e: string, h: (...args: unknown[]) => void) => void;
  };
  if (typeof candidate.off === 'function') {
    candidate.off(event, handler);
  } else if (typeof candidate.removeListener === 'function') {
    candidate.removeListener(event, handler);
  }
}
