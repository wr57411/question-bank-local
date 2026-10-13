import type { ExprNode } from '../types';

export type QuestionTagMap = Map<string, ReadonlySet<string>>;

// 与 ExprNode 同构，每个节点附带自身命中题数（自底向上可观测性要求）。
export type ExprCountNode =
  | { op: 'and' | 'or'; count: number; children: ExprCountNode[] }
  | { tag: string; count: number };

export interface ExprEvalResult {
  hits: Set<string>;
  counts: ExprCountNode;
}

function indexByTag(questionTags: QuestionTagMap): Map<string, Set<string>> {
  const byTag = new Map<string, Set<string>>();
  for (const [questionId, tags] of questionTags) {
    for (const tagId of tags) {
      let bucket = byTag.get(tagId);
      if (!bucket) {
        bucket = new Set();
        byTag.set(tagId, bucket);
      }
      bucket.add(questionId);
    }
  }
  return byTag;
}

// 空 groups（含根分组无子节点）一律命中空集：不采用 and(∅)=全集 的数学语义，
// 否则「纯手工专题」会意外命中整库。
export function evalExpr(expr: ExprNode, questionTags: QuestionTagMap): ExprEvalResult {
  const byTag = indexByTag(questionTags);

  function evalNode(node: ExprNode): { hits: Set<string>; counts: ExprCountNode } {
    if ('tag' in node) {
      const hits = new Set(byTag.get(node.tag) ?? []);
      return { hits, counts: { tag: node.tag, count: hits.size } };
    }

    const children = node.children.map(evalNode);

    if (children.length === 0) {
      return { hits: new Set(), counts: { op: node.op, count: 0, children: [] } };
    }

    let hits: Set<string>;
    if (node.op === 'or') {
      hits = new Set();
      for (const child of children) {
        for (const id of child.hits) hits.add(id);
      }
    } else {
      hits = new Set(children[0].hits);
      for (let i = 1; i < children.length; i++) {
        const other = children[i].hits;
        for (const id of [...hits]) {
          if (!other.has(id)) hits.delete(id);
        }
      }
    }

    return { hits, counts: { op: node.op, count: hits.size, children: children.map((c) => c.counts) } };
  }

  const evaluated = evalNode(expr);
  return { hits: evaluated.hits, counts: evaluated.counts };
}

const OP_CHAR: Record<'and' | 'or', string> = { and: '且', or: '或' };

// 可读回显：如「（圆周运动 或 平抛运动）且 较难」。分岔节点加括号，根节点不加。
export function formatExpr(expr: ExprNode, nameOf: (tagId: string) => string): string {
  function render(node: ExprNode, isRoot: boolean): string {
    if ('tag' in node) return nameOf(node.tag);
    if (node.children.length === 0) return '（空）';
    const joined = node.children.map((c) => render(c, false)).join(' ' + OP_CHAR[node.op] + ' ');
    const compact = joined.replace(/）\s+(且|或)\s+/g, '）$1 ');
    return isRoot ? compact : '（' + compact + '）';
  }
  return render(expr, true);
}

export function exprContainsTag(expr: ExprNode, tagId: string): boolean {
  if ('tag' in expr) return expr.tag === tagId;
  return expr.children.some((c) => exprContainsTag(c, tagId));
}

export function collectExprTagIds(expr: ExprNode): string[] {
  const ids: string[] = [];
  function walk(node: ExprNode): void {
    if ('tag' in node) { ids.push(node.tag); return; }
    for (const child of node.children) walk(child);
  }
  walk(expr);
  return ids;
}

// 死引用清理 = 物理移除该叶子；移除后变空的子分组一并剔除，避免留下无意义的空壳。
export function removeTagFromExpr(expr: ExprNode, tagId: string): ExprNode {
  function clean(node: ExprNode): ExprNode | null {
    if ('tag' in node) return node.tag === tagId ? null : node;
    const children = node.children
      .map(clean)
      .filter((c): c is ExprNode => c !== null)
      .filter((c) => !('op' in c) || c.children.length > 0);
    return { op: node.op, children };
  }
  return clean(expr) ?? { op: 'or', children: [] };
}

export function collectDeadTagRefs(expr: ExprNode, knownTagIds: Iterable<string>): string[] {
  const known = new Set(knownTagIds);
  const dead = new Set<string>();
  const ordered: string[] = [];

  function walk(node: ExprNode): void {
    if ('tag' in node) {
      if (!known.has(node.tag) && !dead.has(node.tag)) {
        dead.add(node.tag);
        ordered.push(node.tag);
      }
      return;
    }
    for (const child of node.children) walk(child);
  }

  walk(expr);
  return ordered;
}
