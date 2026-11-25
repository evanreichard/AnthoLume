export const appRoutes = [
  {
    id: 'providers',
    children: [
      { id: 'login', path: 'login' },
      { id: 'register', path: 'register' },
      {
        id: 'shell',
        children: [
          {
            id: 'protected',
            children: [
              { id: 'home', index: true },
              { id: 'library', path: 'library' },
              { id: 'bookMatcher', path: 'library/matcher' },
              { id: 'book', path: 'books/:kind' },
              { id: 'reader', path: 'read/:kind' },
              { id: 'insights', path: 'insights' },
              { id: 'activity', path: 'insights/activity' },
              { id: 'progress', path: 'insights/progress' },
              { id: 'rankings', path: 'insights/rankings' },
              { id: 'settings', path: 'settings' },
              {
                id: 'admin',
                path: 'admin',
                children: [
                  { id: 'adminHome', index: true },
                  { id: 'adminLibrary', path: 'library' },
                  { id: 'users', path: 'users' },
                  { id: 'system', path: 'system' },
                  { id: 'logs', path: 'logs' },
                ],
              },
              { id: 'notFound', path: '*' },
            ],
          },
        ],
      },
    ],
  },
] as const;

type NodeOf<T> = T extends { children: readonly (infer Child)[] } ? T | NodeOf<Child> : T;
export type AppRoute = NodeOf<(typeof appRoutes)[number]>;

export function shellPaths(): string[] {
  const paths = new Set<string>();
  function visit(route: AppRoute, parent: string) {
    if ('index' in route) {
      paths.add(parent || '/');
      return;
    }
    if ('path' in route && route.path === '*') return;
    const path = 'path' in route ? `${parent}/${route.path}` : parent;
    if ('path' in route) {
      const concrete = path.endsWith('/:kind')
        ? ['local', 'server'].map((kind) => path.replace(':kind', kind))
        : [path];
      for (const item of concrete) {
        if (!/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+$/.test(item)) throw new Error(`Unexpanded shell route: ${item}`);
        paths.add(item);
      }
    }
    if ('children' in route) for (const child of route.children) visit(child, path);
  }
  for (const route of appRoutes) visit(route, '');
  return [...paths].sort();
}

export function matchesShell(paths: ReadonlySet<string>, pathname: string) {
  return paths.has(pathname.length > 2 ? pathname.replace(/\/$/, '') : pathname);
}
