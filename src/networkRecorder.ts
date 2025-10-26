import type CDP from 'chrome-remote-interface';

import type {PageSession} from './pageSession.js';

export interface NetworkRequestRecord {
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  initiatorType?: string;
  startTime: number;
  wallTime?: number;
  status?: number;
  statusText?: string;
  mimeType?: string;
  encodedDataLength?: number;
  requestHeaders?: Record<string, unknown>;
  responseHeaders?: Record<string, unknown>;
  fromCache?: boolean;
  endTime?: number;
  errorText?: string;
  requestBodySize?: number;
  responseBodySize?: number;
}

export class NetworkRecorder {
  #session: PageSession;
  #client?: CDP.Client;
  #capturing = false;
  #requests = new Map<string, NetworkRequestRecord>();
  #order: string[] = [];
  #attached = false;

  constructor(session: PageSession) {
    this.#session = session;
  }

  async start(): Promise<void> {
    const client = await this.#getClient();
    await client.Network.enable({});
    this.#requests.clear();
    this.#order = [];
    this.#capturing = true;
  }

  async stop(): Promise<void> {
    this.#capturing = false;
  }

  clear(): void {
    this.#requests.clear();
    this.#order = [];
  }

  getRequests(): NetworkRequestRecord[] {
    return this.#order
      .map(id => this.#requests.get(id))
      .filter((record): record is NetworkRequestRecord => !!record);
  }

  async getResponseBody(requestId: string): Promise<{
    body: string;
    base64Encoded: boolean;
  } | null> {
    try {
      const client = await this.#getClient();
      const body = await client.Network.getResponseBody({requestId});
      return body;
    } catch {
      return null;
    }
  }

  async getRequestPostData(requestId: string): Promise<string | null> {
    try {
      const client = await this.#getClient();
      const data = await client.Network.getRequestPostData({requestId});
      return data.postData ?? null;
    } catch {
      return null;
    }
  }

  async #getClient(): Promise<CDP.Client> {
    if (this.#client) {
      return this.#client;
    }
    const client = await this.#session.getClient();
    this.#client = client;
    if (!this.#attached) {
      this.#attachListeners(client);
      this.#attached = true;
    }
    return client;
  }

  #attachListeners(client: CDP.Client): void {
    client.on('Network.requestWillBeSent', params => {
      if (!this.#capturing) {
        return;
      }
      const requestId = params.requestId;
      const record = this.#ensureRecord(requestId);
      record.url = params.request.url;
      record.method = params.request.method;
      record.resourceType = params.type;
      record.initiatorType = params.initiator?.type;
      record.startTime = params.timestamp ?? record.startTime;
      record.wallTime = params.wallTime;
      record.requestHeaders = params.request.headers as Record<string, unknown>;
      if (params.request.hasPostData) {
        record.requestBodySize = params.request.postData?.length;
      }
    });

    client.on('Network.responseReceived', params => {
      if (!this.#capturing) {
        return;
      }
      const record = this.#ensureRecord(params.requestId);
      record.status = params.response.status;
      record.statusText = params.response.statusText;
      record.mimeType = params.response.mimeType;
      record.responseHeaders = params.response.headers as Record<string, unknown>;
      record.fromCache = params.response.fromDiskCache || params.response.fromServiceWorker;
    });

    client.on('Network.loadingFinished', params => {
      if (!this.#capturing) {
        return;
      }
      const record = this.#ensureRecord(params.requestId);
      record.encodedDataLength = params.encodedDataLength;
      record.responseBodySize = params.encodedDataLength;
      record.endTime = params.timestamp ?? record.endTime;
    });

    client.on('Network.loadingFailed', params => {
      if (!this.#capturing) {
        return;
      }
      const record = this.#ensureRecord(params.requestId);
      record.errorText = params.errorText ?? 'Request failed';
      record.endTime = params.timestamp ?? record.endTime;
    });
  }

  #ensureRecord(requestId: string): NetworkRequestRecord {
    let record = this.#requests.get(requestId);
    if (!record) {
      record = {
        requestId,
        url: '',
        method: 'GET',
        startTime: Date.now() / 1000,
      };
      this.#requests.set(requestId, record);
      this.#order.push(requestId);
    }
    return record;
  }
}
