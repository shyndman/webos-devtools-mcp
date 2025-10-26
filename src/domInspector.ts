import {PageSession} from './pageSession.js';

const TEXT_SNIPPET_LIMIT = 200;
const OUTER_HTML_SNIPPET_LIMIT = 400;

export interface SelectorSummary {
  selector: string;
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  attributes: Record<string, string>;
  childNodeCount?: number;
  textSnippet?: string | null;
  outerHTMLSnippet?: string;
}

export class DomInspector {
  #session: PageSession;
  #accessibilityEnabled = false;

  constructor(session: PageSession) {
    this.#session = session;
  }

  async describeSelector(selector: string): Promise<SelectorSummary> {
    const nodeId = await this.#querySelector(selector);
    const node = await this.#describeNode(nodeId);
    const attributes = this.#attributesToMap(node.attributes);
    const textSnippet = await this.#readTextSnippet(selector);
    const outerHtml = await this.#getOuterHtml(nodeId, OUTER_HTML_SNIPPET_LIMIT);

    return {
      selector,
      nodeId,
      backendNodeId: node.backendNodeId,
      nodeName: node.nodeName,
      attributes,
      childNodeCount: node.childNodeCount,
      textSnippet,
      outerHTMLSnippet: outerHtml,
    };
  }

  async getOuterHTML(selector: string): Promise<string> {
    const nodeId = await this.#querySelector(selector);
    const response = await this.#session.sendCommand<{outerHTML: string}>(
      'DOM.getOuterHTML',
      {nodeId},
    );
    return response.outerHTML;
  }

  async getAccessibilityTree(params: {
    selector?: string;
    maxDepth?: number;
    maxNodes?: number;
  }): Promise<string> {
    const {selector, maxDepth = 2, maxNodes = 200} = params;
    await this.#ensureAccessibilityEnabled();

    if (selector) {
      const nodeId = await this.#querySelector(selector);
      const response = await this.#session.sendCommand<{
        nodes: AccessibilityNode[];
      }>('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: true,
        maxDepth,
      });
      return this.#formatAccessibilityTree(response.nodes, maxDepth);
    }

    const response = await this.#session.sendCommand<{
      nodes: AccessibilityNode[];
    }>('Accessibility.getFullAXTree', {
      depth: maxDepth,
      maxNodes,
    });
    return this.#formatAccessibilityTree(response.nodes, maxDepth);
  }

  async #querySelector(selector: string): Promise<number> {
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

  async #describeNode(nodeId: number): Promise<DescribedNode> {
    const response = await this.#session.sendCommand<{node: DescribedNode}>(
      'DOM.describeNode',
      {
        nodeId,
        depth: 0,
        pierce: true,
      },
    );
    return response.node;
  }

  async #readTextSnippet(
    selector: string,
    limit: number = TEXT_SNIPPET_LIMIT,
  ): Promise<string | null> {
    const expression = `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) {
        return null;
      }
      const text = node.innerText ?? node.textContent ?? '';
      return text.slice(0, ${limit}).trim();
    })()`;
    try {
      const result = await this.#session.evaluate(expression);
      return result.value ?? null;
    } catch {
      return null;
    }
  }

  async #getOuterHtml(
    nodeId: number,
    limit: number,
  ): Promise<string | undefined> {
    const response = await this.#session.sendCommand<{outerHTML: string}>(
      'DOM.getOuterHTML',
      {nodeId},
    );
    const outerHTML = response.outerHTML?.trim();
    if (!outerHTML) {
      return undefined;
    }
    if (outerHTML.length <= limit) {
      return outerHTML;
    }
    return `${outerHTML.slice(0, limit)}…`;
  }

  #attributesToMap(attributes?: string[]): Record<string, string> {
    if (!attributes?.length) {
      return {};
    }
    const map: Record<string, string> = {};
    for (let i = 0; i < attributes.length; i += 2) {
      const name = attributes[i];
      const value = attributes[i + 1] ?? '';
      map[name] = value;
    }
    return map;
  }

  async #ensureAccessibilityEnabled(): Promise<void> {
    if (this.#accessibilityEnabled) {
      return;
    }
    try {
      await this.#session.sendCommand('Accessibility.enable');
      this.#accessibilityEnabled = true;
    } catch {
      // Accessibility domain may be unavailable; keep disabled but allow graceful failure later.
    }
  }

  #formatAccessibilityTree(nodes: AccessibilityNode[], maxDepth: number): string {
    if (!nodes.length) {
      return 'Accessibility tree is empty.';
    }
    const map = new Map(nodes.map(node => [node.nodeId, node]));
    const roots = this.#findAxRoots(nodes);
    const lines: string[] = [];
    const visited = new Set<string>();

    const walk = (id: string, depth: number) => {
      if (depth > maxDepth) {
        return;
      }
      const node = map.get(id);
      if (!node || visited.has(id)) {
        return;
      }
      visited.add(id);
      lines.push(`${'  '.repeat(depth)}- ${this.#formatAxNode(node)}`);
      for (const childId of node.childIds ?? []) {
        walk(childId, depth + 1);
      }
    };

    for (const rootId of roots) {
      walk(rootId, 0);
    }

    return lines.join('\n');
  }

  #findAxRoots(nodes: AccessibilityNode[]): string[] {
    if (!nodes.length) {
      return [];
    }
    const referenced = new Set<string>();
    for (const node of nodes) {
      for (const childId of node.childIds ?? []) {
        referenced.add(childId);
      }
    }
    const roots = nodes
      .filter(node => !referenced.has(node.nodeId))
      .map(node => node.nodeId);
    return roots.length ? roots : [nodes[0].nodeId];
  }

  #formatAxNode(node: AccessibilityNode): string {
    const role = node.role?.value ?? 'unknown';
    const name = node.name?.value;
    const value = node.value?.value;
    const ignored = node.ignored ? ' (ignored)' : '';
    const parts = [`role=${role}${ignored}`];
    if (name) {
      parts.push(`name="${name}"`);
    }
    if (value) {
      parts.push(`value="${value}"`);
    }
    if (node.description?.value) {
      parts.push(`description="${node.description.value}"`);
    }
    return parts.join(' | ');
  }
}

interface DescribedNode {
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  nodeValue?: string;
  childNodeCount?: number;
  attributes?: string[];
}

interface AccessibilityNode {
  nodeId: string;
  role?: {value?: string};
  name?: {value?: string};
  value?: {value?: string};
  description?: {value?: string};
  ignored?: boolean;
  childIds?: string[];
}
