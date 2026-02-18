# Instagram Emoji Completer (MV3 Extension)

Discord/Slack-style `:emoji:` autocomplete for Instagram Web.

## Features
- Suggests emoji while typing `:so` style prefixes.
- Supports repeat prefix: typing `5:so` and committing inserts five copies of the chosen emoji.
- Converts exact `:shortcode:` tokens (like `:sob:`) to emoji on closing `:`.
  - Repeat also works for exact codes (for example `5:sob:` -> `😭😭😭😭😭`).
- Supports keyboard navigation:
  - `ArrowUp` / `ArrowDown` to navigate
  - `Tab` and/or `Enter` to commit (configurable)
  - `Escape` to close
- Works in both `textarea` and `contenteditable` composer fields.
- Persists per-user ranking based on recently selected emoji.
- Includes options page with Discord-like / Slack-like presets.

## Install (Edge or Chrome)
1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `C:\projects\Emoji completer`.
5. Open Instagram Web and type `:so` in a composer.

## Branding Assets
- Extension icons are in `icons/` (`16`, `32`, `48`, `128`).
- To regenerate icons after editing style/colors, run:
  - `powershell -ExecutionPolicy Bypass -File scripts\\generate-icons.ps1`

## Settings
Open extension details and click **Extension options**.

Configurable:
- `mode` (`discord` or `slack`)
- min trigger characters
- max suggestions
- Tab commit / Enter commit
- auto convert exact `:shortcode:`
- optional trailing space
- optional basic emoticon conversion (`:)`, `:D`, `<3`)

## Important Notes
- This build now ships with a full RGI emoji dataset (including flags, modifiers, and ZWJ sequences) with expanded aliases/keywords.
- To regenerate `emoji-data.js` from local packaged sources, run:
  - `python scripts\\generate_emoji_data.py`
- Instagram DOM changes can impact editor detection; selectors are conservative to reduce breakage.
- Undo behavior depends on how Instagram's editor reconciles synthetic input events.
