import { useEffect, useState } from 'react';
import { playPianoNote } from '../utils/pianoAudio';

// Two octaves (C4–B5). Letters in quotes = computer-keyboard shortcuts.
const WHITE_KEYS = [
  { note: 'C4', key: 'z', midi: 60 },
  { note: 'D4', key: 'x', midi: 62 },
  { note: 'E4', key: 'c', midi: 64 },
  { note: 'F4', key: 'v', midi: 65 },
  { note: 'G4', key: 'b', midi: 67 },
  { note: 'A4', key: 'n', midi: 69 },
  { note: 'B4', key: 'm', midi: 71 },
  { note: 'C5', key: 'q', midi: 72 },
  { note: 'D5', key: 'w', midi: 74 },
  { note: 'E5', key: 'e', midi: 76 },
  { note: 'F5', key: 'r', midi: 77 },
  { note: 'G5', key: 't', midi: 79 },
  { note: 'A5', key: 'y', midi: 81 },
  { note: 'B5', key: 'u', midi: 83 },
];

const BLACK_KEYS = [
  { note: 'C#4', key: 's', midi: 61, after: 0 },
  { note: 'D#4', key: 'd', midi: 63, after: 1 },
  { note: 'F#4', key: 'g', midi: 66, after: 3 },
  { note: 'G#4', key: 'h', midi: 68, after: 4 },
  { note: 'A#4', key: 'j', midi: 70, after: 5 },
  { note: 'C#5', key: '2', midi: 73, after: 7 },
  { note: 'D#5', key: '3', midi: 75, after: 8 },
  { note: 'F#5', key: '5', midi: 78, after: 10 },
  { note: 'G#5', key: '6', midi: 80, after: 11 },
  { note: 'A#5', key: '7', midi: 82, after: 12 },
];

export default function PianoModal({ onClose, subscribe, onPlayNote }) {
  const [pressed, setPressed] = useState({});

  // Play + light a note without broadcasting (used for remote players' notes).
  const playNote = (midi) => {
    playPianoNote(midi);
    setPressed((prev) => ({ ...prev, [midi]: true }));
    setTimeout(() => setPressed((prev) => ({ ...prev, [midi]: false })), 200);
  };

  // Local input: play + light + broadcast so everyone else hears it.
  const hit = (midi) => {
    playNote(midi);
    onPlayNote?.(midi);
  };

  // Listen for other players' notes (multiplayer): sound + light the key.
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((msg) => {
      if (msg?.type === 'piano' && typeof msg.midi === 'number') {
        playNote(msg.midi);
      }
    });
  }, [subscribe]);

  useEffect(() => {
    const keyMap = [...WHITE_KEYS, ...BLACK_KEYS].reduce((map, k) => {
      map[k.key] = k;
      return map;
    }, {});
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.repeat) return;
      const k = keyMap[e.key.toLowerCase()];
      if (k) hit(k.midi);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="piano-overlay" onClick={onClose}>
      <div className="piano-modal" onClick={(e) => e.stopPropagation()}>
        <div className="piano-header">
          <h2>🎹 Grand Piano</h2>
          <p>Play with your mouse or your keyboard</p>
          <button className="piano-close" onClick={onClose} aria-label="Close piano">✕</button>
        </div>

        <div className="piano-keys">
          {WHITE_KEYS.map((k) => (
            <button
              key={k.note}
              className={`piano-white ${pressed[k.midi] ? 'pressed' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); hit(k.midi); }}
              aria-label={`${k.note} (${k.key})`}
            >
              <span className="piano-white-note">{k.note}</span>
              <span className="piano-key-label">{k.key.toUpperCase()}</span>
            </button>
          ))}
          <div className="piano-black-layer">
            {BLACK_KEYS.map((k) => (
              <button
                key={k.note}
                className={`piano-black ${pressed[k.midi] ? 'pressed' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); hit(k.midi, k.key); }}
                style={{ left: `${((k.after + 0.5) / WHITE_KEYS.length) * 100}%` }}
                aria-label={`${k.note} (${k.key})`}
              >
                <span className="piano-key-label">{k.key.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="piano-hint">
          Keys: <strong>Z X C V B N M</strong> = C4–B4 · <strong>Q W E R T Y U</strong> = C5–B5 ·{' '}
          <strong>S D G H J 2 3 5 6 7</strong> = black keys
        </p>
      </div>
    </div>
  );
}
