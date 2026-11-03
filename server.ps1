# Local Loopback Static Server for Picnic Glass Fog Photobooth
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
$Root = (Get-Location).Path
$Prefix = "http://127.0.0.1:$Port/"

$MimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".mjs"  = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".wasm" = "application/wasm"
  ".task" = "application/octet-stream"
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
      if ($line -match '^(GET|HEAD) /g/([A-Za-z0-9]{8,64})(\.gif)?(\?dl=1)? HTTP/1\.[01]$') {
        $isHead = $Matches[1] -eq 'HEAD'; $id = $Matches[2]; $wantGif = [bool]$Matches[3]; $dl = [bool]$Matches[4]
        $file = Join-Path $GifDir "$id.gif"
        if (Test-Path -LiteralPath $file -PathType Leaf) {
          $status = '200 OK'
          if ($wantGif) {
            $type = 'image/gif'; $body = [System.IO.File]::ReadAllBytes($file)
            if ($dl) { $extra = "Content-Disposition: attachment; filename=`"picnic-glass-$id.gif`"`r`n" }
          } else {
            $type = 'text/html; charset=utf-8'
            $html = @"
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Picnic Glass GIF</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#1F3038;color:#F4F8F9;text-align:center;padding:18px}
img{max-width:100%;border-radius:12px;box-shadow:0 6px 24px #0008}a{display:inline-block;margin:18px 0 8px;padding:14px 26px;border-radius:999px;background:#F2B544;color:#1F3038;font-weight:700;text-decoration:none;font-size:1.1rem}
p{opacity:.8;font-size:.9rem}</style></head><body>
<h2>&#128248; Your Picnic Glass GIF</h2><img src="/g/$id.gif" alt="Your photobooth GIF">
<br><a href="/g/$id.gif?dl=1" download="picnic-glass-$id.gif">Download GIF</a>
<p>iPhone: press and hold the GIF &rarr; <b>Save to Photos</b>.<br>Android: tap Download, or press and hold &rarr; Download image.</p>
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

function Save-Gif([byte[]]$Bytes) {
  if (-not $ShareEnabled) { throw "GIF sharing is not enabled in $ConfigPath" }
  if ($Bytes.Length -lt 6 -or [System.Text.Encoding]::ASCII.GetString($Bytes, 0, 6) -ne 'GIF89a') { throw "Not a GIF" }
  if (-not (Test-Path $GifFolder)) { New-Item -ItemType Directory -Path $GifFolder | Out-Null }
  # Random, unguessable id so guests can't browse each other's GIFs.
  $id = [guid]::NewGuid().ToString('N').Substring(0, 16)
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

# Saves the print-ready image and sends it to IrfanView with the paper-size profile.
function Invoke-IrfanPrint([byte[]]$Bytes, [string]$SizeId) {
  if (-not $Irf) { throw "IrfanView is not configured in $ConfigPath" }
  $exe = Resolve-RootPath $Irf.exePath
  if (-not $exe -or -not (Test-Path $exe -PathType Leaf)) { throw "IrfanView not found: $exe" }
  if ($SizeId -notmatch '^[A-Za-z0-9_\-]+$') { throw "Invalid paper size id" }
  $size = $Irf.paperSizes.$SizeId
  if (-not $size) { throw "Unknown paper size '$SizeId'" }

  if (-not (Test-Path $PrintFolder)) { New-Item -ItemType Directory -Path $PrintFolder | Out-Null }
  $file = Join-Path $PrintFolder ("{0}-{1}.png" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff"), $SizeId)
  [System.IO.File]::WriteAllBytes($file, $Bytes)

  $argList = @("`"$file`"")
  $ini = Resolve-RootPath $size.iniFolder
  if ($ini) {
    if (-not (Test-Path $ini)) { New-Item -ItemType Directory -Path $ini | Out-Null }
    $argList += "/ini=`"$ini`""
  }
  $printer = if ($size.printer) { $size.printer } elseif ($Irf.printer) { $Irf.printer } else { "" }
  if ($printer) { $argList += "/print=`"$printer`"" } else { $argList += "/print" }

  Start-Process -FilePath $exe -ArgumentList $argList -WindowStyle Hidden | Out-Null
  return @{ ok = $true; file = $file; size = $SizeId; printer = $(if ($printer) { $printer } else { "(default)" }) }
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
        Send-Json $Response (Save-Gif (Read-Body $Request))
      }
      "/api/handoff" {
        if (-not $isPost) { Send-Json $Response @{ ok = $false; error = "POST required" } 405; return }
        $folder = Get-HandoffFolder
        if (-not $folder) { throw "handoff is not enabled in $ConfigPath" }
        if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
        $body = Read-Body $Request
        $q = $Request.QueryString
        $layout = if ($q["layout"] -match '^[A-Za-z0-9_]+$') { $q["layout"] } else { "2x6_strip4" }
        $ori    = if ($q["orientation"] -match '^(auto|portrait|landscape)$') { $q["orientation"] } else { "auto" }
        $copies = if ($q["copies"] -match '^\d+$') { [int]$q["copies"] } else { 1 }
        $tmpl   = if ($q["template"] -and $q["template"] -notmatch '[\\/:*?"<>|]') { $q["template"] } else { "auto" }
        $imgW   = if ($q["w"] -match '^\d+$') { [int]$q["w"] } else { 0 }
        $imgH   = if ($q["h"] -match '^\d+$') { [int]$q["h"] } else { 0 }

        # Write session metadata so booth_worker.py knows the exact layout/size/orientation/template from the fog booth.
        $meta = [ordered]@{
          layout      = $layout
          orientation = $ori
          template    = $tmpl
          copies      = $copies
          width       = $imgW
          height      = $imgH
          updatedAt   = (Get-Date).ToString("o")
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
        $exe = if ($Irf) { Resolve-RootPath $Irf.exePath } else { $null }
        Send-Json $Response @{
          ok             = $true
          digiCamControl = (Test-DigiCamControl)
          irfanView      = [bool]($exe -and (Test-Path $exe -PathType Leaf))
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
  Write-Host " Picnic Glass Photobooth running at $Prefix" -ForegroundColor Green
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
