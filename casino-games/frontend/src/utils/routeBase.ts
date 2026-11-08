/** Convert an app-internal route into a full browser path for page reloads. */
export function withAppBasePath(target: string, baseUrl = import.meta.env.BASE_URL || '/') {
  const normalizedTarget = target.startsWith('/') ? target : `/${target}`;
  const prefix = `/${baseUrl.split('/').filter(Boolean).join('/')}`.replace(/^\/$/, '');

  if (!prefix || normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`)) {
    return normalizedTarget;
  }
  return `${prefix}${normalizedTarget}`;
}
