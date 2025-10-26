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
  returnScreenshot?: boolean;
}

const DEFAULT_DURATION_MS = 2 * 60 * 1000; // 2 minutes

export class OverlayManager {
  #session: PageSession;
  #client?: CDP.Client;
  #timer?: NodeJS.Timeout;
  #decoratedNodes = new Set<number>();

  constructor(session: PageSession) {
    this.#session = session;
  }

  async highlight(options: HighlightOptions): Promise<{screenshot?: string}> {
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
      borderColor: options.borderColor ?? {r: 255, g: 255, b: 255, a: 0.95},
      contentColor: options.color ?? {r: 0, g: 120, b: 215, a: 0.25},
      showInfo: options.showInfo ?? true,
      showRulers: options.showRulers ?? false,
      showExtensionLines: false,
      showStyles: false,
      marginColor: options.includeMargin
        ? {r: 255, g: 170, b: 0, a: 0.35}
        : undefined,
      paddingColor: options.includePadding
        ? {r: 0, g: 200, b: 60, a: 0.35}
        : undefined,
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

    await this.#applyFocusRing(nodeId);

    const duration = options.durationMs ?? DEFAULT_DURATION_MS;
    if (duration > 0) {
      this.#timer = setTimeout(() => {
        void this.hide();
      }, duration);
    }

    if (options.returnScreenshot ?? true) {
      const screenshot = await this.#session.captureScreenshot({format: 'png'});
      return {screenshot: screenshot.data};
    }

    return {};
  }

  async hide(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    await this.#restoreDecorations();

    if (!this.#client) {
      return;
    }

    try {
      await this.#client.Overlay.hideHighlight();
    } catch {
      // Ignore overlay hide errors; target may have navigated.
    }
  }

  async highlightFocused(
    options: Omit<HighlightOptions, 'selector' | 'nodeId'> = {},
  ): Promise<{screenshot?: string}> {
    const client = await this.#getClient();
    const {root} = await client.DOM.getDocument({depth: 0, pierce: true});

    const {result} = await this.#session.sendCommand<{
      result: {objectId?: string | null};
    }>('Runtime.evaluate', {
      expression: 'document.activeElement',
      objectGroup: 'overlay',
      includeCommandLineAPI: false,
    });

    if (result.objectId) {
      try {
        const {nodeId} = await client.DOM.requestNode({objectId: result.objectId});
        if (nodeId) {
    return await this.highlight({nodeId, ...options});
  }
      } finally {
        await this.#session.sendCommand('Runtime.releaseObjectGroup', {
          objectGroup: 'overlay',
        }).catch(() => {});
      }
    }

    return await this.highlight({nodeId: root.nodeId, ...options});
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

  async #applyFocusRing(nodeId: number): Promise<void> {
    const client = await this.#getClient();
    try {
      const {object} = await client.DOM.resolveNode({nodeId});
      const objectId = object?.objectId;
      if (!objectId) {
        return;
      }
      try {
        await this.#session.sendCommand('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function applyRing(){
          const key = '__mcpOverlayRing';
          if (!this[key]) {
            this[key] = {
              outline: this.style.outline || '',
              outlineOffset: this.style.outlineOffset || '',
              boxShadow: this.style.boxShadow || '',
            };
          }
          this.style.outline = '6px solid #ff00ff';
          this.style.outlineOffset = '10px';
          this.style.boxShadow = '0 0 0 12px rgba(0,0,0,0.7)';
        }`,
        });
        this.#decoratedNodes.add(nodeId);
      } finally {
        await this.#session.sendCommand('Runtime.releaseObject', {
          objectId,
        }).catch(() => {});
      }
    } catch {
      // ignore decoration failures
    }
  }

  async #restoreDecorations(): Promise<void> {
    if (this.#decoratedNodes.size === 0) {
      return;
    }
    const client = await this.#getClient();
    const nodes = Array.from(this.#decoratedNodes);
    this.#decoratedNodes.clear();
    await Promise.all(nodes.map(async nodeId => {
      try {
        const {object} = await client.DOM.resolveNode({nodeId});
        const objectId = object?.objectId;
        if (!objectId) {
          return;
        }
        try {
          await this.#session.sendCommand('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: `function restoreRing(){
            const key = '__mcpOverlayRing';
            const saved = this[key];
            if (saved) {
              this.style.outline = saved.outline;
              this.style.outlineOffset = saved.outlineOffset;
              this.style.boxShadow = saved.boxShadow;
              delete this[key];
            } else {
              this.style.outline = '';
              this.style.outlineOffset = '';
              this.style.boxShadow = '';
            }
          }`,
          });
        } finally {
          await this.#session.sendCommand('Runtime.releaseObject', {
            objectId,
          }).catch(() => {});
        }
      } catch {
        // ignore restoration errors
      }
    }));
  }
}
