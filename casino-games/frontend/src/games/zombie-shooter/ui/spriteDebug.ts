import type { PaperdollDebugInfo } from '../engine/paperdoll';

/**
 * Dev-only live sprite inspector (`?debug=sprites` on localhost).
 * Shows the player sheet, the row/column being drawn, and the live anim/weapon state.
 */
export function mountSpriteDebug(getDebug: () => PaperdollDebugInfo | null): () => void {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:9999;background:rgba(8,12,18,.92);' +
    'border:1px solid #2b3a4a;border-radius:6px;padding:8px 10px;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;' +
    'color:#9fd0ff;pointer-events:none;max-width:340px;';
  const text = document.createElement('div');
  text.style.whiteSpace = 'pre';
  text.style.cssText = 'white-space:pre;font:inherit;color:inherit;pointer-events:none;';
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.display = 'inline-block';
  const img = document.createElement('img');
  img.style.cssText = 'display:block;image-rendering:pixelated;pointer-events:none;max-width:none;max-height:240px;';
  const box = document.createElement('div');
  box.style.position = 'absolute';
  box.style.border = '1px solid #ffd166';
  box.style.background = 'rgba(255,209,102,.14)';
  box.style.pointerEvents = 'none';
  wrap.append(img, box);
  panel.append(text, wrap);
  document.body.append(panel);

  const timer = window.setInterval(() => {
    const d = getDebug();
    if (!d) {
      text.textContent = 'sprite debug: no player';
      return;
    }
    text.textContent =
      `state: ${d.state}  frame: ${d.frameIndex}\n` +
      `octant: ${d.octant}  sheetRow: ${d.row}  cell: ${d.frame.width}x${d.frame.height} @ ${d.frame.x},${d.frame.y}\n` +
      `sheet: ${d.animKey}\n` +
      `weapon: ${d.weaponKey ?? 'none'}\n` +
      `pos: ${d.pos.x.toFixed(1)},${d.pos.y.toFixed(1)}`;
    if (img.getAttribute('src') !== d.sheetUrl) {
      img.src = d.sheetUrl;
    }
    if (img.complete && img.naturalWidth > 0) {
      const scale = 256 / img.naturalHeight;
      img.style.width = `${Math.round(img.naturalWidth * scale)}px`;
      img.style.height = `${Math.round(img.naturalHeight * scale)}px`;
      box.style.left = `${d.frame.x * scale}px`;
      box.style.top = `${d.frame.y * scale}px`;
      box.style.width = `${d.frame.width * scale}px`;
      box.style.height = `${d.frame.height * scale}px`;
    }
  }, 120);

  return () => {
    window.clearInterval(timer);
    panel.remove();
  };
}
