import type { Category } from './types.js';

export interface CategoryNode extends Category {
  children: CategoryNode[];
  depth: number;
  path: string;
}

/** Builds a sorted tree (by sortOrder, then name) from a flat category list. */
export function buildCategoryTree(categories: Category[], separator = ' > '): CategoryNode[] {
  const nodes = new Map<number, CategoryNode>();
  for (const c of categories) nodes.set(c.id, { ...c, children: [], depth: 0, path: c.name });
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId != null ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: CategoryNode[], depth: number, prefix: string) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'nb'));
    for (const n of list) {
      n.depth = depth;
      n.path = prefix ? `${prefix}${separator}${n.name}` : n.name;
      sort(n.children, depth + 1, n.path);
    }
  };
  sort(roots, 0, '');
  return roots;
}

/** Depth-first flattening of a tree, useful for indented pickers. */
export function flattenTree(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (list: CategoryNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Ids of a category and all its descendants. */
export function descendantIds(categories: Pick<Category, 'id' | 'parentId'>[], rootId: number): Set<number> {
  const byParent = new Map<number, number[]>();
  for (const c of categories) {
    if (c.parentId == null) continue;
    const list = byParent.get(c.parentId) ?? [];
    list.push(c.id);
    byParent.set(c.parentId, list);
  }
  const result = new Set<number>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of byParent.get(id) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result;
}
