# Local Loopback Static Server for Picnic Glass Fog Photobooth
# Binds strictly to 127.0.0.1, rejects path traversal, and serves ES module & WASM MIME types.

param(
  [int]$Port = 8080
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

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add($Prefix)

try {
  $Listener.Start()
  Write-Host "====================================================" -ForegroundColor Cyan
  Write-Host " Picnic Glass Photobooth running at $Prefix" -ForegroundColor Green
  Write-Host " Test suite available at ${Prefix}tests.html" -ForegroundColor Yellow
  Write-Host " Press Ctrl+C to stop the server." -ForegroundColor Gray
  Write-Host "====================================================" -ForegroundColor Cyan

  while ($Listener.IsListening) {
    $Context = $Listener.GetContext()
    $Request = $Context.Request
    $Response = $Context.Response

    $UrlPath = [System.Uri]::UnescapeDataString($Request.Url.AbsolutePath)
    if ($UrlPath -eq "/") { $UrlPath = "/index.html" }

    # Reject path traversal
    $RelativePath = $UrlPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))

    if (-not $FullPath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $Response.StatusCode = 403
      $Response.Close()
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
    $Response.Close()
  }
} catch {
  Write-Host "Server startup error: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($Listener.IsListening) { $Listener.Stop() }
}
