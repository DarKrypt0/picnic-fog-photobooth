# Picnic Glass audit and improvement plan

Audited 26 October 2026 against repository baseline e866f7f7 (see git history for full base revision). Scope: entry point, scene artwork, available controls, local startup, capture/export, input and basic accessibility. This is a code and browser behavior audit, not a penetration test or full WCAG certification.

## Findings and changes

| Priority | Evidence / original issue | Resolution |
| --- | --- | --- |
| High | index.html embeds a second implementation instead of loading js/app.js. Modular tools and tests exercise different code from the shipped app. | Removed duplicate application code and unused Three.js/GLTF CDN scripts. One entry point now loads the tested modules. |
| High | Lipstick, three stamps, rain, undo and reset exist in modules but have no working controls in the shipped page. | Exposed these features with labeled controls, color presets and a custom color picker. |
| High | README names missing start.bat/serve.ps1 and server advertises missing tests.html. | Corrected README and created the browser test runner. |
| Medium | Demo backgrounds are flat gradients, a sun circle and blanket stripes; layout covers much of the stage. | Added cached multilayer landscapes with hills, flowers, pond water, night lighting and conservatory framing. Warm paper controls and separated desktop creative panel give the canvas more space. |
| Medium | Only one print treatment and fixed three-second countdown. | Added classic, botanical, midnight and borderless PNG finishes; optional date; immediate, 3, 5 and 10 second capture. Options are snapshotted at countdown start. |
| Medium | Fixed drawing sizes limit touch/mouse expressiveness. | Brush size slider applies to writing, wiping and freehand ink. |
| Medium | Reduced motion preference ignored; tool radio controls lack arrow-key behavior. | Default scene pause follows reduced motion; added arrow/Home/End tool navigation and roving tab stops, labeled color controls and visible focus styles. |
| Medium | Resizing leaves particle positions in old coordinates and undo bitmaps at old dimensions. | Scale particle coordinates on resize; clear incompatible undo history while retaining scaled visible marks. |
| Medium | Repeated camera starts can open extra streams; transient input can remain held when focus leaves. | Guard concurrent starts, stop existing streams before retry, stop streams on page exit and clear held pointer/fog state on blur/cancel. |
| Medium | Static server uses current directory and accepts sibling paths sharing the root prefix. | Serve from script directory and check a directory-delimited root prefix. |
| Low | Intro includes unresolved citation placeholders; no page description. | Removed citation artifacts; added a description and clearer local-memory privacy copy. |

## Validation

- Browser runner: 28 checks, zero failures. Covers gesture dwell/rearming/cooldown, mirrored coordinates, fog evaporation/clearing, nonzero fog undo, tray eviction/clear, PNG dimensions/types for each finish, four scene renders and paused fireflies.
- Interactive narrow viewport: onboarding, no-camera startup, ink tools, clear mist, immediate capture and tray preview verified. Additional timer cancellation and scene switching checked interactively.
- JavaScript syntax checks and git whitespace check run before delivery.
- No build required and no new runtime dependencies introduced.
- Live webcam/MediaPipe inference, real touch hardware and cross-browser behavior require manual validation. Existing external model/font availability remains a dependency. CDN/model requests happen even though camera frames are not uploaded.

## Next improvements, in order

1. **Device validation:** test Chrome/Edge/Safari, front-facing mobile cameras, denied permission, offline model failure, rotation during countdown, and high-resolution memory use. Add a repeatable automated UI smoke test in CI once a browser test environment is chosen.
2. **Artwork pass:** replace small procedural critters with original illustrated sprites; preserve consistent scale, palette and animation. Keep assets local and establish licensing/credits. Current landscapes improve depth without introducing image downloads.
3. **Photo formats:** add portrait/square crops with a visible safe-area preview, a three-shot strip, per-shot retake, and captions. Define framing behavior before adding export options.
4. **Camera controls:** expose an explicit stop-camera control and device switching; retain pointer-only operation when tracking fails. Add a tracking confidence/status view for gesture troubleshooting.
5. **Performance:** profile fog mask/composite cost on mobile; throttle inference separately from drawing, cap pixel count and consider a worker only after profiling. Cache is already used for the static landscape artwork.
6. **Accessibility pass:** test screen reader/focus handling for onboarding and countdown; offer keyboard placement of stamps and an explicit fog toggle. Current changes are a foundation, not a full conformance claim.
7. **Dependency resilience:** consider locally hosted fonts/models with attribution and an explicit offline bundle; define a dependency update policy.

## Data behavior

Photos are held in memory, capped at eight, and discarded on reload/navigation. The oldest photo is evicted when full. Save downloads PNG. There is no account, cloud upload or persistent gallery. Date text uses the browser locale and local date.

