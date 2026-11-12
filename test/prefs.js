import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class BottomWindowBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._bottomWindowSettings = settings;

        const page = new Adw.PreferencesPage({
            title: 'Window Bar',
            icon_name: 'view-list-symbolic',
        });
        window.add(page);

        const appearance = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Customize the bottom window bar.',
        });
        page.add(appearance);

        const color = new Adw.EntryRow({
            title: 'Background color (hex)',
            text: settings.get_string('background-color'),
        });
        appearance.add(color);
        color.connect('changed', () => {
            const value = color.get_text().trim();
            if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) {
                settings.set_string('background-color', value);
                color.remove_css_class('error');
            } else {
                color.add_css_class('error');
            }
        });

        const sizes = new Adw.PreferencesGroup({
            title: 'Window item sizes',
            description: 'Use compact icons and titles to fit more windows on the bar.',
        });
        page.add(sizes);

        const addIntegerRow = (container, key, title, subtitle, min, max, step) => {
            const row = new Adw.ActionRow({title, subtitle});
            const adjustment = new Gtk.Adjustment({
                lower: min, upper: max, step_increment: step,
                page_increment: step * 2, value: settings.get_int(key),
            });
            const spinner = new Gtk.SpinButton({adjustment, numeric: true, digits: 0});
            spinner.set_valign(Gtk.Align.CENTER);
            row.add_suffix(spinner);
            row.set_activatable_widget(spinner);
            container.add(row);
            spinner.connect('value-changed', () => {
                settings.set_int(key, spinner.get_value_as_int());
            });
            settings.connect(`changed::${key}`, () => {
                const value = settings.get_int(key);
                if (spinner.get_value_as_int() !== value)
                    spinner.set_value(value);
            });
        };

        addIntegerRow(sizes, 'icon-size', 'Icon size (pixels)',
            'Size of each application icon.', 12, 64, 1);
        addIntegerRow(sizes, 'text-size', 'Window title size (points)',
            'Font size of the title below each icon.', 7, 20, 1);

        const dock = new Adw.PreferencesGroup({
            title: 'Side dock clearance',
            description: 'Automatically reserve the detected width of a left or right dock; manual values are optional minimum overrides.',
        });
        page.add(dock);
        const detectDock = new Adw.SwitchRow({
            title: 'Automatically detect side-dock width',
            subtitle: 'Enabled by default. Uses the full dock width when available.',
        });
        dock.add(detectDock);
        settings.bind('auto-dock-clearance', detectDock, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        addIntegerRow(dock, 'left-clearance', 'Extra left clearance (pixels)',
            'Minimum left clearance if automatic detection is insufficient.', 0, 400, 4);
        addIntegerRow(dock, 'right-clearance', 'Extra right clearance (pixels)',
            'Minimum right clearance if automatic detection is insufficient.', 0, 400, 4);

        const bottom = new Adw.PreferencesGroup({
            title: 'Bottom scrollbar clearance',
            description: 'Lift the window bar above the bottom edge so it does not cover scrollbars.',
        });
        page.add(bottom);
        addIntegerRow(bottom, 'bottom-offset', 'Bottom offset (pixels)',
            'Distance between the bottom of the window bar and the bottom of the monitor.',
            0, 120, 1);


        const group = new Adw.PreferencesGroup({
            title: 'Window behavior',
        });
        page.add(group);

        const grouping = new Adw.SwitchRow({
            title: 'Group by application',
            subtitle: 'Combine multiple windows from the same application into one button.',
        });
        group.add(grouping);
        settings.bind('group-windows', grouping, 'active', Gio.SettingsBindFlags.DEFAULT);

        const workspaces = new Adw.SwitchRow({
            title: 'Show windows from all workspaces',
            subtitle: 'Otherwise show only windows from the current workspace.',
        });
        group.add(workspaces);
        settings.bind('all-workspaces', workspaces, 'active', Gio.SettingsBindFlags.DEFAULT);

        const autoHide = new Adw.SwitchRow({
            title: 'Automatically hide the bottom bar',
            subtitle: 'Reveal the bar by moving the pointer to the bottom edge of the primary monitor.',
        });
        group.add(autoHide);
        settings.bind('auto-hide', autoHide, 'active', Gio.SettingsBindFlags.DEFAULT);

        const visible = new Adw.SwitchRow({
            title: 'Show bottom bar',
            subtitle: 'Turn off to pause and hide the bar without uninstalling the extension.',
        });
        group.add(visible);
        settings.bind('show-bar', visible, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}
