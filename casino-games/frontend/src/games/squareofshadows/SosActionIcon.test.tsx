import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SosActionIcon } from './SosActionIcon';

describe('selected-unit action icon mapping', () => {
  it.each([
    ['WARRIOR', 'sword'],
    ['RANGER', 'bow'],
    ['WIZARD', 'staff'],
    ['CLERIC', 'mace'],
  ] as const)('%s Attack uses its class weapon', (unitType, expectedIcon) => {
    const markup = renderToStaticMarkup(
      createElement(SosActionIcon, { kind: 'attack', unitType }),
    );
    expect(markup).toContain(`data-icon="${expectedIcon}"`);
  });

  it('has distinct Move and Act mode icons and a punch fallback', () => {
    const icon = (kind: 'move' | 'act' | 'attack') =>
      renderToStaticMarkup(createElement(SosActionIcon, { kind }));

    expect(icon('move')).toContain('data-icon="move"');
    expect(icon('act')).toContain('data-icon="act"');
    expect(icon('attack')).toContain('data-icon="punch"');
  });
});
