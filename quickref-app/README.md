# QuickRef (desktop)

An offline SOP/notes reference tool for QC and production teams — Electron desktop rewrite of the
original single-file HTML tool.

**Important — read this first:** this code was written in a sandboxed environment with no internet
access and no display, so it could not be `npm install`ed, launched, or visually tested before being
handed to you. It's written carefully against documented, stable APIs (Electron, sql.js, TipTap,
esbuild, electron-builder), but treat this as a strong first draft rather than a verified build. Run
through the steps below, and if anything errors, send me the exact message and I'll fix it.

Built specifically for a locked-down machine with **no admin rights and no Node.js installed** — see
"No admin rights, no Node.js" below for exactly how to get this running from scratch.

The database uses **sql.js** (SQLite compiled to WebAssembly) rather than a native module. That's a
deliberate choice: native modules can require compiling C++ code on install, which needs a build
toolchain you likely can't install without admin rights. sql.js is pure JavaScript/WASM — nothing to
compile, ever.

## What's different from the HTML version

- Real file access: attachments open in their native app (Word, Excel, Adobe Reader…) directly — no
  Downloads-folder detour, because that limitation was a browser sandbox restriction, not a design
  choice, and Electron doesn't have it.
- Data lives **outside** the app: a small `quickref.config.json` file next to the executable points at
  a data folder, which holds one SQLite database (`quickref.db`, all your entries/tags/categories) plus
  a `Documents/` folder with your real attached files. Replace the .exe with a future version and your
  data is untouched — nothing is bundled inside the executable.
- Entries open in a clean **read view** by default; a **Modify** button switches to edit mode, where
  **Save changes** / **Cancel** appear. Cancel discards edits to the text/name/category/platform/tags;
  it does *not* undo attachments added or removed during that session (see note below).
- Tags: Category and Platform stay as the existing structured, editable-in-Preferences dropdowns;
  freeform **tags** are a new, separate field per entry (type + Enter to add, click ✕ to remove),
  filterable the same way search already works.
- Rich text uses TipTap instead of the deprecated `document.execCommand` — same toolbar, more reliable
  engine underneath.

## One behavior worth knowing

Attachments (drag-and-drop) commit to disk **immediately** when dropped or removed — they are not part
of the Save/Cancel draft. This matches how the original tool behaved and avoids a more complex
"staged files" system that would need real testing to get right. If you'd rather attachments only take
effect on Save (fully revertible on Cancel), that's a reasonable follow-up change — flag it and I'll
build it.

## Project layout

```
quickref-app/
  package.json
  build.js                  esbuild bundler for the renderer
  src/
    main/                   Electron main process (window, database, file I/O)
      main.js
      config.js             finds/creates the data folder + config file
      db.js                 SQLite schema
      ipc.js                all app logic: entries, tags, categories, platforms, files
    preload/
      preload.js            safe bridge exposing window.quickref to the renderer
    renderer/               the UI itself
      index.html
      styles.css
      app.js                list / detail / edit / tags / preferences logic
      editor.js             TipTap rich-text editor setup
```

## Easiest path: let GitHub build it for you (no local Node.js, no admin rights, no command line)

This repo includes `.github/workflows/build.yml`, which builds the portable .exe on GitHub's own
cloud Windows machine — not yours. Everything below happens in a web browser.

1. Go to github.com and sign in (or create a free account).
2. Click **New repository**. Name it anything (e.g. `quickref-app`); **Private** is recommended since
   this is an internal tool, though the source code itself contains no client data. Create it empty
   (don't add a README/gitignore on GitHub's side).
3. On the empty repo's page, click **"uploading an existing file"**. Drag the whole extracted
   `quickref-app` folder into the upload box (modern browsers preserve the folder structure, including
   the hidden `.github` folder). Commit the upload.
4. Click the **Actions** tab. GitHub should already be running the build (triggered by your upload);
   if not, click **Build QuickRef portable exe** on the left, then **Run workflow**.
5. Wait a few minutes for the green checkmark.
6. Click into the finished run, scroll to **Artifacts**, and download **QuickRef-portable** — this
   downloads a small zip containing the actual `.exe`.
7. Unzip it. `QuickRef-portable.exe` is the finished, ready-to-run app — copy it to your machine and
   run it directly. No install, no admin rights, no Node.js involved at any point on your end.

If your organization doesn't allow pushing internal tool source code to GitHub even privately, the
same idea works on GitLab (built-in CI, same concept) or other CI providers — ask me and I'll write
the equivalent config.

## Alternative: no admin rights, no Node.js, build it locally yourself

You need Node.js only to **build** the app, once. The resulting portable .exe needs no admin rights
and no Node.js to **run**.

1. Go to nodejs.org's downloads page and get the **"Windows Binary (.zip)"** — not the installer.
   This is a plain folder of files; no install step, no admin prompt.
2. Extract the zip anywhere you have write access (Desktop, Downloads, a project folder).
3. Open PowerShell and add that folder to your session's PATH (this only affects the current
   window, not your system — no admin needed):
   ```
   $env:Path = "C:\path\to\extracted\node-folder;" + $env:Path
   ```
4. If PowerShell refuses to run `npm` at all with a script-execution error, that's Windows'
   execution policy blocking `.ps1` scripts — fixable for your user account only, no admin required:
   ```
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```
5. `cd` into this project folder and continue with the steps below.

**Realistic expectations:** this removes the two biggest blockers (installing Node, and a native
module needing a compiler). What I can't rule out from here is your network/proxy — if your
organization blocks npmjs.org or GitHub (where Electron's binary is hosted), `npm install` will fail
with a network error, and that needs an IT allowlist change, not a code fix. If that happens, the
exact error message will tell us which domain is blocked.

## Setup

```
npm install
```

This pulls Electron, sql.js, TipTap, esbuild, and electron-builder — all pure JavaScript/WASM, no
native compilation step for any of them.

## Run it in development

```
npm start
```

First launch asks where to store your data (default: a `QuickRefData` folder next to the app) — pick
"Use default folder" unless you want it somewhere specific (e.g. a synced drive).

## Build the portable .exe

```
npm run dist
```

Output lands in `release/QuickRef-portable.exe` — a single file, no installer, no admin rights needed.
Hand that file to anyone; running it the first time will ask for a data folder just like `npm start`
does.

### A packaging detail that matters

Windows portable builds (from `electron-builder`) actually unpack themselves into a temporary folder
each time they run — the running app's own file path is **not** a stable location. `electron-builder`
solves this by setting an environment variable, `PORTABLE_EXECUTABLE_DIR`, pointing at the real,
stable folder the .exe lives in. `config.js` specifically uses that variable (falling back sensibly in
dev mode) — this is the detail that makes "config and data live next to the exe, and survive replacing
it" actually work. If you ever see data or config appearing in a strange temp-looking path, that's the
first thing to check.

## Things I'd want you to test and report back on

- `npm install` completing without errors (should be smoother now with no native compilation step,
  but the network/proxy caveat above is a real unknown from where I sit).
- The first-run "where should data live" prompt.
- Drag-and-drop attaching a real file, and opening it back up.
- Save / Cancel / Modify on both a new entry and an existing one.
- The portable .exe running from a USB stick or a folder without admin rights.
- Whether your IT security policy allows the built .exe to actually *run* at all — some
  organizations block unrecognized/unsigned executables outright (application allowlisting), which
  is separate from admin rights and isn't something any build setting here can get around.

## Packaging note

The build is set to `"asar": false`, meaning the packaged app ships as plain files rather than one
archive. Slightly larger on disk, but it removes an entire category of "does this file get read
correctly through the archive" uncertainty for something I can't test-run myself — worth revisiting
once you've confirmed a working build, if a more compact package matters.
