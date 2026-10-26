<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Picnic Glass — Fog Photobooth</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <div id="app" class="app-shell">
    <!-- Hidden video element for webcam stream -->
    <video id="camera-video" playsinline muted class="sr-only"></video>

    <!-- Main interactive stage -->
    <main id="stage-container" class="stage-container" aria-label="Interactive glass photobooth pane">
      <canvas id="stage-canvas" class="stage-canvas"></canvas>
      <canvas id="ui-canvas" class="ui-canvas" aria-hidden="true"></canvas>

      <!-- Screen reader live announcements -->
      <div id="sr-announcer" class="sr-only" aria-live="polite" aria-atomic="true"></div>

      <!-- Contextual toast banner -->
      <div id="toast-banner" class="toast-banner hidden" role="status"></div>

      <!-- Countdown Overlay -->
      <div id="countdown-overlay" class="countdown-overlay hidden" role="dialog" aria-label="Photo countdown">
        <span id="countdown-number" class="countdown-number">3</span>
        <button id="btn-cancel-countdown" type="button" class="btn btn-amber">Cancel (Esc)</button>
      </div>

      <!-- Onboarding / Intro Modal -->
      <section id="intro-overlay" class="intro-overlay" aria-labelledby="intro-title">
        <div class="intro-card picnic-card">
          <div class="picnic-badge">🧺 Conservatory Picnic Booth</div>
          <h1 id="intro-title" class="caveat-title">Picnic on the Glass</h1>
          <p class="intro-lead">
            Play with a misty greenhouse window overlooking a sunny picnic meadow.
            <strong>Camera frames are processed on this device</strong> and never uploaded.
          </p>
          <ul class="intro-steps">
            <li><strong>😮 Make an "O" mouth pose</strong> (or press <kbd>F</kbd>) to breathe fog onto the glass.</li>
            <li><strong>☝️ Point your index finger</strong> (or drag with mouse/touch) to write, wipe, or stamp berry lipstick.</li>
            <li><strong>📸 Press Photo</strong> (or <kbd>Space</kbd>) to snap a framed picnic keepsake.</li>
          </ul>
          <p class="privacy-note">
            Note: Downloading AI landmark models requires initial network access; webcam video stays strictly in local memory.
          </p>
          <div class="intro-actions">
            <button id="btn-start-camera" type="button" class="btn btn-primary">Start Camera</button>
            <button id="btn-try-demo" type="button" class="btn btn-secondary">Try Picnic Demo (No Camera)</button>
          </div>
          <div class="calibration-row">
            <label class="checkbox-label">
              <input type="checkbox" id="chk-calibrate-mouth" />
              Run 3-second "O" mouth calibration after camera starts
            </label>
          </div>
        </div>
      </section>

      <!-- Optional Mouth Calibration Modal -->
      <section id="calibration-overlay" class="intro-overlay hidden" aria-labelledby="calib-title">
        <div class="intro-card picnic-card">
          <h2 id="calib-title" class="caveat-title">Mouth Fog Calibration</h2>
          <p id="calib-instruction">Make a comfortable rounded "O" shape with your mouth and hold for 2 seconds...</p>
          <div class="progress-bar-track">
            <div id="calib-progress" class="progress-bar-fill"></div>
          </div>
          <div class="intro-actions">
            <button id="btn-skip-calib" type="button" class="btn btn-secondary">Use Default Tuning</button>
          </div>
        </div>
      </section>
    </main>

    <!-- Top Bar: Scene Selector & Status -->
    <header class="top-bar" role="banner">
      <div class="brand-cluster">
        <span class="status-pill" id="camera-status-pill" title="Camera and on-device tracking status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">Demo Mode</span>
        </span>
        <button id="btn-retry-camera" type="button" class="btn btn-compact hidden">Retry Camera</button>
      </div>

      <div class="scene-selector" role="group" aria-label="Picnic window scene">
        <label for="select-scene" class="control-label">Scene:</label>
        <select id="select-scene" class="scene-select">
          <option value="meadow">🌻 Sunny Picnic Meadow</option>
          <option value="aquarium">🦋 Butterfly &amp; Koi Pond</option>
          <option value="rain">🌦️ Sunshower Dew</option>
          <option value="fireflies">✨ Twilight Fireflies</option>
        </select>
        <button id="btn-pause-scene" type="button" class="btn btn-compact" aria-pressed="false" title="Pause decorative scene animation">
          Pause Motion
        </button>
      </div>

      <div class="top-utilities">
        <button id="btn-undo" type="button" class="btn btn-compact" disabled title="Undo last clear or stroke">Undo</button>
        <button id="btn-clear-glass" type="button" class="btn btn-compact" title="Clear condensation only (C)">Clear Glass (C)</button>
        <button id="btn-clear-marks" type="button" class="btn btn-compact" title="Remove lipstick and stamps">Clear Marks</button>
        <button id="btn-reset-scene" type="button" class="btn btn-compact" title="Clear all fog and marks">Reset Scene</button>
        <button id="btn-toggle-tray" type="button" class="btn btn-compact" aria-expanded="true">
          Photos (<span id="photo-count">0</span>/8)
        </button>
        <button id="btn-help" type="button" class="btn btn-compact" aria-label="Show controls help">?</button>
      </div>
    </header>

    <!-- Collapsible Side / Bottom Photo Tray -->
    <aside id="photo-tray" class="photo-tray" aria-label="Captured picnic photos">
      <div class="tray-header">
        <h2 class="tray-title">Picnic Prints</h2>
        <span class="tray-subtitle">Saved on user action only</span>
      </div>
      <div id="tray-warning" class="tray-warning hidden">
        Tray full (8/8). Capturing a new photo will remove the oldest print.
      </div>
      <div id="photo-list" class="photo-list">
        <p class="empty-tray-msg">No photos yet. Fog the glass and press <strong>Photo</strong>!</p>
      </div>
    </aside>

    <!-- Bottom Toolbar: Tools, Contextual Settings, Fog Pulse & Photo Button -->
    <footer class="bottom-toolbar" role="toolbar" aria-label="Glass drawing and capture controls">
      <div class="tool-group" role="radiogroup" aria-label="Active glass tool">
        <button type="button" class="btn tool-btn active" data-tool="write" role="radio" aria-checked="true">
          ☝️ Write
        </button>
        <button type="button" class="btn tool-btn" data-tool="wipe" role="radio" aria-checked="false">
          🧽 Wipe
        </button>
        <button type="button" class="btn tool-btn" data-tool="lipstick" role="radio" aria-checked="false">
          🍓 Jam Lipstick
        </button>
        <button type="button" class="btn tool-btn" data-tool="play" role="radio" aria-checked="false">
          🦋 Play
        </button>
      </div>

      <!-- Contextual Tool Settings (Only visible when Lipstick is selected) -->
      <div id="lipstick-settings" class="tool-settings hidden" aria-label="Lipstick shade and stamp options">
        <div class="color-swatches" role="radiogroup" aria-label="Berry shade">
          <button type="button" class="swatch active" data-color="#E63946" style="background:#E63946" aria-label="Strawberry Jam"></button>
          <button type="button" class="swatch" data-color="#9B2226" style="background:#9B2226" aria-label="Cherry Tart"></button>
          <button type="button" class="swatch" data-color="#F4A261" style="background:#F4A261" aria-label="Honey Peach"></button>
          <button type="button" class="swatch" data-color="#7209B7" style="background:#7209B7" aria-label="Wild Berry"></button>
        </div>
        <select id="select-stamp-mode" class="scene-select compact-select" aria-label="Lipstick mode">
          <option value="draw">🖍️ Waxy Stroke</option>
          <option value="kiss">💋 Kiss Stamp</option>
          <option value="berry">🍓 Berry Stamp</option>
          <option value="daisy">🌼 Daisy Stamp</option>
        </select>
      </div>

      <div class="capture-cluster">
        <button id="btn-fog-pulse" type="button" class="btn btn-secondary" title="Add bounded fog pulse (Hold F)">
          💨 Breathe Fog (F)
        </button>
        <button id="btn-photo" type="button" class="btn btn-amber btn-capture" title="Start 3-second photo countdown (Space)">
          📸 Photo
        </button>
      </div>
    </footer>
  </div>

  <script type="module" src="./js/app.js"></script>
</body>
</html>
