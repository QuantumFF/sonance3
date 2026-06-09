/* ============================================
   Sonance — Settings Screen
   Server info, playback state, logout with confirm
   ============================================ */

var SettingsScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var _container = null;
    var _confirmOverlay = null;
    // V3.8: cached library list (fetched on activate). When _allLibraries has
    // < 2 entries the Libraries section stays unrendered.
    var _allLibraries = null;

    // Background theme presets (REDESIGN). Separate from accent. The preview
    // square uses each theme's --bg-card so the swatch reads as that theme's
    // surface colour. Ids must match App.THEMES.
    var THEME_PRESETS = [
        { id: 'oled',     name: 'OLED Black',    preview: '#1a1a22' },
        { id: 'grey',     name: 'Dark Grey',     preview: '#26262b' },
        { id: 'navy',     name: 'Navy',          preview: '#18223a' },
        { id: 'charcoal', name: 'Charcoal Warm', preview: '#28241f' }
    ];

    // Accent colour presets (P14e)
    var ACCENT_PRESETS = [
        { name: 'Pink',   hex: '#e44d8a', rgb: '228, 77, 138' },
        { name: 'Red',    hex: '#ef4444', rgb: '239, 68, 68'  },
        { name: 'Orange', hex: '#f97316', rgb: '249, 115, 22' },
        { name: 'Amber',  hex: '#f59e0b', rgb: '245, 158, 11' },
        { name: 'Green',  hex: '#22c55e', rgb: '34, 197, 94'  },
        { name: 'Teal',   hex: '#14b8a6', rgb: '20, 184, 166' },
        { name: 'Blue',   hex: '#3b82f6', rgb: '59, 130, 246' },
        { name: 'Purple', hex: '#8b5cf6', rgb: '139, 92, 246' }
    ];

    function render(container) {
        _container = container;

        // P15c: two-column layout — scrollable settings on the left,
        // fixed About card pinned top-right.
        var layout = el('div', { className: 'settings-layout' });
        var leftCol = el('div', { className: 'settings-left', id: 'settings-left' });
        var rightCol = el('div', { className: 'settings-right' });

        var content = leftCol;

        // --- Server Information ---
        var serverSection = el('div', { className: 'settings-section' });
        serverSection.appendChild(el('div', { className: 'settings-section-title' }, 'Server'));

        var creds = AuthManager.getCredentials();
        var serverUrl = creds.serverUrl || 'Not connected';
        var username = creds.username || 'Unknown';

        // Connection status row
        var connRow = el('div', { className: 'settings-info-row' });
        connRow.appendChild(el('span', { className: 'settings-info-label' }, 'Status'));
        var connValue = el('span', { className: 'settings-info-value' });
        var connDot = el('span', { className: 'settings-status-dot' });
        connDot.style.display = 'inline-block';
        connDot.style.marginRight = '8px';
        connDot.style.verticalAlign = 'middle';
        connValue.appendChild(connDot);
        connValue.appendChild(document.createTextNode('Connected'));
        connRow.appendChild(connValue);
        serverSection.appendChild(connRow);

        // Server URL row
        _addInfoRow(serverSection, 'Server URL', serverUrl);
        _addInfoRow(serverSection, 'Username', username);
        _addInfoRow(serverSection, 'API Version', 'Subsonic 1.16.1');

        // Fetch library stats from API
        var api = App.getApi();
        var statsRow = el('div', { className: 'settings-info-row' });
        statsRow.appendChild(el('span', { className: 'settings-info-label' }, 'Library'));
        var statsValue = el('span', { className: 'settings-info-value', id: 'settings-stats' }, 'Loading...');
        statsRow.appendChild(statsValue);
        serverSection.appendChild(statsRow);

        if (api) {
            _fetchLibraryStats(api);
        }

        content.appendChild(serverSection);

        // --- Libraries (V3.8) ---
        // The section node is always created; activate() populates it when
        // the server reports ≥2 libraries and removes it otherwise. Sitting
        // between Server and Appearance keeps the focus zone wiring clean.
        var librariesSection = el('div', {
            className: 'settings-section',
            id: 'settings-libraries-section'
        });
        librariesSection.style.display = 'none';
        content.appendChild(librariesSection);

        // --- Appearance (P14e) — order: Theme → Accent → Reset (REDESIGN) ---
        var appearanceSection = el('div', { className: 'settings-section', id: 'settings-appearance' });
        appearanceSection.appendChild(el('div', { className: 'settings-section-title' }, 'Appearance'));

        // Theme selector (REDESIGN — background themes, separate from accent).
        var themePickerRow = el('div', { className: 'theme-picker-row' });
        themePickerRow.appendChild(el('div', { className: 'accent-picker-label' }, 'Theme'));

        var themeList = el('div', { className: 'theme-list', id: 'settings-theme-list' });
        var currentTheme = App.getTheme();
        THEME_PRESETS.forEach(function(t) {
            var row = el('div', {
                className: 'theme-row focusable' + (t.id === currentTheme ? ' is-selected' : ''),
                'data-theme-id': t.id
            });
            var sw = el('span', { className: 'theme-row-swatch' });
            sw.style.backgroundColor = t.preview;
            row.appendChild(sw);
            row.appendChild(el('span', { className: 'theme-row-name' }, t.name));
            row.appendChild(el('span', { className: 'theme-row-check' }, '✓'));
            row.addEventListener('click', function() {
                _selectTheme(t.id);
            });
            themeList.appendChild(row);
        });
        themePickerRow.appendChild(themeList);
        appearanceSection.appendChild(themePickerRow);

        var pickerRow = el('div', { className: 'accent-picker-row' });
        pickerRow.appendChild(el('div', { className: 'accent-picker-label' }, 'Accent Colour'));

        var swatchRow = el('div', { className: 'accent-swatches' });
        var currentHex = (App.getAccentColor() || '#e44d8a').toLowerCase();

        ACCENT_PRESETS.forEach(function(preset, idx) {
            var swatch = el('button', {
                className: 'accent-swatch focusable',
                id: 'accent-swatch-' + idx,
                title: preset.name
            });
            swatch.style.backgroundColor = preset.hex;
            swatch.setAttribute('aria-label', preset.name);
            swatch.setAttribute('data-hex', preset.hex);
            swatch.setAttribute('data-rgb', preset.rgb);
            if (preset.hex.toLowerCase() === currentHex) {
                swatch.classList.add('selected');
            }
            swatch.addEventListener('click', function() {
                _selectAccent(preset.hex, preset.rgb);
            });
            swatchRow.appendChild(swatch);
        });

        pickerRow.appendChild(swatchRow);

        var resetBtn = el('button', {
            className: 'accent-reset focusable',
            id: 'accent-reset'
        }, 'Reset to default');
        resetBtn.addEventListener('click', function() {
            _resetAccent();
        });
        pickerRow.appendChild(resetBtn);

        appearanceSection.appendChild(pickerRow);
        content.appendChild(appearanceSection);

        // --- Playback (P15b) ---
        var playbackSection = el('div', { className: 'settings-section' });
        playbackSection.appendChild(el('div', { className: 'settings-section-title' }, 'Playback'));

        var autoNpRow = el('div', {
            className: 'settings-toggle-row focusable',
            id: 'settings-auto-np-row'
        });
        autoNpRow.appendChild(el('span', { className: 'settings-toggle-label' }, 'Auto Now Playing'));
        var autoNpValue = el('span', {
            className: 'settings-toggle-value',
            id: 'settings-auto-np-value'
        }, SonanceSettings.autoNowPlaying ? 'On' : 'Off');
        autoNpRow.appendChild(autoNpValue);
        autoNpRow.addEventListener('click', function() {
            _toggleAutoNowPlaying();
        });
        playbackSection.appendChild(autoNpRow);

        playbackSection.appendChild(el('div', {
            className: 'settings-toggle-hint'
        }, 'Automatically open the Now Playing screen when you start a song.'));

        content.appendChild(playbackSection);

        // --- Account ---
        var accountSection = el('div', { className: 'settings-section' });
        accountSection.appendChild(el('div', { className: 'settings-section-title' }, 'Account'));

        var logoutBtn = el('button', {
            className: 'settings-logout-btn focusable',
            id: 'settings-logout-btn'
        }, 'Logout');
        logoutBtn.addEventListener('click', function() {
            _showLogoutConfirm();
        });
        accountSection.appendChild(logoutBtn);

        accountSection.appendChild(el('div', {
            className: 'settings-logout-hint'
        }, 'This will clear your saved credentials and return to the login screen.'));

        content.appendChild(accountSection);

        // --- About (right column, pinned top-right) ---
        var aboutBox = el('div', { className: 'settings-about' });
        aboutBox.appendChild(el('div', { className: 'settings-about-title' }, 'Sonance'));
        aboutBox.appendChild(el('div', { className: 'settings-about-subtitle' }, 'By Simmo'));

        aboutBox.appendChild(el('div', { className: 'settings-about-row' }, 'V3.8'));

        var platformValue = Player.IS_TIZEN ? 'Tizen 5.0' : 'Browser';
        aboutBox.appendChild(el('div', { className: 'settings-about-row' }, 'Platform: ' + platformValue));

        rightCol.appendChild(aboutBox);

        layout.appendChild(leftCol);
        layout.appendChild(rightCol);
        container.appendChild(layout);
        log('Settings', 'Settings screen rendered');
    }

    function _scrollFocusedIntoView(element) {
        if (!element) return;
        var container = document.getElementById('settings-left');
        if (!container) return;
        var elTop = element.offsetTop;
        var elBottom = elTop + element.offsetHeight;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + container.clientHeight;
        if (elBottom > viewBottom) {
            container.scrollTop = elBottom - container.clientHeight + 20;
        } else if (elTop < viewTop) {
            container.scrollTop = elTop - 20;
        }
    }

    function _updateSelectedSwatch(hex) {
        var normalized = (hex || '').toLowerCase();
        var swatches = document.querySelectorAll('.accent-swatch');
        for (var i = 0; i < swatches.length; i++) {
            var sw = swatches[i];
            var swHex = (sw.getAttribute('data-hex') || '').toLowerCase();
            if (swHex === normalized) {
                sw.classList.add('selected');
            } else {
                sw.classList.remove('selected');
            }
        }
    }

    function _updateSelectedThemeRow(themeId) {
        var rows = document.querySelectorAll('#settings-theme-list .theme-row');
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (row.getAttribute('data-theme-id') === themeId) {
                row.classList.add('is-selected');
            } else {
                row.classList.remove('is-selected');
            }
        }
    }

    function _selectTheme(themeId) {
        App.saveTheme(themeId);
        _updateSelectedThemeRow(themeId);
        App.showToast('Theme updated');
        log('Settings', 'Theme set to ' + themeId);
    }

    function _selectAccent(hex, rgb) {
        App.saveAccentColor(hex, rgb);
        _updateSelectedSwatch(hex);
        App.showToast('Accent colour updated');
        log('Settings', 'Accent set to ' + hex);
    }

    function _resetAccent() {
        App.resetAccentColor();
        _updateSelectedSwatch(App.DEFAULT_ACCENT_HEX);
        App.showToast('Accent colour reset');
        log('Settings', 'Accent reset to default');
    }

    function _toggleAutoNowPlaying() {
        SonanceSettings.autoNowPlaying = !SonanceSettings.autoNowPlaying;
        localStorage.setItem('sonance-auto-now-playing', SonanceSettings.autoNowPlaying.toString());
        var valEl = document.getElementById('settings-auto-np-value');
        if (valEl) {
            valEl.textContent = SonanceSettings.autoNowPlaying ? 'On' : 'Off';
        }
        log('Settings', 'Auto Now Playing: ' + SonanceSettings.autoNowPlaying);
    }

    function _addInfoRow(parent, label, value) {
        var row = el('div', { className: 'settings-info-row' });
        row.appendChild(el('span', { className: 'settings-info-label' }, label));
        row.appendChild(el('span', { className: 'settings-info-value' }, value));
        parent.appendChild(row);
    }

    function _fetchLibraryStats(api) {
        // Fetch album count, artist count, and use getRandomSongs count as a rough song indicator
        var albumP = api.getAlbumList2('newest', 1);
        var artistP = api.getArtists();

        Promise.all([albumP, artistP]).then(function(results) {
            var statsEl = document.getElementById('settings-stats');
            if (!statsEl) return;

            var artistCount = (results[1] && results[1].length) || 0;
            var parts = [];
            parts.push(artistCount + ' artists');
            statsEl.textContent = parts.join(' \u00B7 ');
        }).catch(function() {
            var statsEl = document.getElementById('settings-stats');
            if (statsEl) statsEl.textContent = 'Unable to load';
        });
    }

    function _showLogoutConfirm() {
        if (_confirmOverlay) return; // Already showing

        _confirmOverlay = el('div', { className: 'settings-confirm-overlay', id: 'logout-confirm' });

        var dialog = el('div', { className: 'settings-confirm-dialog' });
        dialog.appendChild(el('div', { className: 'settings-confirm-title' }, 'Log Out?'));
        dialog.appendChild(el('div', { className: 'settings-confirm-message' },
            'Are you sure you want to log out? You will need to re-enter your server credentials.'));

        var buttons = el('div', { className: 'settings-confirm-buttons' });

        var cancelBtn = el('button', { className: 'settings-confirm-cancel focusable', id: 'confirm-cancel' }, 'Cancel');
        cancelBtn.addEventListener('click', function() {
            _hideLogoutConfirm();
        });
        buttons.appendChild(cancelBtn);

        var logoutBtn = el('button', { className: 'settings-confirm-logout focusable', id: 'confirm-logout' }, 'Log Out');
        logoutBtn.addEventListener('click', function() {
            _hideLogoutConfirm();
            log('Settings', 'Logout confirmed');
            Player.pause();
            AuthManager.logout();
            App.showLogin();
        });
        buttons.appendChild(logoutBtn);

        dialog.appendChild(buttons);
        _confirmOverlay.appendChild(dialog);
        document.body.appendChild(_confirmOverlay);

        // Register confirm dialog focus zone
        FocusManager.registerZone('confirm-dialog', {
            selector: '#logout-confirm .focusable',
            columns: 2,
            onActivate: function(idx, element) {
                element.click();
            },
            neighbors: {} // No zone transitions — modal is isolated
        });
        FocusManager.setActiveZone('confirm-dialog', 0);

        log('Settings', 'Logout confirm dialog shown');
    }

    function _hideLogoutConfirm() {
        if (_confirmOverlay && _confirmOverlay.parentNode) {
            _confirmOverlay.parentNode.removeChild(_confirmOverlay);
        }
        _confirmOverlay = null;
        FocusManager.unregisterZone('confirm-dialog');
        FocusManager.setActiveZone('content', 0);
    }

    function activate(params) {
        _registerStaticZones();

        // V3.8: fetch the library list and conditionally render the
        // Libraries section. If the server reports <2 libraries, the
        // section is hidden and the rest of the screen behaves as v3.7.
        var api = App.getApi();
        if (!api) return;
        api.getMusicFolders().then(function(folders) {
            _allLibraries = folders || [];
            if (_allLibraries.length < 2) {
                _hideLibrariesSection();
                return;
            }
            _renderLibrariesSection(_allLibraries);
        }).catch(function(err) {
            log('Settings', 'getMusicFolders failed: ' + (err && err.message));
            _hideLibrariesSection();
        });
    }

    // V3.8: register the focus zones that don't depend on the libraries list.
    // Called on every activate so wiring stays consistent across re-entries
    // (the libraries zone is registered separately by _renderLibrariesSection
    // when the server has multiple libraries).
    function _registerStaticZones() {
        var hasLibraries = _allLibraries && _allLibraries.length >= 2;

        // REDESIGN: navigation runs top-to-bottom matching the DOM order:
        //   Theme rows  →  Accent swatches  →  Actions (reset / auto-NP / logout)
        // The Theme list is the 'content' entry zone, so Down from the top nav
        // lands on it (the topmost Appearance control). Up from Theme reaches
        // the Libraries section when present.

        // Theme rows (vertical list of 4).
        FocusManager.registerZone('content', {
            selector: '#settings-theme-list .theme-row.focusable',
            columns: 1,
            onActivate: function(index, element) {
                if (element && element.click) element.click();
            },
            onFocus: function(idx, element) { _scrollFocusedIntoView(element); },
            neighbors: {
                left: 'topnav',
                up: hasLibraries ? 'settings-libraries' : 'topnav',
                down: 'settings-accent'
            }
        });

        // Accent swatches (horizontal row of 8).
        FocusManager.registerZone('settings-accent', {
            selector: '#settings-appearance .accent-swatch.focusable',
            columns: 8,
            onActivate: function(index, element) {
                if (element && element.click) element.click();
            },
            onFocus: function(idx, element) { _scrollFocusedIntoView(element); },
            neighbors: {
                left: 'topnav',
                up: 'content',
                down: 'settings-actions'
            }
        });

        // Actions zone: reset link + toggle rows + logout button. Excludes the
        // accent swatches, library rows and theme rows (each their own zone).
        // V3.8-fix: the selector was '#content-area …' but no element has that
        // id (the page layer is #page-current); scope it to #settings-left.
        FocusManager.registerZone('settings-actions', {
            selector: '#settings-left .focusable:not(.accent-swatch):not(.settings-library-row):not(.theme-row)',
            columns: 1,
            onActivate: function(index, element) {
                if (element && element.click) {
                    element.click();
                }
            },
            onKey: function(direction) {
                // Left/Right on the Auto Now Playing row toggles its value
                // instead of transitioning zones.
                if (direction !== 'left' && direction !== 'right') return false;
                var focused = FocusManager.getCurrentFocused();
                if (focused && focused.id === 'settings-auto-np-row') {
                    _toggleAutoNowPlaying();
                    return true;
                }
                return false;
            },
            onFocus: function(idx, element) { _scrollFocusedIntoView(element); },
            neighbors: {
                left: 'topnav',
                up: 'settings-accent',
                down: 'nowplaying-bar'
            }
        });
    }

    // =========================================
    //  Libraries section (V3.8)
    // =========================================

    function _hideLibrariesSection() {
        var section = document.getElementById('settings-libraries-section');
        if (section) {
            section.textContent = '';
            section.style.display = 'none';
        }
        FocusManager.unregisterZone('settings-libraries');
        // Re-run static zones so neighbour wiring drops the libraries zone.
        _registerStaticZones();
    }

    function _renderLibrariesSection(libraries) {
        var section = document.getElementById('settings-libraries-section');
        if (!section) return;
        section.textContent = '';
        section.style.display = '';

        section.appendChild(el('div', { className: 'settings-section-title' }, 'Libraries'));

        var selected = AuthManager.getSelectedLibraries();
        var checkedSet = _buildCheckedSet(libraries, selected);

        var rowsWrap = el('div', { className: 'settings-libraries-list', id: 'settings-libraries-list' });

        libraries.forEach(function(lib) {
            var libId = String(lib.id);
            var isChecked = !!checkedSet[libId];
            var row = el('div', {
                className: 'settings-library-row focusable' + (isChecked ? ' is-checked' : ''),
                'data-library-id': libId
            });

            row.appendChild(el('div', { className: 'settings-library-checkbox' }));
            row.appendChild(el('div', { className: 'settings-library-name' }, lib.name || libId));

            row.addEventListener('click', function() {
                _onLibraryRowClicked(libId);
            });

            rowsWrap.appendChild(row);
        });

        section.appendChild(rowsWrap);

        section.appendChild(el('div', { className: 'settings-libraries-hint' },
            'Changing your library selection will clear cached data and your current play queue.'));

        _refreshLockState();

        // Register focus zone for the rows. Up returns to top nav; Down goes
        // into the accent swatches ('content'); Left returns to top nav.
        FocusManager.registerZone('settings-libraries', {
            selector: '#settings-libraries-list .focusable',
            columns: 1,
            onActivate: function(idx, element) {
                if (element && element.click) {
                    element.click();
                }
            },
            onFocus: function(idx, element) { _scrollFocusedIntoView(element); },
            neighbors: {
                left: 'topnav',
                up: 'topnav',
                down: 'content'
            }
        });

        // Re-run static zones so 'content' wiring picks up the libraries zone.
        _registerStaticZones();
    }

    // V3.8: build a lookup of currently-checked library ids. When the
    // persisted selection is null/empty (= "all"), every library is checked.
    function _buildCheckedSet(libraries, selected) {
        var map = {};
        if (!selected || !selected.length) {
            libraries.forEach(function(lib) { map[String(lib.id)] = true; });
            return map;
        }
        for (var i = 0; i < selected.length; i++) map[String(selected[i])] = true;
        return map;
    }

    // V3.8: lock the only-remaining-checked row so it can't be toggled off.
    // Called after every render and after every successful toggle so the
    // visual state matches the click-handler's early-return rule.
    function _refreshLockState() {
        var rows = document.querySelectorAll('#settings-libraries-list .settings-library-row');
        var checkedRows = [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].classList.contains('is-checked')) checkedRows.push(rows[i]);
        }
        for (var j = 0; j < rows.length; j++) {
            rows[j].classList.remove('is-locked');
        }
        if (checkedRows.length === 1) {
            checkedRows[0].classList.add('is-locked');
        }
    }

    function _onLibraryRowClicked(libraryId) {
        var rows = document.querySelectorAll('#settings-libraries-list .settings-library-row');
        var clickedRow = null;
        var checkedIds = [];
        for (var i = 0; i < rows.length; i++) {
            var rid = rows[i].getAttribute('data-library-id');
            if (rid === libraryId) clickedRow = rows[i];
            if (rows[i].classList.contains('is-checked')) checkedIds.push(rid);
        }
        if (!clickedRow) return;

        var wasChecked = clickedRow.classList.contains('is-checked');
        // Lock-last-checked: refuse to drop the selection to zero.
        if (wasChecked && checkedIds.length === 1) {
            return;
        }

        // Compute the candidate set.
        var candidate = [];
        if (wasChecked) {
            for (var k = 0; k < checkedIds.length; k++) {
                if (checkedIds[k] !== libraryId) candidate.push(checkedIds[k]);
            }
        } else {
            candidate = checkedIds.slice();
            candidate.push(libraryId);
        }

        // Normalise to either null (all) or an array.
        var allIds = [];
        if (_allLibraries) {
            for (var m = 0; m < _allLibraries.length; m++) allIds.push(String(_allLibraries[m].id));
        }
        var normalised = SubsonicAPI._normaliseLibraryIds(candidate, allIds);

        log('Settings', 'Library toggled: ' + libraryId + ' → ' +
            (normalised ? normalised.join(',') : 'all'));

        App.applyLibraryChange(normalised);

        // V3.8-fix2: applyLibraryChange no longer navigates away; update
        // the row's checked state in-place and refresh the lock visual.
        clickedRow.classList.toggle('is-checked');
        _refreshLockState();
    }

    function deactivate() {
        _hideLogoutConfirm();
        _container = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
