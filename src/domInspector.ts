import {PageSession} from './pageSession.js';

const TEXT_SNIPPET_LIMIT = 200;
const OUTER_HTML_SNIPPET_LIMIT = 400;

export class DomInspector {
  #session: PageSession;
  #accessibilityEnabled = false;

  constructor(session: PageSession) {
    this.#session = session;
  }

  async describeSelector(params: {
    selector: string;
    index?: number;
    maxResults?: number;
    includeOuterHtml?: boolean;
  }): Promise<SelectorSummary[]> {
    const {selector, index, maxResults = 1, includeOuterHtml = false} = params;
    if (index !== undefined && index < 0) {
      throw new Error('Index must be 0 or greater.');
    }

    const matches = await this.#querySelectorAll(selector, maxResults, index);
    if (!matches.length) {
      throw new Error(`No element matches selector "${selector}".`);
    }

    const summaries: SelectorSummary[] = [];
    for (const match of matches) {
      const node = await this.#describeNode(match.nodeId);
      summaries.push({
        selector,
        index: match.index,
        nodeId: match.nodeId,
        backendNodeId: node.backendNodeId ?? 0,
        nodeName: node.nodeName,
        attributes: this.#attributesToMap(node.attributes),
        childNodeCount: node.childNodeCount,
        textSnippet: await this.#readTextSnippet(selector, TEXT_SNIPPET_LIMIT, match.index),
        outerHTMLSnippet: includeOuterHtml
          ? await this.#getOuterHtml(match.nodeId, OUTER_HTML_SNIPPET_LIMIT)
          : undefined,
      });
    }
    return summaries;
  }

  async getOuterHTML(
    selector: string,
    index?: number,
  ): Promise<string> {
    const nodeId = await this.#querySelectorWithIndex(selector, index);
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
    const results = await this.#querySelectorAll(selector, 1);
    if (!results.length) {
      throw new Error(`No element matches selector "${selector}".`);
    }
    return results[0]?.nodeId ?? 0;
  }

  async #querySelectorWithIndex(
    selector: string,
    index?: number,
  ): Promise<number> {
    const results = await this.#querySelectorAll(
      selector,
      index !== undefined ? index + 1 : 1,
      index,
    );
    if (!results.length) {
      throw new Error(`No element matches selector "${selector}".`);
    }
    return results[0]?.nodeId ?? 0;
  }

  async #querySelectorAll(
    selector: string,
    maxResults: number,
    desiredIndex?: number,
  ): Promise<Array<{nodeId: number; index: number}>> {
    const {root} = await this.#session.sendCommand<{root: {nodeId: number}}>(
      'DOM.getDocument',
      {depth: 0, pierce: true},
    );
    const {nodeIds} = await this.#session.sendCommand<{nodeIds: number[]}>(
      'DOM.querySelectorAll',
      {
        nodeId: root.nodeId,
        selector,
      },
    );

    if (!nodeIds?.length) {
      return [];
    }

    const matches: Array<{nodeId: number; index: number}> = [];
    const capped = desiredIndex !== undefined ? desiredIndex + 1 : maxResults;
    const length = Math.min(nodeIds.length, capped);
    for (let i = 0; i < length; i++) {
      if (desiredIndex !== undefined && i !== desiredIndex) {
        continue;
      }
      matches.push({nodeId: nodeIds[i]!, index: i});
      if (desiredIndex === undefined && matches.length >= maxResults) {
        break;
      }
    }
    return matches;
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
    index?: number,
  ): Promise<string | null> {
    const expression = `(() => {
      const nodes = document.querySelectorAll(${JSON.stringify(selector)});
      const node = nodes[${index ?? 0}] ?? null;
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
  nodeId?: number;
  backendNodeId?: number;
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

export interface SelectorSummary {
  selector: string;
  index: number;
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  attributes: Record<string, string>;
  childNodeCount?: number;
  textSnippet?: string | null;
  outerHTMLSnippet?: string;
}
