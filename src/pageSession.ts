import CDP from 'chrome-remote-interface';

const MAX_BUFFERED_ENTRIES = 500;

export type LogKind = 'console' | 'exception' | 'log';

export interface PageLogEntry {
  id: number;
  kind: LogKind;
  level: string;
  message: string;
  timestamp: Date;
  source?: string;
  url?: string;
}

export interface EvaluateOptions {
  awaitPromise?: boolean;
  returnByValue?: boolean;
}

export interface EvaluateResult {
  type: string;
  value: string;
  description?: string;
}

export interface ScreenshotOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality?: number;
  captureBeyondViewport?: boolean;
  fromSurface?: boolean;
}

export class PageSession {
  #endpoint: string;
  #client?: CDP.Client;
  #clientPromise?: Promise<CDP.Client>;
  #entries: PageLogEntry[] = [];
  #nextId = 1;

  constructor(endpoint: string) {
    this.#endpoint = endpoint;
  }

  async connect(): Promise<void> {
    await this.#ensureClient();
  }

  async evaluate(
    expression: string,
    options: EvaluateOptions = {},
  ): Promise<EvaluateResult> {
    const client = await this.#ensureClient();
    const result = await client.Runtime.evaluate({
      expression,
      awaitPromise: options.awaitPromise ?? true,
      returnByValue: options.returnByValue ?? true,
      userGesture: true,
    });

    if (result.exceptionDetails) {
      const message =
        this.#formatExceptionDetails(result.exceptionDetails) ??
        'Evaluation threw an exception';
      throw new Error(message);
    }

    return {
      type: result.result.type ?? 'undefined',
      value: this.#formatRemoteObject(result.result),
      description: result.result.description,
    };
  }

  async captureScreenshot(options: ScreenshotOptions): Promise<{
    data: string;
    mimeType: string;
  }> {
    const client = await this.#ensureClient();
    try {
      await client.Page.bringToFront();
    } catch {
      // Ignore failures when the page cannot be focused remotely.
    }

    const screenshot = await client.Page.captureScreenshot({
      format: options.format,
      quality: options.quality,
      captureBeyondViewport: options.captureBeyondViewport ?? false,
      fromSurface: options.fromSurface ?? true,
    });

    return {
      data: screenshot.data,
      mimeType: `image/${options.format}`,
    };
  }

  getEntries(params: {
    limit?: number;
    kinds?: LogKind[];
    newestFirst?: boolean;
  }): PageLogEntry[] {
    const {limit = 20, kinds, newestFirst = true} = params;
    const subset = kinds?.length
      ? this.#entries.filter(entry => kinds.includes(entry.kind))
      : this.#entries;
    const slice = subset.slice(Math.max(0, subset.length - limit));
    return newestFirst ? [...slice].reverse() : slice;
  }

  clearEntries(): void {
    this.#entries = [];
    this.#nextId = 1;
  }

  async dispose(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    this.#clientPromise = undefined;
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore shutdown errors.
      }
    }
  }

  async #ensureClient(): Promise<CDP.Client> {
    if (this.#client) {
      return this.#client;
    }
    if (!this.#clientPromise) {
      this.#clientPromise = this.#connectInternal();
    }
    this.#client = await this.#clientPromise;
    return this.#client;
  }

  async #connectInternal(): Promise<CDP.Client> {
    const client = await CDP({target: this.#endpoint});
    this.#registerDisconnectHandler(client);
    await this.#enableDomains(client);
    this.#registerEventHandlers(client);
    await this.#maybeRunWaitingDebugger(client);
    return client;
  }

  async #enableDomains(client: CDP.Client): Promise<void> {
    await client.Runtime.enable();
    await client.Page.enable().catch(() => {});
    if (client.Console?.enable) {
      await client.Console.enable().catch(() => {});
    }
    if (client.Log?.enable) {
      await client.Log.enable().catch(() => {});
    }
  }

  async #maybeRunWaitingDebugger(client: CDP.Client): Promise<void> {
    // Some runtimes pause awaiting debugger on connect; poke them once.
    await client.Runtime.runIfWaitingForDebugger().catch(() => {});
  }

  #registerDisconnectHandler(client: CDP.Client): void {
    client.on('disconnect', () => {
      this.#client = undefined;
      this.#clientPromise = undefined;
      this.#entries = [];
      this.#nextId = 1;
    });
  }

  #registerEventHandlers(client: CDP.Client): void {
    client.Runtime.consoleAPICalled(params => {
      const message =
        params.args && params.args.length > 0
          ? params.args
              .map(arg => this.#formatRemoteObject(arg))
              .join(' ')
          : params.type ?? 'log';
      this.#recordEntry({
        kind: 'console',
        level: params.type ?? 'log',
        message: message ?? '',
        timestamp: this.#timestampFromSeconds(params.timestamp),
        url: params.stackTrace?.callFrames?.[0]?.url,
      });
    });

    client.Runtime.exceptionThrown(params => {
      const details = params.exceptionDetails;
      const message =
        this.#formatExceptionDetails(details) ?? 'Runtime exception thrown';
      this.#recordEntry({
        kind: 'exception',
        level: 'error',
        message,
        timestamp: this.#timestampFromSeconds(params.timestamp),
        url: details.url,
      });
    });

    client.Log.entryAdded?.(({entry}) => {
      this.#recordEntry({
        kind: 'log',
        level: entry.level ?? 'info',
        message: entry.text ?? '',
        timestamp: this.#timestampFromSeconds(entry.timestamp),
        source: entry.source,
        url: entry.url,
      });
    });
  }

  #recordEntry(entry: Omit<PageLogEntry, 'id'>): void {
    const withId: PageLogEntry = {
      ...entry,
      id: this.#nextId++,
    };
    this.#entries.push(withId);
    if (this.#entries.length > MAX_BUFFERED_ENTRIES) {
      this.#entries.splice(0, this.#entries.length - MAX_BUFFERED_ENTRIES);
    }
  }

  #formatRemoteObject(raw: unknown): string {
    const remote = raw as {
      type?: string;
      value?: unknown;
      description?: string;
      unserializableValue?: string;
    };

    if (remote.value !== undefined) {
      try {
        if (
          typeof remote.value === 'object' &&
          remote.value !== null
        ) {
          return JSON.stringify(remote.value);
        }
        return String(remote.value);
      } catch {
        return String(remote.value);
      }
    }
    if (remote.unserializableValue) {
      return remote.unserializableValue;
    }
    if (remote.description) {
      return remote.description;
    }
    return remote.type ?? 'undefined';
  }

  #formatExceptionDetails(details: unknown): string | undefined {
    const exceptionDetails = details as {
      text?: string;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
      exception?: {description?: string; value?: unknown};
    };
    const base =
      exceptionDetails.text ??
      exceptionDetails.exception?.description ??
      (exceptionDetails.exception?.value
        ? String(exceptionDetails.exception.value)
        : undefined);
    const location =
      exceptionDetails.url && exceptionDetails.lineNumber !== undefined
        ? `${exceptionDetails.url}:${exceptionDetails.lineNumber + 1}${
            exceptionDetails.columnNumber !== undefined
              ? `:${exceptionDetails.columnNumber + 1}`
              : ''
          }`
        : undefined;
    if (location) {
      return base ? `${base} (${location})` : location;
    }
    return base;
  }

  #timestampFromSeconds(value?: number): Date {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return new Date();
    }
    if (value > 1e12) {
      return new Date(value);
    }
    if (value > 1e6) {
      return new Date(value / 1000);
    }
    return new Date(value * 1000);
  }
}
