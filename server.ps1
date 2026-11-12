# Local Loopback Static Server for ClickKit Glass Fog Photobooth
# Binds strictly to 127.0.0.1, rejects path traversal, and serves ES module & WASM MIME types.
#
# Also acts as a local bridge for photobooth hardware (see photobooth.config.json):
#   GET  /api/status        -> availability of digiCamControl / IrfanView + paper sizes
#   POST /api/dslr/capture  -> trigger digiCamControl shutter, return the new JPEG
#   POST /api/print?size=ID -> save the posted PNG and print it via IrfanView using
#                              the paper-size profile (IrfanView INI folder) for ID
# POST endpoints require the "X-Photobooth: 1" header so other websites cannot
# trigger them (a custom header forces a CORS preflight, which this server never approves).

param(
  [int]$Port = 8080,
  [string]$ConfigPath = "photobooth.config.json"
)

$ErrorActionPreference = "Stop"
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Prefix = "http://127.0.0.1:$Port/"

$MimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".mjs"  = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".wasm" = "application/wasm"
  ".task" = "application/octet-stream"
  ".glb"  = "model/gltf-binary"
  ".gltf" = "model/gltf+json"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

# ---------------------------------------------------------------- config
function Resolve-RootPath([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $null }
  $p = [Environment]::ExpandEnvironmentVariables($p)
  if ([System.IO.Path]::IsPathRooted($p)) { return $p }
  return [System.IO.Path]::GetFullPath((Join-Path $Root $p))
}

$Config = $null
$ConfigFull = Resolve-RootPath $ConfigPath
if (Test-Path $ConfigFull -PathType Leaf) {
  $Config = Get-Content $ConfigFull -Raw | ConvertFrom-Json
} else {
  Write-Host "No $ConfigPath found - DSLR tethering and IrfanView printing are disabled." -ForegroundColor Yellow
}

$Dcc = if ($Config) { $Config.digiCamControl } else { $null }
$Irf = if ($Config) { $Config.irfanView } else { $null }
$PrintFolder = Resolve-RootPath $(if ($Irf -and $Irf.printFolder) { $Irf.printFolder } else { "prints" })

# ---------------------------------------------------------------- GIF sharing (QR download)
$Share = if ($Config) { $Config.share } else { $null }
$ShareEnabled = [bool]($Share -and $Share.enabled)
$GifFolder = Resolve-RootPath $(if ($Share -and $Share.folder) { $Share.folder } else { "gifs" })
$SharePort = if ($Share -and $Share.port) { [int]$Share.port } else { 8081 }

function Get-LanIp {
  if ($Share -and $Share.host) { return $Share.host }
  try {
    $cfg = Get-NetIPConfiguration -ErrorAction Stop |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
    if ($cfg) { return $cfg.IPv4Address[0].IPAddress }
  } catch { }
  $addr = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
    Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not $_.ToString().StartsWith('169.254.') -and $_.ToString() -ne '127.0.0.1' } |
    Select-Object -First 1
  if ($addr) { return $addr.ToString() }
  return $null
}

$ShareBase = $null
if ($ShareEnabled) {
  $lan = Get-LanIp
  if ($lan) { $ShareBase = "http://${lan}:$SharePort" }
}

# Tiny GET-only server for guests' phones. Uses TcpListener so no admin rights / URL ACL are needed.
# Serves ONLY  /g/<id>  (mobile page)  and  /g/<id>.gif  from the GIF folder.
$ShareServerScript = {
  param($TcpListener, $GifDir)
  while ($true) {
    try { $client = $TcpListener.AcceptTcpClient() } catch { break }
    try {
      $client.ReceiveTimeout = 5000; $client.SendTimeout = 30000
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $line = $reader.ReadLine()
      while ($true) { $h = $reader.ReadLine(); if ($null -eq $h -or $h -eq '') { break } }

      $status = '404 Not Found'; $type = 'text/plain; charset=utf-8'; $extra = ''
      $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $isHead = $false
      if ($line -match '^(GET|HEAD) /g/([A-Za-z0-9_\-]+)(?:/)?(?:\.(gif|jpg|jpeg|png))?(?:\?([^ ]*))? HTTP/1\.[01]$') {
        $isHead = $Matches[1] -eq 'HEAD'
        $id = $Matches[2]
        $ext = $Matches[3]
        $queryStr = $Matches[4]
        $dl = [bool]($queryStr -and $queryStr -match '(^|&)dl=1(&|$)')
        $gifFile = Join-Path $GifDir "$id.gif"
        $stripFile = Join-Path $GifDir "$id.jpg"
        if (-not (Test-Path $stripFile) -and (Test-Path (Join-Path $GifDir "latest_strip.jpg"))) {
          $stripFile = Join-Path $GifDir "latest_strip.jpg"
        }

        if ($ext -match '^(jpg|jpeg|png)$') {
          if (Test-Path -LiteralPath $stripFile -PathType Leaf) {
            $status = '200 OK'
            $type = 'image/jpeg'
            $body = [System.IO.File]::ReadAllBytes($stripFile)
            if ($dl) { $extra = "Content-Disposition: attachment; filename=`"clickkit-strip-$id.jpg`"`r`n" }
          }
        } elseif ($ext -eq 'gif') {
          if (Test-Path -LiteralPath $gifFile -PathType Leaf) {
            $status = '200 OK'
            $type = 'image/gif'
            $body = [System.IO.File]::ReadAllBytes($gifFile)
            if ($dl) { $extra = "Content-Disposition: attachment; filename=`"clickkit-glass-$id.gif`"`r`n" }
          }
        } else {
          # Responsive mobile download page showing both the digital photo strip and the animated GIF
          $hasGif = Test-Path -LiteralPath $gifFile -PathType Leaf
          $hasStrip = Test-Path -LiteralPath $stripFile -PathType Leaf
          if ($hasGif -or $hasStrip) {
            $status = '200 OK'
            $type = 'text/html; charset=utf-8'
            $stripHtml = if ($hasStrip) {
              @"
<section style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(246,239,230,0.12)">
  <h3 style="margin:0 0 8px;font-size:1.15rem;color:#F0A04B">&#127902;&#65039; Digital Photo Strip</h3>
  <img src="/g/$id.jpg" alt="Your Digital Photo Strip">
  <br><a class="btn" href="/g/$id.jpg?dl=1" download="clickkit-strip-$id.jpg">&#11015;&#65039; Download Photo Strip</a>
</section>
"@
            } else { "" }

            $gifHtml = if ($hasGif) {
              @"
<section style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(246,239,230,0.12)">
  <h3 style="margin:0 0 8px;font-size:1.15rem;color:#F0A04B">&#127916; Animated GIF</h3>
  <img src="/g/$id.gif" alt="Your Animated GIF">
  <br><a class="btn" href="/g/$id.gif?dl=1" download="clickkit-glass-$id.gif">&#11015;&#65039; Download Animated GIF</a>
</section>
"@
            } else { "" }

            $html = @"
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your ClickKit Keepsakes</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#140E0B;color:#FAF4EB;text-align:center;padding:20px 14px;}
  .card{background:#201712;border:1px solid rgba(246,239,230,0.15);border-radius:20px;max-width:440px;margin:0 auto;padding:22px 18px;box-shadow:0 12px 36px rgba(0,0,0,0.55);}
  h2{font-size:1.45rem;margin:0 0 4px;color:#FAF4EB;}
  img{max-width:100%;height:auto;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,0.45);display:block;margin:10px auto;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;margin:10px 0 4px;padding:12px 24px;border-radius:999px;background:#E05845;color:#FFF;font-weight:700;text-decoration:none;font-size:1rem;box-shadow:0 4px 14px rgba(224,88,69,0.4);transition:background .15s;}
  .btn:hover{background:#ea6b59;}
  p.tip{opacity:.75;font-size:.82rem;line-height:1.4;margin:18px 0 0;}
</style></head><body>
<div class="card">
  <h2>&#128247; ClickKit on the Glass</h2>
  <p style="opacity:.85;font-size:.9rem;margin:4px 0 14px;">Your digital keepsakes are ready!</p>
  $stripHtml
  $gifHtml
  <p class="tip">&#128161; <b>Tip</b>: Press and hold any image to save directly to your phone's camera roll.</p>
</div>
</body></html>
"@
            $body = [System.Text.Encoding]::UTF8.GetBytes($html)
          }
        }
      }
      $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`n${extra}Cache-Control: no-store`r`nConnection: close`r`n`r`n"
      $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
      $stream.Write($hb, 0, $hb.Length)
      if (-not $isHead) { $stream.Write($body, 0, $body.Length) }
      $stream.Flush()
    } catch { } finally { try { $client.Close() } catch { } }
  }
}

function Save-Gif([byte[]]$Bytes, [string]$ForceId = $null) {
  if (-not $ShareEnabled) { throw "GIF sharing is not enabled in $ConfigPath" }
  if ($Bytes.Length -lt 6 -or [System.Text.Encoding]::ASCII.GetString($Bytes, 0, 6) -ne 'GIF89a') { throw "Not a GIF" }
  if (-not (Test-Path $GifFolder)) { New-Item -ItemType Directory -Path $GifFolder | Out-Null }
  # Unguessable id so guests can't browse each other's keepsakes; accepts caller-specified id to sync with photo strip.
  $id = if ($ForceId -and $ForceId -match '^[A-Za-z0-9_\-]{8,64}$') { $ForceId } else { [guid]::NewGuid().ToString('N').Substring(0, 16) }
  [System.IO.File]::WriteAllBytes((Join-Path $GifFolder "$id.gif"), $Bytes)
  return @{
    ok      = $true
    id      = $id
    url     = $(if ($ShareBase) { "$ShareBase/g/$id" } else { $null })
    warning = $(if (-not $ShareBase) { "No Wi-Fi/LAN address found - set share.host in $ConfigPath" } else { $null })
  }
}

# ---------------------------------------------------------------- helpers
function Send-Bytes($Response, [byte[]]$Bytes, [string]$ContentType, [int]$Status = 200) {
  $Response.StatusCode = $Status
  $Response.ContentType = $ContentType
  $Response.Headers.Add("Cache-Control", "no-store")
  $Response.ContentLength64 = $Bytes.Length
  $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
}

function Send-Json($Response, $Object, [int]$Status = 200) {
  $json = $Object | ConvertTo-Json -Depth 6 -Compress
  Send-Bytes $Response ([System.Text.Encoding]::UTF8.GetBytes($json)) "application/json; charset=utf-8" $Status
}

function Read-Body($Request, [long]$MaxBytes = 60MB) {
  if ($Request.ContentLength64 -gt $MaxBytes) { throw "Request body too large" }
  $ms = New-Object System.IO.MemoryStream
  $Request.InputStream.CopyTo($ms)
  if ($ms.Length -gt $MaxBytes) { throw "Request body too large" }
  return $ms.ToArray()
}

function Get-HandoffFolder {
  if (-not $Config -or -not $Config.handoff -or -not $Config.handoff.enabled) { return $null }
  return Resolve-RootPath $Config.handoff.folder
}

function Get-HandoffInfo {
  $folder = Get-HandoffFolder
  if (-not $folder) { return @{ enabled = $false; layouts = @() } }
  $h = $Config.handoff
  $tplRoot = if ($h.templatesFolder) { Resolve-RootPath $h.templatesFolder } else { Join-Path (Split-Path $folder -Parent) "templates" }
  $layouts = @()
  if ($h.layouts) {
    foreach ($prop in $h.layouts.PSObject.Properties) {
      $id = $prop.Name; $v = $prop.Value
      $tplDir = if ($tplRoot) { Join-Path $tplRoot $id } else { $null }
      $tpls = @("none")
      if ($tplDir -and (Test-Path $tplDir -PathType Container)) {
        $pngs = Get-ChildItem -Path $tplDir -Filter *.png -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
        if ($pngs) { $tpls += $pngs }
      }
      if ($tplRoot -and (Test-Path $tplRoot -PathType Container)) {
        $rootPngs = Get-ChildItem -Path $tplRoot -Filter *.png -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
        if ($rootPngs) {
          foreach ($rp in $rootPngs) {
            if ($tpls -notcontains $rp) { $tpls += $rp }
          }
        }
      }
      $layouts += [ordered]@{
        id        = $id
        label     = $v.label
        shots     = [int]$v.shots
        widthIn   = [double]$v.widthIn
        heightIn  = [double]$v.heightIn
        slotW     = $(if ($v.slotW) { [int]$v.slotW } else { 484 })
        slotH     = $(if ($v.slotH) { [int]$v.slotH } else { 339 })
        templates = $tpls
      }
    }
  }
  $pending = 0
  if (Test-Path $folder -PathType Container) {
    $pending = @(Get-ChildItem -Path $folder -File -Include *.jpg, *.jpeg -ErrorAction SilentlyContinue).Count
  }
  return @{
    enabled            = $true
    folder             = $folder
    defaultLayout      = $(if ($h.defaultLayout) { $h.defaultLayout } else { "2x6_strip4" })
    defaultOrientation = $(if ($h.defaultOrientation) { $h.defaultOrientation } else { "auto" })
    defaultCopies      = $(if ($h.defaultCopies) { [int]$h.defaultCopies } else { 1 })
    pendingShots       = $pending
    layouts            = $layouts
  }
}

function Get-DccSessionFolder {
  if (-not $Dcc) { return $null }
  return Resolve-RootPath $Dcc.sessionFolder
}

function Test-DigiCamControl {
  if (-not $Dcc -or -not $Dcc.enabled) { return $false }
  $cmd = Resolve-RootPath $Dcc.remoteCmdPath
  if ($cmd -and (Test-Path $cmd -PathType Leaf)) { return $true }
  if ($Dcc.webUrl) {
    try {
      Invoke-WebRequest -Uri $Dcc.webUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
      return $true
    } catch { return $false }
  }
  return $false
}

function Get-PaperSizes {
  $list = @()
  if ($Irf -and $Irf.paperSizes) {
    foreach ($prop in $Irf.paperSizes.PSObject.Properties) {
      $v = $prop.Value
      $list += [ordered]@{
        id       = $prop.Name
        label    = $v.label
        widthIn  = [double]$v.widthIn
        heightIn = [double]$v.heightIn
        layout   = $(if ($v.layout) { $v.layout } else { "single" })
      }
    }
  }
  return ,$list
}

# Fires the shutter through digiCamControl and waits for the new image to land in the session folder.
function Invoke-DslrCapture {
  if (-not $Dcc -or -not $Dcc.enabled) { throw "digiCamControl is not enabled in $ConfigPath" }
  $folder = Get-DccSessionFolder
  if (-not $folder -or -not (Test-Path $folder -PathType Container)) {
    throw "digiCamControl session folder not found: $folder"
  }
  $timeout = if ($Dcc.timeoutSeconds) { [int]$Dcc.timeoutSeconds } else { 20 }
  $started = Get-Date

  $cmd = Resolve-RootPath $Dcc.remoteCmdPath
  if ($cmd -and (Test-Path $cmd -PathType Leaf)) {
    $p = Start-Process -FilePath $cmd -ArgumentList "/c capture" -NoNewWindow -PassThru -Wait
    if ($p.ExitCode -ne 0) { Write-Host "CameraControlRemoteCmd exit code $($p.ExitCode)" -ForegroundColor Yellow }
  } elseif ($Dcc.webUrl) {
    Invoke-WebRequest -Uri ($Dcc.webUrl.TrimEnd('/') + "/?CMD=Capture") -UseBasicParsing -TimeoutSec 10 | Out-Null
  } else {
    throw "Set digiCamControl.remoteCmdPath or digiCamControl.webUrl in $ConfigPath"
  }

  $deadline = $started.AddSeconds($timeout)
  while ((Get-Date) -lt $deadline) {
    $newest = Get-ChildItem -Path $folder -File -Include *.jpg, *.jpeg -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -ge $started.AddSeconds(-1) } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest) {
      # Wait until digiCamControl finishes writing (size stable and file readable).
      $lastSize = -1
      for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 150
        $newest.Refresh()
        if ($newest.Length -gt 0 -and $newest.Length -eq $lastSize) {
          try { return [System.IO.File]::ReadAllBytes($newest.FullName) } catch { }
        }
        $lastSize = $newest.Length
      }
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out after ${timeout}s waiting for a new JPEG in $folder (enable JPEG or RAW+JPEG on the camera)"
}

# Saves the print-ready image and sends it directly to the Windows default printer via .NET PrintDocument.
function Invoke-IrfanPrint([byte[]]$Bytes, [string]$SizeId) {
  if ($SizeId -and $SizeId -notmatch '^[A-Za-z0-9_\-]+$') { throw "Invalid paper size id" }
  if (-not (Test-Path $PrintFolder)) { New-Item -ItemType Directory -Path $PrintFolder | Out-Null }
  $safeSize = if ($SizeId) { $SizeId } else { "default" }
  $file = Join-Path $PrintFolder ("{0}-{1}.png" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff"), $safeSize)
  [System.IO.File]::WriteAllBytes($file, $Bytes)

  $size = if ($Irf -and $Irf.paperSizes -and $SizeId) { $Irf.paperSizes.$SizeId } else { $null }
  $printer = if ($size -and $size.printer) { $size.printer } elseif ($Irf -and $Irf.printer) { $Irf.printer } else { "" }

  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($file)
  try {
    $pd = New-Object System.Drawing.Printing.PrintDocument
    if ($printer) { $pd.PrinterSettings.PrinterName = $printer }
    $pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
    $pd.DefaultPageSettings.Landscape = ($img.Width -gt $img.Height)
    $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $pd.add_PrintPage({
      param($sender, $e)
      $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $e.Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $b = $e.PageBounds
      $scale = [Math]::Max($b.Width / [double]$img.Width, $b.Height / [double]$img.Height)
      $w = [int][Math]::Round($img.Width * $scale)
      $h = [int][Math]::Round($img.Height * $scale)
      $x = $b.X + [int][Math]::Round(($b.Width - $w) / 2.0)
      $y = $b.Y + [int][Math]::Round(($b.Height - $h) / 2.0)
      $e.Graphics.DrawImage($img, (New-Object System.Drawing.Rectangle($x, $y, $w, $h)))
      $e.HasMorePages = $false
    })
    $pd.Print()
    $pd.Dispose()
  } finally {
    $img.Dispose()
  }
  return @{ ok = $true; file = $file; size = $safeSize; printer = $(if ($printer) { $printer } else { "(default)" }) }
}

function Handle-Api($Request, $Response, [string]$UrlPath) {
  $isPost = $Request.HttpMethod -eq "POST"
  if ($isPost -and $Request.Headers["X-Photobooth"] -ne "1") {
    Send-Json $Response @{ ok = $false; error = "Missing X-Photobooth header" } 403; return
  }
  try {
    switch ($UrlPath) {
      "/api/gif" {
        if (-not $isPost) { Send-Json $Response @{ ok = $false; error = "POST required" } 405; return }
        $q = $Request.QueryString
        $forceId = if ($q["id"] -match '^[A-Za-z0-9_]{8,64}$') { $q["id"] } else { $null }
        Send-Json $Response (Save-Gif (Read-Body $Request) $forceId)
      }
      "/api/strip" {
        if (-not $isPost) { Send-Json $Response @{ ok = $false; error = "POST required" } 405; return }
        $q = $Request.QueryString
        $id = if ($q["id"] -match '^[A-Za-z0-9_]{8,64}$') { $q["id"] } else { $null }
        if (-not $id) { $id = [guid]::NewGuid().ToString('N').Substring(0, 16) }
        $body = Read-Body $Request
        if (-not (Test-Path $GifFolder)) { New-Item -ItemType Directory -Path $GifFolder | Out-Null }
        [System.IO.File]::WriteAllBytes((Join-Path $GifFolder "$id.jpg"), $body)
        [System.IO.File]::WriteAllBytes((Join-Path $GifFolder "latest_strip.jpg"), $body)
        Send-Json $Response @{ ok = $true; id = $id; url = $(if ($ShareBase) { "$ShareBase/g/$id" } else { $null }) }
      }
      "/api/clear-session" {
        if (-not $isPost) { Send-Json $Response @{ ok = $false; error = "POST required" } 405; return }
        # Webapp clears its in-memory session; disk print/processed files are preserved in folder.
        Send-Json $Response @{ ok = $true }
      }
      "/api/handoff" {
        if (-not $isPost) { Send-Json $Response @{ ok = $false; error = "POST required" } 405; return }
        $folder = Get-HandoffFolder
        if (-not $folder) { throw "handoff is not enabled in $ConfigPath" }
        if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
        $body = Read-Body $Request
        $q = $Request.QueryString
        $layout  = if ($q["layout"] -match '^[A-Za-z0-9_]+$') { $q["layout"] } else { "2x6_strip4" }
        $ori     = if ($q["orientation"] -match '^(auto|portrait|landscape)$') { $q["orientation"] } else { "portrait" }
        $camOri  = if ($q["cameraOrientation"] -match '^(auto|portrait|landscape)$') { $q["cameraOrientation"] } else { "auto" }
        $rotated = [bool]($q["rotated"] -eq "1")
        $copies  = if ($q["copies"] -match '^\d+$') { [int]$q["copies"] } else { 1 }
        $tmpl    = if ($q["template"] -and $q["template"] -notmatch '[\\/:*?"<>|]') { $q["template"] } else { "auto" }
        $imgW    = if ($q["w"] -match '^\d+$') { [int]$q["w"] } else { 0 }
        $imgH    = if ($q["h"] -match '^\d+$') { [int]$q["h"] } else { 0 }

        # Write session metadata so booth_worker.py knows the exact layout/size/orientation/template from the fog booth.
        $meta = [ordered]@{
          layout            = $layout
          orientation       = $ori
          cameraOrientation = $camOri
          rotated           = $rotated
          template          = $tmpl
          copies            = $copies
          width             = $imgW
          height            = $imgH
          gifFolder         = $GifFolder
          updatedAt         = (Get-Date).ToString("o")
        } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText((Join-Path $folder "fog_session.json"), $meta, [System.Text.Encoding]::UTF8)

        $stamp = Get-Date -Format "yyyyMMdd_HHmmss_fff"
        $name = "fog__{0}__{1}__{2}__{3}.jpg" -f $layout, $ori, $copies, $stamp
        $final = Join-Path $folder $name
        # Write under a non-.jpg name first so booth_worker.py never picks up a half-written file.
        $tmp = "$final.part"
        [System.IO.File]::WriteAllBytes($tmp, $body)
        Move-Item -LiteralPath $tmp -Destination $final
        $pending = @(Get-ChildItem -Path $folder -File -Include *.jpg, *.jpeg -ErrorAction SilentlyContinue).Count
        Send-Json $Response @{ ok = $true; file = $final; layout = $layout; pendingShots = $pending }
      }
      "/api/status" {
        Send-Json $Response @{
          ok             = $true
          digiCamControl = (Test-DigiCamControl)
          irfanView      = $true
          mirrorDslr     = [bool]($Dcc -and $Dcc.mirrorImage)
          handoff        = [bool](Get-HandoffFolder)
          handoffInfo    = (Get-HandoffInfo)
          share          = @{ enabled = $ShareEnabled; baseUrl = $ShareBase }
          paperSizes     = (Get-PaperSizes)
          defaultPaper   = $(if ($Irf -and $Irf.defaultPaperSize) { $Irf.defaultPaperSize } else { $null })
        }
      }
      "/api/dslr/capture" {
        if (-not $isPost) { Send-Json $Response @{ ok = $false; error = "POST required" } 405; return }
        $bytes = Invoke-DslrCapture
        Send-Bytes $Response $bytes "image/jpeg"
      }
      "/api/print" {
        if (-not $isPost) { Send-Json $Response @{ ok = $false; error = "POST required" } 405; return }
        $body = Read-Body $Request
        Send-Json $Response (Invoke-IrfanPrint $body $Request.QueryString["size"])
      }
      "/api/template/image" {
        $rawName = $Request.QueryString["name"]
        $layout = $Request.QueryString["layout"]
        if (-not $rawName -or $rawName -eq "none" -or $rawName -eq "auto") {
          Send-Json $Response @{ ok = $false; error = "Missing template name" } 404
          return
        }
        $name = [System.IO.Path]::GetFileName($rawName)
        $h = $Config.handoff
        $folder = Get-HandoffFolder
        $tplRoot = if ($h -and $h.templatesFolder) { Resolve-RootPath $h.templatesFolder } elseif ($folder) { Join-Path (Split-Path $folder -Parent) "templates" } else { $null }
        $target = $null
        if ($tplRoot -and $layout -and (Test-Path (Join-Path $tplRoot $layout) -PathType Container)) {
          $sub = Join-Path (Join-Path $tplRoot $layout) $name
          if (Test-Path $sub -PathType Leaf) { $target = $sub }
        }
        if (-not $target -and $tplRoot -and (Test-Path (Join-Path $tplRoot $name) -PathType Leaf)) {
          $target = Join-Path $tplRoot $name
        }
        if (-not $target -and (Test-Path (Join-Path $Root "templates\$name") -PathType Leaf)) {
          $target = Join-Path $Root "templates\$name"
        }
        if ($target -and (Test-Path $target -PathType Leaf)) {
          $bytes = [System.IO.File]::ReadAllBytes($target)
          Send-Bytes $Response $bytes "image/png"
        } else {
          Send-Json $Response @{ ok = $false; error = "Template not found" } 404
        }
      }
      default { Send-Json $Response @{ ok = $false; error = "Unknown endpoint" } 404 }
    }
  } catch {
    Write-Host "API error ($UrlPath): $($_.Exception.Message)" -ForegroundColor Red
    Send-Json $Response @{ ok = $false; error = $_.Exception.Message } 500
  }
}

# ---------------------------------------------------------------- server
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add($Prefix)
$ShareListener = $null
$SharePS = $null

try {
  $Listener.Start()
  if ($ShareEnabled) {
    try {
      if (-not (Test-Path $GifFolder)) { New-Item -ItemType Directory -Path $GifFolder | Out-Null }
      $ShareListener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Any, $SharePort)
      $ShareListener.Start()
      $SharePS = [powershell]::Create().AddScript($ShareServerScript).AddArgument($ShareListener).AddArgument($GifFolder)
      [void]$SharePS.BeginInvoke()
    } catch {
      Write-Host "Could not start QR share server on port ${SharePort}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
  Write-Host "====================================================" -ForegroundColor Cyan
  Write-Host " ClickKit Glass Photobooth running at $Prefix" -ForegroundColor Green
  Write-Host " Test suite available at ${Prefix}tests.html" -ForegroundColor Yellow
  Write-Host " digiCamControl: $(if (Test-DigiCamControl) { 'available' } else { 'not available' })" -ForegroundColor Gray
  Write-Host " QR GIF Share:   $(if ($ShareBase) { $ShareBase } else { 'disabled / no LAN IP' })" -ForegroundColor Gray
  Write-Host " Press Ctrl+C to stop the server." -ForegroundColor Gray
  Write-Host "====================================================" -ForegroundColor Cyan

  while ($Listener.IsListening) {
    $Context = $Listener.GetContext()
    $Request = $Context.Request
    $Response = $Context.Response

    try {
      $UrlPath = [System.Uri]::UnescapeDataString($Request.Url.AbsolutePath)
      if ($UrlPath -eq "/") { $UrlPath = "/index.html" }

      if ($UrlPath.StartsWith("/api/")) {
        Handle-Api $Request $Response $UrlPath
        continue
      }

      # Reject path traversal
      $RelativePath = $UrlPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))

      $isPrivate = ($FullPath -eq $ConfigFull) -or
                   ($PrintFolder -and $FullPath.StartsWith($PrintFolder, [System.StringComparison]::OrdinalIgnoreCase)) -or
                   ($GifFolder -and $FullPath.StartsWith($GifFolder, [System.StringComparison]::OrdinalIgnoreCase))
      if ($isPrivate -or -not $FullPath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $Response.StatusCode = 403
        continue
      }

      if (Test-Path $FullPath -PathType Leaf) {
        $Ext = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
        $ContentType = if ($MimeTypes.ContainsKey($Ext)) { $MimeTypes[$Ext] } else { "application/octet-stream" }
        $Bytes = [System.IO.File]::ReadAllBytes($FullPath)
        $Response.ContentType = $ContentType
        $Response.ContentLength64 = $Bytes.Length
        $Response.StatusCode = 200
        $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
      } else {
        $Response.StatusCode = 404
      }
    } catch {
      Write-Host "Request error: $($_.Exception.Message)" -ForegroundColor Red
      try { $Response.StatusCode = 500 } catch { }
    } finally {
      try { $Response.Close() } catch { }
    }
  }
} catch {
  Write-Host "Server startup error: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($Listener.IsListening) { $Listener.Stop() }
  if ($ShareListener) { try { $ShareListener.Stop() } catch { } }
  if ($SharePS) { try { $SharePS.Dispose() } catch { } }
}
