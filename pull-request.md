Title: Fix GitHub Pages entry point and local startup instructions

The repository uses `Index.html`, so case-sensitive static hosting cannot find the default `index.html` homepage. The README also references missing launchers, and the local server serves the caller's working directory instead of the app folder.

Changes:
- Rename the homepage to lowercase `index.html` without changing its contents.
- Serve files relative to `$PSScriptRoot` so launching the server from another directory works.
- Correct the documented command to use the existing `server.ps1` and document Pages setup.
- Add the missing `tests.html` runner for the existing browser suite.

Validation: all 14 browser assertions passed. The root homepage loaded through the PowerShell server launched from a different directory, and the demo button entered Picnic Demo Mode. JavaScript syntax checks passed. Camera permission and live landmark inference were not tested.

Apply from a checkout of the repository:
```powershell
git switch -c codex/fix-startup
git apply --index /path/to/fix-startup.patch
git commit -m "fix: repair static homepage and local startup"
git push -u origin codex/fix-startup
```

GitHub integration rejected branch creation with HTTP 403, so no remote branch or pull request was created.
