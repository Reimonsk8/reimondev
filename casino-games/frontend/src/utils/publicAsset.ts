/** Resolve a file from `frontend/public` under the configured Vite base path. */
export function publicAsset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
