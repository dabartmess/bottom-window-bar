# Bottom Window Bar (GNOME Shell)

A bottom taskbar listing currently open application windows with an app icon above each window title.

## Features

- Click a window to activate or unminimize it.
- Optionally group windows by application. Clicking a grouped icon cycles through the group's windows.
- Show windows on the current workspace or across all workspaces.
- Change the background color using `#RRGGBB` or `#RRGGBBAA` in Preferences.
- Hide/pause the bar with **Show bottom bar**, and restore it in Preferences.
- Scroll horizontally with the mouse wheel or touchpad when too many items fit; the visible scrollbar is hidden.
- The bar is anchored to the **primary monitor**.

## Install on Ubuntu

Unzip the archive, then in a terminal inside the extracted directory run:

```bash
sudo apt install libglib2.0-bin gnome-shell-extension-prefs
./install.sh
```

**Log out and back in** to allow GNOME Shell to discover the new extension (required for a new extension in many Wayland sessions). Then:

```bash
gnome-extensions enable 'bottom-window-bar@dabartmess.github.com'
gnome-extensions prefs 'bottom-window-bar@dabartmess.github.com'
```

You can also manage the extension with the GNOME **Extensions** application.

## Hide, disable or uninstall

To temporarily hide the bar while leaving the extension enabled, turn off **Show bottom bar** in Preferences. To disable it completely:

```bash
gnome-extensions disable 'bottom-window-bar@dabartmess.github.com'
```

To uninstall, first disable it and then remove its extension directory:

```bash
rm -rf "$HOME/.local/share/gnome-shell/extensions/bottom-window-bar@dabartmess.github.com"
```

Log out/back in afterward if GNOME still lists it.

## Compatibility and limitations

- Written for modern GNOME Shell ESM extensions (GNOME 46–51), but not tested in a live GNOME desktop here.
- Some special windows (e.g. system dialogs and windows set to skip the taskbar) are intentionally omitted.
- GNOME only applies this to the primary monitor, not every connected screen.
- This is an independently built extension, not GNOME's official Window List extension.
- The bar uses the horizontal workspace work area to avoid docks that reserve screen space. For floating/auto-hidden side docks, set manual left/right clearance in Preferences.

Troubleshooting: `journalctl --user -b | grep -i 'bottom-window-bar'` or `journalctl -b /usr/bin/gnome-shell`.

## Auto-hide (new)

Open **Extensions → Bottom Window Bar → Preferences** and enable
**Automatically hide the bottom bar**. The bar disappears, freeing the
normal GNOME work area; move the pointer to the very bottom edge of the
primary monitor to reveal it. When the pointer leaves the bar, it hides
after a short delay. The bottom-edge hotspot is 3 pixels high.

The **Show bottom bar** switch takes priority: turning it off hides both
the bar and its reveal hotspot. Auto-hide is disabled by default.

To update an existing installation, extract the new ZIP and run `./install.sh`
again, then log out and back in to reload the extension code and schema.

Repository: https://github.com/dabartmess/bottom-window-bar

## GNOME Shell 51 compatibility

Version 2 adds Shell 51 to `metadata.json` and replaces the removed `St.BoxLayout.vertical` property with `orientation: Clutter.Orientation.VERTICAL/HORIZONTAL`. This is a source-level compatibility update; test in an actual GNOME Shell 51 session before considering runtime compatibility confirmed.

## Version 3: side docks and compact window items

- Respects GNOME workspace work-area boundaries so a left- or right-side dock
  that reserves space does not overlap the window bar.
- For docks that float over desktop content and do not reserve work area,
  choose manual **Extra left clearance** or **Extra right clearance** in Preferences.
  The larger of the automatic and manual inset is used on each side.
- Change **Icon size** (12–64 px; default 24) and **Window title size**
  (7–20 pt; default 9) without editing CSS. Item width and bar height adjust.
- The auto-hide reveal hotspot is kept inside the same horizontal bounds.
- Metadata version is 3; supported GNOME Shell versions are 46–51.

To update, run `./install.sh` from the newly extracted version 3 directory,
then log out and back in. Check the version using
`gnome-extensions show bottom-window-bar@dabartmess.github.com`.

## Automatic side-dock width (version 4)

**Automatically detect side-dock width** is enabled by default. The bar uses
Mutter's work-area insets for docks that reserve screen space and reads the
full content width of **Ubuntu Dock** or **Dash to Dock** on the primary
monitor, including floating/auto-hidden docks where supported. When the dock
width or position changes, the bar rechecks its layout automatically.

**Extra left/right clearance** remain optional minimum overrides (default 0 px).
The effective clearance on each side is the maximum of the workspace inset,
detected dock width, and manual minimum, rather than their sum. If a different
dock extension does not provide recognizable geometry or reserve screen space,
set its side's manual clearance as a fallback.

This feature uses internal Ubuntu Dock / Dash to Dock interfaces, which may
change with future versions. Runtime behavior should be tested on GNOME 51.


## Version 5: bottom scrollbar clearance and per-window context menu

- **Bottom offset:** Preferences → Bottom scrollbar clearance → Bottom offset (pixels). Defaults to 16 pixels and can be adjusted from 0–120 pixels. The auto-hide reveal sensor remains at the physical bottom edge.
- **Window actions:** Right-click a window item for Minimize, Maximize, Restore or Close. For grouped applications, choose the specific window's submenu first. Close requests a normal application window close (applications can still display unsaved-changes confirmation).
- **Restore** returns a minimized and/or maximized window to its normal state and activates it.

### Upgrade

Run `./install.sh` from this directory, log out and back in, then run:

```bash
gnome-extensions enable bottom-window-bar@dabartmess.github.com
gnome-extensions show bottom-window-bar@dabartmess.github.com
```

Version should report **5**. Window-menu behavior must be tested in a live GNOME Shell session.

## Version 6: scrollbar-free window list

The window-list bar no longer displays a horizontal scrollbar. When the list
exceeds available width, use the mouse wheel or a touchpad scroll gesture over
the list to move left and right. The bottom offset setting from version 5 is
retained; set it to 0 if no extra gap above the screen edge is desired.

Run `./install.sh`, log out and back in, then confirm:

```bash
gnome-extensions show bottom-window-bar@dabartmess.github.com
```

The version should be 6.
