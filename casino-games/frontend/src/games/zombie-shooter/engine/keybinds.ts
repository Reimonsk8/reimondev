export type KeybindAction =
  | 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'
  | 'reload' | 'flashlight'
  | 'weapon1' | 'weapon2' | 'weapon3'
  | 'inventory' | 'character' | 'map' | 'outpost'
  | 'heal' | 'food' | 'antiviral' | 'armor';

export const DEFAULT_KEYBINDS: Record<KeybindAction, string> = {
  moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
  reload: 'KeyR', flashlight: 'KeyF',
  weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3',
  inventory: 'KeyI', character: 'KeyC', map: 'KeyM', outpost: 'KeyO',
  heal: 'KeyH', food: 'KeyJ', antiviral: 'KeyV', armor: 'KeyG',
};

const STORAGE_KEY = 'outlands_keybinds';

export function loadKeybinds(): Record<KeybindAction, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_KEYBINDS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_KEYBINDS };
}

export function saveKeybinds(kb: Record<KeybindAction, string>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(kb)); } catch { /* ignore */ }
}

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
  moveUp: 'Move Up', moveDown: 'Move Down', moveLeft: 'Move Left', moveRight: 'Move Right',
  reload: 'Reload', flashlight: 'Flashlight',
  weapon1: 'Melee', weapon2: 'Primary Firearm', weapon3: 'Secondary Firearm',
  inventory: 'Inventory', character: 'Character', map: 'Map', outpost: 'Outpost',
  heal: 'Use Med', food: 'Use Food', antiviral: 'Use Antiviral', armor: 'Use Armor',
};
