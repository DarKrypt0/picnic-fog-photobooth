# Picnic Glass — Fog Photobooth

For the updated open-palm eraser, beak feeding gesture and 3D koi/goldfish behavior, see [Pond controls](POND-CONTROLS.md).

For DSLR tethering (digiCamControl) and automatic paper-size printing (IrfanView), see [Booth hardware](BOOTH-HARDWARE.md).

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
```

## 3D Model Credits & Attribution
- [Butterfly](https://poly.pizza/m/2ZwYwkTVnfG) by [Poly by Google](https://poly.pizza/u/Poly%20by%20Google) [[CC-BY](https://creativecommons.org/licenses/by/3.0/)] via Poly Pizza
- [butterfly](https://poly.pizza/m/0Wt0Mc31Qsj) by [Hugo Gibson](https://poly.pizza/u/Hugo%20Gibson) [[CC-BY](https://creativecommons.org/licenses/by/3.0/)] via Poly Pizza
- [Butterfly](https://poly.pizza/m/fv6J8XW4hvC) by [sirkitree](https://poly.pizza/u/sirkitree) [[CC-BY](https://creativecommons.org/licenses/by/3.0/)] via Poly Pizza

