# Picnic Glass — Fog Photobooth

A browser-based interactive glass photobooth with a cozy picnic conservatory theme. Breathe an "O" shape to fog the glass, write with your fingertip, stamp berry lipstick marks, attract pond koi and butterflies in Play mode, and snap Polaroid-style picnic prints.

## Features
- **Zero Build Step**: Plain ES modules ready for GitHub Pages or local hosting.
- **On-Device Vision**: Uses MediaPipe Face Landmarker and Hand Landmarker (processed 100% locally on your device; no microphone required).
- **Floating-Point Fog Engine**: High-precision `Float32Array` condensation mask with radial segment stamping, gradual 2-minute evaporation, and water drips.
- **Picnic Scenes & Tools**:
  - **Scenes**: Sunny Meadow, Butterfly & Koi Pond (Aquarium mode), Sunshower Dew, and Twilight Fireflies.
  - **Tools**: Finger Write (clears fog), Cloth Wipe (clears fog + marks), Berry Lipstick & Picnic Stamps (Kiss, Strawberry, Daisy), and Play Mode (steers critters without drawing).

## Running Locally
Because ES modules and webcam permissions require `localhost` or `HTTPS`, do not open `index.html` via `file://`.

### Windows (PowerShell)
Double-click `start.bat` or run:
```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
