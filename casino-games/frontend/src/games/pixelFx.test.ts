import { describe, expect, it } from 'vitest';
import { PIXEL_FX } from './pixelFx.generated';
import { SOS_PIXEL_FX } from './squareofshadows/pixelFx';

describe('generated pixelfx manifest', () => {
  it('describes every effect the exporter wrote', () => {
    const slugs = Object.keys(PIXEL_FX);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      const meta = PIXEL_FX[slug as keyof typeof PIXEL_FX];
      expect(meta.slug).toBe(slug);
      expect(meta.frames).toBeGreaterThan(0);
      expect(meta.frameWidth).toBeGreaterThan(0);
      expect(meta.frameHeight).toBeGreaterThan(0);
      expect(meta.fps).toBeGreaterThan(0);
      expect(meta.durationMs).toBeGreaterThan(0);
      expect(meta.pivot[0]).toBeGreaterThanOrEqual(0);
      expect(meta.pivot[1]).toBeGreaterThanOrEqual(0);
    }
  });

  it('only references exported effects from the Square of Shadows map', () => {
    for (const [ability, slug] of Object.entries(SOS_PIXEL_FX)) {
      expect(PIXEL_FX, `${ability} -> ${slug} is missing from the generated manifest`).toHaveProperty(slug);
    }
  });
});
