import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_DELAY_MS = 60;
const EDGE_TRIGGER_HEIGHT = 3;
const AUTO_HIDE_DELAY_MS = 450;
const DOCK_CHECK_INTERVAL_MS = 1500;

export default class BottomWindowBar extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tracker = Shell.WindowTracker.get_default();
        this._signals = [];
        this._windowSignals = new Map();
        this._itemSignals = [];
        this._menuItemSignals = [];
        this._refreshId = 0;
        this._hideId = 0;
        this._dockCheckId = 0;
        this._chromeUsesStruts = null;
        this._barGeometry = null;
        // GNOME owns the panel manager; this extension owns ONE popup menu.
        // A single, explicitly named object lets the review tool verify that
        // disable() destroys it. Menu contents change for each clicked window.
        this._menuManager = Main.panel.menuManager;
        this._bar = new St.BoxLayout({
            style_class: 'bottom-window-bar',
            reactive: true,
            height: this._getBarHeight(),
            x_expand: true,
            y_expand: false,
        });

        this._scroll = new St.ScrollView({
            style_class: 'bottom-window-scroll',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: false,
        });
        // Hide BOTH scrollbars. Overflow remains accessible with the mouse wheel
        // (and touchpad scrolling), without a scrollbar covering window titles.
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.NEVER);
        this._connect(this._scroll, 'scroll-event', (_actor, event) => {
            const adj = this._scroll.get_hadjustment();
            if (!adj)
                return Clutter.EVENT_PROPAGATE;

            const maxValue = Math.max(0, adj.get_upper() - adj.get_page_size());
            if (maxValue <= 0)
                return Clutter.EVENT_PROPAGATE;

            const direction = event.get_scroll_direction();
            let amount = 0;
            if (direction === Clutter.ScrollDirection.SMOOTH) {
                const [dx, dy] = event.get_scroll_delta();
                amount = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * 45;
            } else if (direction === Clutter.ScrollDirection.DOWN ||
                       direction === Clutter.ScrollDirection.RIGHT) {
                amount = 75;
            } else if (direction === Clutter.ScrollDirection.UP ||
                       direction === Clutter.ScrollDirection.LEFT) {
                amount = -75;
            }
            if (amount === 0)
                return Clutter.EVENT_PROPAGATE;

            adj.set_value(Math.max(0, Math.min(maxValue, adj.get_value() + amount)));
            return Clutter.EVENT_STOP;
        });
        this._items = new St.BoxLayout({
            style_class: 'bottom-window-items',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: false,
        });
        this._scroll.set_child(this._items);
        this._bar.add_child(this._scroll);

        this._contextMenu = new PopupMenu.PopupMenu(this._bar, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(this._contextMenu.actor);
        this._contextMenu.actor.hide();
        this._menuManager.addMenu(this._contextMenu);
        this._connect(this._contextMenu, 'open-state-changed', (_menu, open) => {
            if (open) {
                this._cancelHide();
                this._bar.show();
            } else {
                this._scheduleHide();
            }
        });

        // The edge sensor is only interactive while the auto-hidden bar is offscreen.
        // No permanent strip occupies the screen when auto-hide is disabled.
        this._edgeTrigger = new St.Widget({
            style_class: 'bottom-window-edge-trigger',
            reactive: true,
        });
        Main.layoutManager.addChrome(this._edgeTrigger, {
            affectsStruts: false,
            trackFullscreen: true,
        });
        this._connect(this._edgeTrigger, 'enter-event', () => this._revealBar());
        this._connect(this._bar, 'enter-event', () => this._cancelHide());
        this._connect(this._bar, 'leave-event', () => this._scheduleHide());

        this._connect(this._settings, 'changed', (_settings, key) => {
            if (['icon-size', 'text-size', 'left-clearance', 'right-clearance',
                'auto-dock-clearance', 'bottom-offset'].includes(key))
                this._updatePosition();
            if (key === 'show-bar' || key === 'auto-hide')
                this._applyVisibility();
            this._queueRefresh();
        });
        this._connect(this._tracker, 'tracked-windows-changed', () => this._queueRefresh());
        this._connect(global.display, 'notify::focus-window', () => this._updateFocus());
        this._connect(global.display, 'restacked', () => this._queueRefresh());
        this._connect(global.workspace_manager, 'active-workspace-changed', () =>
            this._queueRefresh());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._updatePosition());
        this._connect(global.display, 'workareas-changed', () => this._updatePosition());

        this._updatePosition();
        this._applyVisibility();
        this._refresh();
        // Docks can be resized, reconfigured, enabled, or disabled after us.
        // Poll only their geometry; do not redraw window buttons needlessly.
        this._dockCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            DOCK_CHECK_INTERVAL_MS, () => {
                if (!this._bar)
                    return GLib.SOURCE_REMOVE;
                this._updatePosition();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    // Track signal handlers of temporary window buttons and menu items separately.
    // They are discarded on each refresh, not just when the extension is disabled.
    _connectItem(object, signal, callback) {
        this._itemSignals.push([object, object.connect(signal, callback)]);
    }

    _disconnectItemSignals() {
        for (const [object, id] of this._itemSignals) {
            object.disconnect(id);
        }
        this._itemSignals = [];
    }

    _connectMenuItem(object, signal, callback) {
        this._menuItemSignals.push([object, object.connect(signal, callback)]);
    }

    _disconnectMenuItemSignals() {
        for (const [object, id] of this._menuItemSignals)
            object.disconnect(id);
        this._menuItemSignals = [];
    }

    _getBarHeight() {
        const iconSize = this._settings.get_int('icon-size');
        const textSize = this._settings.get_int('text-size');
        return Math.max(42, Math.ceil(iconSize + textSize * 1.65 + 19));
    }

    _getItemWidth() {
        const iconSize = this._settings.get_int('icon-size');
        const textSize = this._settings.get_int('text-size');
        return Math.max(72, Math.round(Math.max(iconSize * 2.8, textSize * 11.5)));
    }

    _getSideDockInsets(monitorIndex) {
        // Dash to Dock is also the backend of Ubuntu Dock. When its dock is
        // auto-hidden or floating it may not reserve a Mutter work-area strut.
        // Inspect its actual dock content width rather than assuming an icon size.
        let left = 0;
        let right = 0;
        if (!this._settings.get_boolean('auto-dock-clearance'))
            return {left, right};

        const uuids = [
            'ubuntu-dock@ubuntu.com',
            'dash-to-dock@micxgx.gmail.com',
        ];
        for (const uuid of uuids) {
            try {
                const extension = Main.extensionManager.lookup(uuid);
                // stateObj and dockManager are internal to these dock extensions.
                const manager = extension?.stateObj?.dockManager ??
                    extension?.stateObj?._dockManager;
                const docks = manager?._allDocks ?? manager?.allDocks ?? [];
                for (const dock of docks) {
                    if (dock.monitorIndex !== monitorIndex)
                        continue;
                    const side = dock.position ?? dock._position;
                    if (side !== St.Side.LEFT && side !== St.Side.RIGHT)
                        continue;
                    const content = dock._box ?? dock.dash;
                    const preferred = content?.get_preferred_width?.(-1);
                    const natural = preferred?.[1] ?? 0;
                    // Use the content width (full dock), not the slide-out
                    // edge sensor's width, which shrinks during auto-hide.
                    const width = Math.ceil(natural);
                    if (!Number.isFinite(width) || width <= 0 || width > 500)
                        continue;
                    if (side === St.Side.LEFT)
                        left = Math.max(left, width);
                    else
                        right = Math.max(right, width);
                }
            } catch (error) {
                // A dock may be loading or reconfiguring; retry next cycle.
                console.debug(`Bottom Window Bar: dock measurement: ${error}`);
            }
        }
        return {left, right};
    }

    _updatePosition() {
        if (!this._bar)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        // Mutter's workspace work area excludes dock/panel struts, when present.
        // Only take horizontal insets: the bar is always anchored to screen bottom.
        let leftInset = 0;
        let rightInset = 0;
        try {
            const workspace = global.workspace_manager.get_active_workspace();
            const monitorIndex = Main.layoutManager.primaryIndex;
            if (workspace && Number.isInteger(monitorIndex)) {
                const area = workspace.get_work_area_for_monitor(monitorIndex);
                leftInset = Math.max(0, area.x - monitor.x);
                rightInset = Math.max(0,
                    (monitor.x + monitor.width) - (area.x + area.width));
            }
        } catch (error) {
            console.warn(`Bottom Window Bar: cannot determine work area: ${error}`);
        }

        // Work-area insets apply to any dock/panel with reserved struts.
        // Detect Ubuntu Dock / Dash to Dock even when floating/auto-hidden.
        // Manual clearance remains a minimum, never added twice.
        const dock = this._getSideDockInsets(Main.layoutManager.primaryIndex);
        leftInset = Math.max(leftInset, dock.left,
            this._settings.get_int('left-clearance'));
        rightInset = Math.max(rightInset, dock.right,
            this._settings.get_int('right-clearance'));
        // Avoid invalid geometry if dock settings are unusually large.
        const maxInsets = Math.max(0, monitor.width - 1);
        leftInset = Math.min(leftInset, maxInsets);
        rightInset = Math.min(rightInset, maxInsets - leftInset);
        const width = Math.max(1, monitor.width - leftInset - rightInset);
        const height = this._getBarHeight();
        const x = monitor.x + leftInset;
        // Keep the visible bar above the bottom-edge scrollbar/overlay.
        // The reveal sensor stays at the *actual* bottom of the monitor.
        const bottomOffset = this._settings.get_int('bottom-offset');
        const y = monitor.y + monitor.height - height - bottomOffset;
        const old = this._barGeometry;
        if (old && old.x === x && old.y === y &&
            old.width === width && old.height === height)
            return;
        this._barGeometry = {x, y, width, height};
        this._bar.set_position(x, y);
        this._bar.set_size(width, height);
        this._edgeTrigger.set_position(x,
            monitor.y + monitor.height - EDGE_TRIGGER_HEIGHT);
        this._edgeTrigger.set_size(width, EDGE_TRIGGER_HEIGHT);
    }

    _setChromeStruts(affectsStruts) {
        if (this._chromeUsesStruts === affectsStruts)
            return;
        if (this._chromeUsesStruts !== null)
            Main.layoutManager.removeChrome(this._bar);
        Main.layoutManager.addChrome(this._bar, {
            affectsStruts,
            trackFullscreen: true,
        });
        this._chromeUsesStruts = affectsStruts;
    }

    _cancelHide() {
        if (this._hideId) {
            GLib.source_remove(this._hideId);
            this._hideId = 0;
        }
    }

    _revealBar() {
        if (!this._settings?.get_boolean('show-bar') ||
            !this._settings.get_boolean('auto-hide'))
            return;
        this._cancelHide();
        this._edgeTrigger.hide();
        this._bar.show();
    }

    _hideBar() {
        if (!this._bar || !this._settings?.get_boolean('show-bar') ||
            !this._settings.get_boolean('auto-hide'))
            return;
        if (this._contextMenu?.isOpen)
            return;
        this._bar.hide();
        this._edgeTrigger.show();
    }

    _scheduleHide() {
        if (!this._settings?.get_boolean('auto-hide') ||
            !this._settings.get_boolean('show-bar'))
            return;
        this._cancelHide();
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            AUTO_HIDE_DELAY_MS, () => {
                this._hideId = 0;
                if (!this._bar || !this._settings)
                    return GLib.SOURCE_REMOVE;
                if (this._contextMenu?.isOpen)
                    return GLib.SOURCE_REMOVE;
                const [x, y] = global.get_pointer();
                const rect = this._barGeometry;
                // Do not hide while the pointer is still within the visible bar.
                if (rect && x >= rect.x && x < rect.x + rect.width &&
                    y >= rect.y && y < rect.y + rect.height)
                    return GLib.SOURCE_REMOVE;
                this._hideBar();
                return GLib.SOURCE_REMOVE;
            });
    }

    _applyVisibility() {
        if (!this._bar)
            return;
        const enabled = this._settings.get_boolean('show-bar');
        const autoHide = this._settings.get_boolean('auto-hide');
        this._cancelHide();
        // Auto-hide must never reserve desktop space for an invisible bar.
        this._setChromeStruts(enabled && !autoHide);
        if (!enabled) {
            this._bar.hide();
            this._edgeTrigger.hide();
        } else if (autoHide) {
            this._bar.hide();
            this._edgeTrigger.show();
        } else {
            this._edgeTrigger.hide();
            this._bar.show();
        }
    }

    _queueRefresh() {
        if (this._refreshId)
            return;
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            REFRESH_DELAY_MS, () => {
                this._refreshId = 0;
                if (this._bar)
                    this._refresh();
                return GLib.SOURCE_REMOVE;
            });
    }

    _windowList() {
        const all = this._settings.get_boolean('all-workspaces');
        const workspace = global.workspace_manager.get_active_workspace();
        return global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(win => win && !win.skip_taskbar &&
                (all || win.is_on_all_workspaces() || win.get_workspace() === workspace))
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
    }

    _refresh() {
        const color = this._settings.get_string('background-color');
        const safeColor = /^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/.test(color)
            ? color : '#263244';
        this._bar.set_style(`background-color: ${safeColor};`);

        for (const [window, signalIds] of this._windowSignals) {
            for (const id of signalIds)
                window.disconnect(id);
        }
        this._windowSignals.clear();
        // Refresh only dynamic menu contents; keep the one owned menu alive.
        this._contextMenu.close(false);
        this._disconnectMenuItemSignals();
        this._contextMenu.removeAll();
        this._disconnectItemSignals();
        this._items.destroy_all_children();

        const windows = this._windowList();
        for (const win of windows) {
            const signalIds = [
                win.connect('notify::title', () => this._queueRefresh()),
                win.connect('workspace-changed', () => this._queueRefresh()),
                win.connect('unmanaged', () => this._queueRefresh()),
            ];
            this._windowSignals.set(win, signalIds);
        }

        if (this._settings.get_boolean('group-windows')) {
            const groups = new Map();
            for (const win of windows) {
                const app = this._tracker.get_window_app(win);
                const key = app?.get_id() ?? win.get_wm_class() ??
                    `window-${win.get_stable_sequence()}`;
                if (!groups.has(key))
                    groups.set(key, {app, windows: []});
                groups.get(key).windows.push(win);
            }
            for (const group of groups.values()) {
                const name = group.app?.get_name() ??
                    group.windows[0].get_wm_class() ?? 'Window';
                const count = group.windows.length;
                this._addItem(group.app, group.windows,
                    count > 1 ? `${name} (${count})` : name);
            }
        } else {
            for (const win of windows) {
                const app = this._tracker.get_window_app(win);
                this._addItem(app, [win], win.get_title() || app?.get_name() || 'Window');
            }
        }
        this._updateFocus();
    }

    _addItem(app, windows, label) {
        const itemWidth = this._getItemWidth();
        const iconSize = this._settings.get_int('icon-size');
        const textSize = this._settings.get_int('text-size');
        const button = new St.Button({
            style_class: 'bottom-window-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            width: itemWidth,
            x_expand: false,
            accessible_name: label,
        });
        const content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        const icon = app?.create_icon_texture(iconSize) ?? new St.Icon({
            icon_name: 'application-x-executable-symbolic',
            icon_size: iconSize,
        });
        content.add_child(icon);
        const title = new St.Label({
            style_class: 'bottom-window-label',
            style: `font-size: ${textSize}pt; width: ${itemWidth - 16}px; max-width: ${itemWidth - 16}px;`,
            text: label,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        title.clutter_text.set_single_line_mode(true);
        title.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        content.add_child(title);
        button.set_child(content);
        button._listedWindows = windows;
        this._connectItem(button, 'clicked', () => this._activateWindows(windows));
        this._items.add_child(button);
        this._connectItem(button, 'button-press-event', (_actor, event) => {
            if (event.get_button() !== 3)
                return Clutter.EVENT_PROPAGATE;
            this._showContextMenu(button, windows);
            return Clutter.EVENT_STOP;
        });

    }


    _maximizeWindow(win) {
        // GNOME 49+ Meta.Window uses is_maximized() and no-argument maximize().
        if (win.is_maximized())
            return;
        if (win.minimized)
            win.unminimize();
        win.maximize();
    }

    _restoreWindow(win) {
        if (win.minimized)
            win.unminimize();
        if (win.is_maximized())
            win.unmaximize();
        // Bring a minimized or maximized window back to the foreground.
        win.activate(global.get_current_time());
    }

    _addWindowActions(targetMenu, win) {
        const actions = [
            ['Minimize', () => win.minimize()],
            ['Maximize', () => this._maximizeWindow(win)],
            ['Restore', () => this._restoreWindow(win)],
            ['Close', () => win.delete(global.get_current_time())],
        ];
        for (const [label, callback] of actions) {
            const item = new PopupMenu.PopupMenuItem(label);
            targetMenu.addMenuItem(item);
            this._connectMenuItem(item, 'activate', () => {
                try {
                    callback();
                } catch (error) {
                    console.error(`Bottom Window Bar: ${label}: ${error}`);
                }
                this._queueRefresh();
            });
            if (label === 'Minimize' && win.minimized)
                item.setSensitive(false);
            if (label === 'Maximize' && win.is_maximized())
                item.setSensitive(false);
            if (label === 'Restore' && !win.minimized && !win.is_maximized())
                item.setSensitive(false);
        }
    }

    _showContextMenu(button, windows) {
        const menu = this._contextMenu;
        if (!menu)
            return;
        menu.close(false);
        this._disconnectMenuItemSignals();
        menu.removeAll();
        // The shared popup follows whichever window button was right-clicked.
        menu.sourceActor = button;
        if (windows.length === 1) {
            this._addWindowActions(menu, windows[0]);
        } else {
            // Grouped items get a submenu per individual window.
            windows.forEach((win, index) => {
                const name = win.get_title() || `Window ${index + 1}`;
                const submenu = new PopupMenu.PopupSubMenuMenuItem(name);
                menu.addMenuItem(submenu);
                this._addWindowActions(submenu.menu, win);
            });
        }
        this._cancelHide();
        this._bar.show();
        menu.open();
    }

    _activateWindows(windows) {
        if (!windows.length)
            return;
        const focused = global.display.focus_window;
        // If the active window belongs to the group, cycle to the next one.
        const index = windows.indexOf(focused);
        const next = index >= 0 && windows.length > 1
            ? windows[(index + 1) % windows.length] : windows[0];
        next.activate(global.get_current_time());
    }

    _updateFocus() {
        if (!this._items)
            return;
        const focused = global.display.focus_window;
        for (const button of this._items.get_children()) {
            if (button._listedWindows?.includes(focused))
                button.add_style_pseudo_class('active');
            else
                button.remove_style_pseudo_class('active');
        }
    }

    disable() {
        // Stop all callbacks before disconnecting or destroying the actors that
        // they reference. Refresh-created signals need explicit cleanup too.
        this._cancelHide();
        if (this._dockCheckId) {
            GLib.source_remove(this._dockCheckId);
            this._dockCheckId = 0;
        }
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }

        this._disconnectItemSignals();
        // Disconnect the open-state callback BEFORE closing: otherwise close()
        // could schedule a fresh auto-hide timeout during disable().
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._contextMenu.close(false);
        this._disconnectMenuItemSignals();
        this._contextMenu.removeAll();
        this._cancelHide();

        for (const [window, ids] of this._windowSignals) {
            for (const id of ids)
                window.disconnect(id);
        }
        this._windowSignals.clear();
        this._windowSignals = null;

        // This is the matching destroy for `this._contextMenu = new ...`
        // in enable(). The shared panel manager belongs to GNOME Shell.
        this._menuManager.removeMenu(this._contextMenu);
        this._contextMenu.destroy();
        this._contextMenu = null;
        this._menuManager = null;

        Main.layoutManager.removeChrome(this._edgeTrigger);
        Main.layoutManager.removeChrome(this._bar);

        // Destroy explicit owned actors as well as their parent bar. Child
        // destruction would cascade, but these calls document ownership.
        this._items.destroy();
        this._scroll.destroy();
        this._edgeTrigger.destroy();
        this._bar.destroy();

        this._items = null;
        this._scroll = null;
        this._edgeTrigger = null;
        this._bar = null;
        this._tracker = null;
        this._barGeometry = null;
        this._chromeUsesStruts = null;
        this._settings = null;
    }
}
