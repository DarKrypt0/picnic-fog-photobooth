# Palm eraser and interactive pond

The root index.html now uses shared hand geometry, gesture gating, pond simulation and a procedural fish renderer. This updates the root application; the separately uploaded picnic-glass-improved/ copy is unchanged.

## Camera gestures

- **Erase:** spread the fingers and thumb, face the palm toward the camera, and hold for about 180 ms. Move the palm to wipe. A closed fist does nothing. Edge-on hands and ambiguous poses do not erase.
- **Guide:** extend only the index finger and hold briefly. Koi and goldfish follow at a small distance. In Write mode this also writes through fog; choose Play to guide without drawing.
- **Feed:** bring all five fingertips, including the thumb, together in a beak shape and hold for about 250 ms. One portion drops at the tip cluster. Release for at least 300 ms before forming the beak again. Four fingertips alone do not feed.
- **Scare:** other nearby hands make fish swim away. Food attracts fish when they are not fleeing; food has priority over following the pointing finger.

Choose **3D Koi & Goldfish** for fish interactions. Without a camera, select Play and move the pointer to guide fish; use Drop fish food for a portion near pond center. The button supports keyboard activation. Pause Motion freezes fish and food expiry; feeding is disabled while paused or capturing.

## Rendering and resource limits

Eight fish mix elongated patterned koi and rounder goldfish. Their bodies, tails, fins, eyes and markings are generated as local Three.js meshes, with lighting and animated tails/fins. No GLB/model download is needed. If Three.js or WebGL is unavailable, shaded canvas fish retain the same simulation and food behavior. Food is capped at 24 pellets, eaten at close range, and expires after ten seconds of active pond time.

Hand classification uses scale-relative distances and palm-plane orientation. It cannot guarantee palm-versus-back identification from geometry alone. Real camera testing is still needed across lighting, hand shapes and camera angles.

## Validation

Run with Node 22+: node --test tests/*.test.cjs

Tests cover palm/point/beak/fist distinction, edge-on and invalid input, mirrored/rotated/scaled hands, dwell and feed rearming, the live root tracking path, flee/follow/feed behavior, bounded food, pause, consumption/expiry, pond boundaries and continued camera/demo rendering. Synthetic landmarks and mocked camera frames do not replace physical webcam validation.
