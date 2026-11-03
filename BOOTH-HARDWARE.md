# Booth Hardware: digiCamControl tethering + IrfanView printing

Both integrations are routed through the local `server.ps1` (the browser cannot launch
programs itself). Configure everything in **`photobooth.config.json`**, then start:

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1
```

Open `http://127.0.0.1:8080`. The **Picnic Prints** tray now shows **Camera**, **Paper**
and **Auto-print** controls; options are disabled automatically when a tool is not detected.

## 1. digiCamControl (tethered DSLR)

1. Install [digiCamControl](https://digicamcontrol.com/), connect the camera over USB and open it.
2. Set the camera to shoot **JPEG** (or RAW+JPEG). Only JPEGs are picked up.
3. In digiCamControl → *Session*, note the session folder and put it in
   `digiCamControl.sessionFolder` (default `%USERPROFILE%\Pictures\digiCamControl\Session1`).
4. Trigger method (first one found is used):
   - `remoteCmdPath` → `CameraControlRemoteCmd.exe /c capture` (ships with digiCamControl), or
   - `webUrl` → `http://127.0.0.1:5513/?CMD=Capture` (enable *Settings → Webserver*).
5. In the booth, choose **Camera → DSLR via digiCamControl**.

Flow: the webcam is still used for live preview + face/hand tracking. When the countdown
ends the server fires the DSLR, waits for the new JPEG in the session folder, and the
current fog/marks/scene layers are composited over the DSLR photo instead of the webcam frame.
`mirrorImage: true` mirrors the DSLR shot so it lines up with the mirrored preview.
If the DSLR fails, the webcam frame is used and a toast explains why.

## 2. IrfanView (automatic paper sizes)

The browser lays each print out at **300 DPI at the exact paper size** (rotating to match
orientation), then the server saves it to `prints\` and runs:

```
i_view64.exe "prints\<time>-<size>.png" /ini="irfan-profiles\<size>" /print="<printer>"
```

IrfanView reads its print settings (paper size, tray, margins, fit) from the `i_view64.ini`
in the `/ini` folder, so **each paper size gets its own profile folder**. One-time setup per size:

```powershell
& "C:\Program Files\IrfanView\i_view64.exe" /ini="C:\path\to\booth\irfan-profiles\4x6"
```

In that IrfanView window: open any image → **File → Print** → pick the printer, paper size
(e.g. 4x6), orientation, *"Fit to page / best fit"*, zero margins → Print once. IrfanView saves
these into `irfan-profiles\4x6\i_view64.ini`. Repeat for `5x7`, `strip`, `A5`, `A4`.

Per-size `printer` (or global `irfanView.printer`) lets different sizes go to different printers
(e.g. a DNP for 4x6 and an office printer for A4). Empty = Windows default printer.

| Paper id | Layout |
|---|---|
| `4x6`, `5x7`, `A5`, `A4` | Single photo, cover-filled |
| `strip` (`"layout": "strip"`) | 4x6 sheet with two identical 2x6 strips of the 3 most recent photos — cut down the middle |

Add sizes by adding entries to `irfanView.paperSizes` (`widthIn`/`heightIn` in inches).

## Security notes
- Server binds to `127.0.0.1` only. POST endpoints require an `X-Photobooth: 1` header,
  so other websites can't trigger the camera or printer.
- `photobooth.config.json` and the `prints\` folder are not served over HTTP.
