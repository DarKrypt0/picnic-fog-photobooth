# Picnic Glass — Fog Photobooth

A zero-build browser photobooth with on-device face/hand tracking and mouse/touch fallback. Draw through condensation, use colored ink and stamps, switch between four illustrated garden scenes, and capture PNG prints.

## Run locally

From this directory, run PowerShell: `powershell -ExecutionPolicy Bypass -File .\server.ps1`
Then open http://127.0.0.1:8080. Use HTTPS when hosted; file:// does not support module loading or webcam permissions.

Open /tests.html to run the browser regression suite.

## Controls

- Start Camera or Explore without a camera. Camera requests video only. MediaPipe models load from Google/jsDelivr; frames are processed locally.
- Hold F or Hold to fog; drag with Write, Wipe, or Ink & stamps. C clears mist. Undo restores marks and fog.
- Choose meadow, koi pond, sunshower, or twilight. Play attracts critters; Pause Motion freezes scene animation. Reduced motion preference pauses scenes by default.
- Adjust brush size, ink color and stamp; choose paper finish, date and 0/3/5/10 second timer. Space starts capture; Escape cancels.
- Prints are temporary in-memory PNGs (up to eight). Save downloads a print; leaving or reloading discards unsaved prints.

## Architecture

index.html loads js/app.js; styles.css is the shared stylesheet. Modules implement fog, surface marks, scene rendering, tracking, classification and PNG export. No runtime build or framework dependency. Landscape backgrounds are cached procedural canvas artwork.

See AUDIT.md for findings, implemented changes and follow-up priorities.
