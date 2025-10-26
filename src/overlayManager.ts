import type CDP from 'chrome-remote-interface';

import type {PageSession} from './pageSession.js';

export interface HighlightOptions {
  selector?: string;
  nodeId?: number;
  durationMs?: number;
  color?: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
  borderColor?: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
  showInfo?: boolean;
  showRulers?: boolean;
  includeMargin?: boolean;
  includePadding?: boolean;
}

const DEFAULT_DURATION_MS = 2 * 60 * 1000; // 2 minutes

export class OverlayManager {
  #session: PageSession;
  #client?: CDP.Client;
  #timer?: NodeJS.Timeout;

  constructor(session: PageSession) {
    this.#session = session;
  }

  async highlight(options: HighlightOptions): Promise<void> {
    await this.hide();
    const client = await this.#getClient();
    let nodeId = options.nodeId;
    if (!nodeId) {
      if (!options.selector) {
        throw new Error('Provide either selector or nodeId for highlighting.');
      }
      nodeId = await this.#resolveSelector(options.selector);
    }

    const highlightConfig = {
      borderColor: options.borderColor ?? {r: 255, g: 0, b: 0, a: 0.8},
      contentColor: options.color ?? {r: 255, g: 0, b: 0, a: 0.15},
      showInfo: options.showInfo ?? true,
      showRulers: options.showRulers ?? false,
      showExtensionLines: false,
      showStyles: false,
      marginColor: options.includeMargin ? {r: 128, g: 128, b: 128, a: 0.3} : undefined,
      paddingColor: options.includePadding ? {r: 0, g: 128, b: 255, a: 0.25} : undefined,
    } satisfies {
      borderColor?: {r: number; g: number; b: number; a: number};
      contentColor?: {r: number; g: number; b: number; a: number};
      showInfo?: boolean;
      showRulers?: boolean;
      showExtensionLines?: boolean;
      showStyles?: boolean;
      marginColor?: {r: number; g: number; b: number; a: number};
      paddingColor?: {r: number; g: number; b: number; a: number};
    };

    await client.Overlay.highlightNode({
      nodeId,
      highlightConfig,
    });

    const duration = options.durationMs ?? DEFAULT_DURATION_MS;
    if (duration > 0) {
      this.#timer = setTimeout(() => {
        void this.hide();
      }, duration);
    }
  }

  async hide(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    if (!this.#client) {
      return;
    }

    try {
      await this.#client.Overlay.hideHighlight();
    } catch {
      // Ignore overlay hide errors; target may have navigated.
    }
  }

  async highlightFocused(): Promise<void> {
    const client = await this.#getClient();
    let nodeId: number | undefined;
    try {
      const focusResult = await client.DOM.getDocument({depth: -1, pierce: true});
      nodeId = focusResult.root.nodeId;
    } catch {
      // ignore
    }
    if (!nodeId) {
      const {result} = await this.#session.sendCommand<{
        result: {objectId?: string};
      }>('Runtime.evaluate', {
        expression: 'document.activeElement',
        objectGroup: 'overlay',
      });
      if (result.objectId) {
        const resolved = await this.#session.sendCommand<{
          nodeId: number;
        }>('DOM.requestNode', {objectId: result.objectId});
        nodeId = resolved.nodeId;
      }
    }
    if (!nodeId) {
      throw new Error('Unable to resolve focused element.');
    }
    await this.highlight({nodeId});
  }

  async #resolveSelector(selector: string): Promise<number> {
    const {root} = await this.#session.sendCommand<{root: {nodeId: number}}>(
      'DOM.getDocument',
      {depth: 0, pierce: true},
    );
    const {nodeId} = await this.#session.sendCommand<{nodeId: number}>(
      'DOM.querySelector',
      {
        nodeId: root.nodeId,
        selector,
      },
    );
    if (!nodeId) {
      throw new Error(`No element matches selector "${selector}".`);
    }
    return nodeId;
  }

  async #getClient(): Promise<CDP.Client> {
    if (this.#client) {
      return this.#client;
    }
    const client = await this.#session.getClient();
    await client.Overlay.enable();
    this.#client = client;
    return client;
  }
}
