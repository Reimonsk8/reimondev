import { useEffect, useState } from 'react';
import { atlasFrames, createAnimatedSprite, loadSpriteAtlas, type SpriteAtlas } from './AtlasLoader';

export type SpriteAtlasState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; atlas: SpriteAtlas }
  | { status: 'error'; error: Error };

/**
 * Loads one sprite-gen atlas and exposes its state machines. Callers build
 * AnimatedSprites via createAnimatedSprite when status === 'ready'.
 */
export function useSpriteAtlas(name: string | undefined, baseUrl = ''): SpriteAtlasState {
  const [state, setState] = useState<SpriteAtlasState>({ status: 'idle' });

  useEffect(() => {
    if (!name) {
      setState({ status: 'idle' });
      return;
    }
    let disposed = false;
    setState({ status: 'loading' });
    loadSpriteAtlas(name, baseUrl)
      .then((atlas) => {
        if (!disposed) setState({ status: 'ready', atlas });
      })
      .catch((err: unknown) => {
        if (!disposed) setState({ status: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      });
    return () => {
      disposed = true;
    };
  }, [name, baseUrl]);

  return state;
}

/** Convenience: frame textures for a state when the atlas is ready. */
export function useAtlasFrames(name: string | undefined, stateName: string, baseUrl = ''): ReturnType<typeof atlasFrames> {
  const atlasState = useSpriteAtlas(name, baseUrl);
  return atlasState.status === 'ready' ? atlasFrames(atlasState.atlas, stateName) : [];
}

/** Convenience: an AnimatedSprite for a state when the atlas is ready. */
export function useAnimatedSprite(name: string | undefined, stateName: string, baseUrl = ''): ReturnType<typeof createAnimatedSprite> {
  const atlasState = useSpriteAtlas(name, baseUrl);
  return atlasState.status === 'ready' ? createAnimatedSprite(atlasState.atlas, stateName) : null;
}