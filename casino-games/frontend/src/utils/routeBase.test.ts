import { describe, expect, it } from 'vitest';
import { withAppBasePath } from './routeBase';

describe('withAppBasePath', () => {
  it('prefixes Vite sub-app routes for full-page OAuth redirects', () => {
    expect(withAppBasePath('/square-of-shadows?room=AB12CD', '/games/')).toBe('/games/square-of-shadows?room=AB12CD');
    expect(withAppBasePath('/', '/games/')).toBe('/games/');
  });

  it('does not duplicate a base already present and leaves root-hosted apps unchanged', () => {
    expect(withAppBasePath('/games/outlands', '/games/')).toBe('/games/outlands');
    expect(withAppBasePath('/square-of-shadows', '/')).toBe('/square-of-shadows');
  });
});
