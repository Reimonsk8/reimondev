# plan.md — Isometric Multiplayer Zombie Shooter (Dead Frontier × Dead Nation)

> Working title under development for the casino888 platform: top-down isometric,
> browser-first, arcade zombie shooter with a full-loot hardcore death penalty,
> militarized safe zones, and a permanent visual gore engine.

---

## 1. Project Vision

Build a high-performance, top-down isometric (45-degree) multiplayer arcade zombie
shooter for the browser (with a roadmap path to React Native mobile), using:

- **React / HTML5 Canvas / WebGL** (PixiJS v8) + Zustand + Tailwind CSS for the client.
- **Node.js + Colyseus / lightweight WebSocket server** with dynamic channel sharding
  for open-world scaling.
- **PixelLab** for 32x32 isometric pixel art.
- **Suno** for dynamic audio/music.
- **CapCut Seedance** for cinematic trailers/narrative cuts.

The game blends pure arcade shooter action with hardcore full-loot loss on death,
militarized safe zones whose threat level escalates with distance from the safe zone,
and an extremely visual, impact-heavy gore presentation.

---

## 2. Consolidated Design Decisions

### Vision (from the user's interviews & refinements)

- **Perspective:** Isometric **45-degree** (best of Dead Frontier & Dead Nation) — locked in.
- **Sprite resolution:** **32x32** for characters and tiles, with appropriate character
  bounding boxes (e.g. 32x64 / 48x48) for isometric depth.
- **World:** **Open world** instance-based map; if lag / player count maxes out, split
  across **other servers** (dynamic channel sharding).
- **Gameplay:** **Pure arcade shooter action** (fast, skill-based, arcade feel).
- **Death penalty:** **Permanent item loss** (full loot loss on death).
- **Safe zones:** Militarized safe zones with **threat level increasing** as the player
  **explores outward beyond the safe-zone radius** (zombie spawns intensify).
- **Lore:** "Rogue bio-engineering corporation + parasite + military experiments" blend.
- **Gore:** **Super important** — head decapitations, blood particles/sprites/puddles,
  guts/organs everywhere; every kill is visually impactful.

### Lore & Narrative Worldbuilding (locked in)

- **The Event:** **Operation Reductio & The V-Host Specimen**.
- **Deep within** the subterranean labs of **Aethel-Biotech**.
- **Project Aegis** sought to create **self-repairing organic armor** using a modified
  **deep-sea parasite (V-Host)**.
- When **military tests** weaponized the organism's neurological override capabilities,
  a **containment breach** flooded the metropolitan core.
- The parasite **mutates dead matter** using surrounding synthetic/military structures.
- Military **tactical quarantine grid** → **S-Zones (Safe Zones)**; failed to stop outer
  sectors degrading into **bio-organic nightmare grounds**.
- As an **uninfected survivor**, the player operates out of the safe zones, venturing
  into the outlands to scavenge corporate tech, military hardware, and parasite catalysts.

### Threat Radius Mechanics (locked in)

- **Tier 0 (Safe Zone):** Guard towers, automated turrets, trade NPCs, vault access,
  PvP disabled.
- **Tier 1 (Outer Suburbs):** Low-tier walker variants, basic scrap loot, 90% survivor
  safety.
- **Tier 2 (Commercial Sector):** Fast runners, toxic spatters, medium-grade firearms,
  PvP enabled.
- **Tier 3 (Corporate Core & Bio-Labs):** Fully mutated abominations, heavy military
  drops, full open PvP, environmental hazard zones.

### Production Pipeline Strategy

| Category | Tool | Execution Plan |
|---|---|---|
| Code & Scripting | OpenCode | Boilerplate, WebSocket netcode, isometric math, UI components |
| Visual Assets | PixelLab | 32x32 tilesets, 8-directional character/zombie walk & shoot sheets, isometric building blocks |
| Music & Audio | Suno | Dark synthwave/industrial ambient tracks (Safe Zone → combat synth during waves) |
| Cinematics | CapCut Seedance | AI-generated gritty isometric trailers, outbreak cutscenes, teaser edits |

---

## 3. Project Roadmap

### Phase 1 — Architecture & Core Engine Setup
- Target: browser-first execution (HTML5 Canvas / WebGL via PixiJS v8), structured for
  future React Native mobile porting.
- State & netcode: client-server authoritative via WebSockets; sync movement, shooting,
  zombie pathfinding, loot containers without desync.
- Deliverables: project scaffolding, game loop, renderer setup, player controller.

### Phase 2 — Asset Pipeline & Generation
- Visuals (PixelLab): 32x32 tilesets, 8-directional characters/zombies, zombie mutation
  variants, inventory UI, **dismembered zombie/debris/gore spritesheets**.
- Audio (Suno): ambient + combat music.
- Cinematics (CapCut Seedance): outbreak cutscenes, trailers.

### Phase 3 — Gameplay Mechanics & Core Loop
- Loop: Scavenge → Fight zombie hordes → Extract loot & gear → Upgrade weapons &
  shelter safely.
- Controls: WASD + mouse aim (desktop); virtual dual-joysticks (future mobile).
- Deliverables: shooting, ammo, weapons, horde waves, loot extraction.

### Phase 4 — Lore & Narrative Integration
- Gritty post-collapse urban setting, corporate corruption, grim survival reality.
- Deliverables: narrative framing, briefing text, cinematic content.

### Phase 5 — Gore & Visual Intensity (Active Focus)

#### 5.1 The Dynamic Splatter & Debris Engine
- Persistent Blood Layer (Decal Canvas): standard particles → bake on velocity-zero to
  persistent ground decal layer; thousands of blood puddles, gut splatters, limb debris
  persist indefinitely without perf degradation.

#### 5.2 High-Impact Visual Combat Mechanics
- Weapon classes → visual impact & gameplay:
  - Heavy Shotguns: high-concussion blast, torso → visceral mist + flying organs; wide
    AoE stagger + heavy limb decapitation.
  - High-Caliber Rifles: clean head decapitation, upward blood geysers splash onto nearby
    walls/surfaces; high single-target damage, directional spray patterns.
  - Blades & Chainsaws: slices bodies cleanly along swing angle; severed torsos crawl or
    dual puddle trails; melee crowd clearing; dense localized blood pools.
  - Explosives / Grenades: complete gibbing — radial explosion of skeletal debris,
    organs, shockwave decals; instant multi-kill obliteration with max ground staining.

#### 5.3 Atmosphere Pipeline
- Dynamic Lighting: pitch-black fog of war, flashlights, muzzle flashes, burning wreckage.
- Visceral SFX: wet impact, bone snaps, tearing tissue, low industrial ambient synth (Suno).
- PvP Paranoia: high-tier sectors force zero-trust encounters; dead players drop full
  loot alongside gruesome corpse decals.

### Phase 6 — Safe Zones, Stash, Inventory & Hardcore Full-Loot Death
- Safe zones (Tier 0) with vault, trade NPCs, turrets.
- Stash: banked currency, permanent character level/perks, safe-house storage.
- Death: drop **100%** of carried inventory/weapons/loot in lootable container.
- Deliverables: loot management, extraction loop, permanent loss semantics.

### Phase 7 — Asset Pipeline Integration
- PixelLab spritesheets (incl. dismembered/debris/gore).
- Suno audio engine.
- Tailwind UI overlays (health bar, ammo, minimap, kill feed).

---

## 4. Visual Systems Detail (The Gore Engine)

### 1. Dynamic Splatter & Debris Engine

**Goal:** Intense gore without tanking browser performance (WebGL/PixiJS).

- **Persistent Blood Layer (Decal Canvas):** Particles (blood spray, drips, body parts)
  move with velocity/gravity/drag; once velocity ≈ 0, bake into a static ground texture.
  Thousands of blood puddles/gut splatters/limb sprites remain on screen indefinitely
  with O(1) per-frame cost (no per-particle re-render).

- **Directional Decapitations & Dissectable Hitboxes:** Zombie sprite sheets use
  segmented layers (Head, Torso, LArm, RArm, Legs). Decouple based on impact angle and
  damage type.

### 2. High-Impact Visual Combat Mechanics

| Weapon Class | Visual Impact & Gore Effect | Gameplay Result |
|---|---|---|
| Heavy Shotguns | High-concussion blast, blows torso apart into visceral mist + flying organs; wide AoE stagger + heavy limb decapitation | Wide AoE stagger, limb decapitation |
| High-Caliber Rifles | Clean head decapitation, upward blood geysers splash onto walls/surfaces; directional spray | High single-target damage, directional spray |
| Blades & Chainsaws | Slices bodies along swing angle; severed torsos crawl or dual puddle trails; dense localized blood pools | Melee crowd clearing |
| Explosives / Grenades | Complete gibbing — radial explosion of skeletal debris, organs, shockwave decals | Instant multi-kill, max ground staining |

### 3. "Zero Trust" Doomed Atmosphere
- Dynamic lighting: pitch-black fog of war, flashlights, muzzle flashes, burning wreckage.
- Visceral SFX (Suno): wet impact, bone snaps, tearing tissue, industrial ambient.
- PvP paranoia: high-tier sectors, zero-trust encounters, full loot drop with corpse decals.

### Gore Subsystem Contracts

- **ParticleManager:** active particles (blood spray, limbs, organs) w/ velocity,
  gravity, drag, TTL; retire on TTL or velocity-zero → hand off to DecalManager.

- **DecalCanvasManager:** offscreen ground canvas per sector; bake on rest; blit via
  dirty-region redraw; persistent across match.

- **GoreSystem:** weapon/damage-driven emission + dismemberment logic.

- **ZombieSpriteParts:** TypeScript data structure for segmented zombie sprites.

- **calculateGoreTrajectory(impactAngle, force):** returns severed-part velocity vectors.

- **Blood palettes:** `#4A0404` → `#8B0000` (dark, saturated, low-light fog-of-war safe).

---

## 5. Implementation Phases & Next Steps

### Phase 1 — Core Isometric Engine & Canvas Renderer
- [ ] `shared/math/isometric.ts` (world↔screen 45°, tile conversions).
- [ ] `frontend/src/games/zombie-shooter/engine/` PixiJS renderer + player controller.
- [ ] Canvas HUD overlay (Tailwind), camera follow, screen shake.

### Phase 2 — Asset Pipeline & Generation
- [ ] PixelLab prompts: full-body 8-dir zombies, headless walk, crawling torso, debris/
      gore spritesheet, blood pools, impact splatters.
- [ ] Suno music, CapCut cinematic prompts.

### Phase 3 — Arcade Shooting
- [ ] Aim math (crosshair → world), fire cooldown, raycast hitboxes, headshot detection.
- [ ] Damage + gore emission per weapon class.

### Phase 4 — Threat & Zombie AI
- [ ] Threat radius by distance from safe zone.
- [ ] Zombie spawner tied to threat level.
- [ ] Behavior tree: idle → wander → chase → attack.

### Phase 5 — Safe Zones / Stash / Full-Loot Death
- [ ] Safe zone UI, stash, inventory, extraction, permanent item loss.

### Phase 6 — Visual/Atmosphere/Audio/Cinematics Integration
- [ ] Gore decals + particles into renderer.
- [ ] Suno + CapCut integration.

### Phase 7 — Polish & Launch
- [ ] Performance benchmarks (decals at 60fps), multiplayer server sharding.

---

## 6. Immediate Next Actions (per latest user direction)

1. **Do NOT start implementing yet** — only update this plan (being done now).
2. Next after plan finalization:
   - Confirm whether to run **PixelLab prompts for dismembered zombies/gore sprites**.
   - Or proceed with **isometric engine + OpenCode prompts** next.
3. OpenCode Kickoff Prompt (dormant, to be injected when ready):
   - *Act as Lead Game Developer and Full-Stack Architect. Building top-down isometric
     (45°) multiplayer arcade zombie shooter (Dead Frontier × Dead Nation). Browser-first
     with future React Native mobile path. React/Canvas/PixiJS v8, Zustand, Tailwind, Node.js
     + Colyseus/WS backend, dynamic channel sharding, PixelLab art, Suno audio, CapCut
     cinematics. Goal: pure arcade shooter, full-loot death, safe zones escalating threat,
     super-gore visuals (decapitations, blood particles/puddles, guts/organs).*

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Decal canvas memory growth | Sector-based decal canvases; unload off-screen sectors |
| PixiJS + offscreen canvas cost | Batch decal draws; RenderTexture/cacheAsBitmap |
| Dismemberment desync (client/server) | Server decides damage type/part; client plays FX |
| Blood palette unreadable under fog | Low luminance, high saturation; multiply-blend under dark shaders |
| Open world at scale | Dynamic channel sharding |

---

## 8. Definition of Done (per subsystem)

- **Gore:** 1000+ concurrent decals at 60fps; `calculateGoreTrajectory` correct for all
  damage types; blood palette fog-safe.
- **Engine:** typecheck/lint/tests green; isometric conversions round-trip.
- **Gameplay:** shooting + death + loot integrated.
- **Launch:** asset pipeline (PixelLab/Suno/CapCut) complete.
