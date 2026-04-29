/* ============================================
   Sonance — App Shell, Router & Screen Manager
   ============================================ */

// =========================================
//  SonanceSettings — persisted user preferences
// =========================================
var SonanceSettings = {
    // Auto-open Now Playing screen when user starts playback. Default ON.
    autoNowPlaying: localStorage.getItem('sonance-auto-now-playing') !== 'false'
};

var App = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var $ = SonanceUtils.$;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    // S-wave logo SVG — enlarged paths (P4.3: fill 70-80% of viewBox)
    function _createLogoSvg() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        var paths = [
            { d: 'M15.5,4 A7,7 0 0,0 8.5,9', sw: '2.4', o: '0.95' },
            { d: 'M8.5,9 A7,7 0 0,1 15.5,14', sw: '2.4', o: '0.95' },
            { d: 'M15.5,14 A7,7 0 0,0 8.5,19', sw: '2.4', o: '0.2' },
            { d: 'M18,5 Q20.5,7.5 18,10', sw: '1.6', o: '0.5' },
            { d: 'M20,3.5 Q23.5,7.5 20,11.5', sw: '1.3', o: '0.3' },
            { d: 'M6,10 Q3.5,12 6,14', sw: '1.6', o: '0.5' },
            { d: 'M4,8.5 Q0.5,12 4,15.5', sw: '1.3', o: '0.3' }
        ];
        paths.forEach(function(p) {
            var path = document.createElementNS(ns, 'path');
            path.setAttribute('d', p.d);
            path.setAttribute('stroke', 'white');
            path.setAttribute('stroke-width', p.sw);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('opacity', p.o);
            svg.appendChild(path);
        });
        return svg;
    }

    // --- Toast system ---
    var _toastEl = null;
    var _toastTimer = null;

    function showToast(message, duration) {
        duration = duration || 2000;
        if (_toastEl && _toastEl.parentNode) {
            _toastEl.parentNode.removeChild(_toastEl);
        }
        if (_toastTimer) {
            clearTimeout(_toastTimer);
            _toastTimer = null;
        }
        _toastEl = el('div', { className: 'sonance-toast' }, message);
        document.body.appendChild(_toastEl);
        // Force reflow then show
        _toastEl.offsetHeight;
        _toastEl.classList.add('visible');
        _toastTimer = setTimeout(function() {
            if (_toastEl) _toastEl.classList.remove('visible');
            setTimeout(function() {
                if (_toastEl && _toastEl.parentNode) {
                    _toastEl.parentNode.removeChild(_toastEl);
                }
                _toastEl = null;
            }, 300);
        }, duration);
    }

    // --- Colour hint bar ---
    var _hintBar = null;

    function _buildColourHintBar() {
        _hintBar = el('div', { className: 'colour-hint-bar', id: 'colour-hint-bar' });
        return _hintBar;
    }

    function showColourHints(hints) {
        // hints: array of { colour: 'yellow'|'blue'|'red'|'green', label: 'Add to queue' }
        if (!_hintBar) return;
        _hintBar.textContent = '';
        if (!hints || hints.length === 0) {
            _hintBar.classList.remove('visible');
            return;
        }
        hints.forEach(function(hint) {
            var item = el('div', { className: 'colour-hint-item' });
            item.appendChild(el('span', { className: 'colour-hint-dot ' + hint.colour }));
            item.appendChild(el('span', { className: 'colour-hint-label' }, hint.label));
            _hintBar.appendChild(item);
        });
        _hintBar.classList.add('visible');
    }

    function hideColourHints() {
        if (!_hintBar) return;
        _hintBar.classList.remove('visible');
    }

    // --- State ---
    var _appContainer = null;
    var _contentArea = null;      // Alias for the page-current layer (back-compat)
    var _pageCurrent = null;      // The live page layer (screens render into this)
    var _topNavEl = null;         // #top-nav
    var _topNavPillEl = null;     // #top-nav-pill
    var _navItemElements = [];    // .top-nav-item DOM nodes
    var _navIndex = 0;            // Current focused/selected nav index
    var _pillState = 'focused';   // 'focused' | 'selected'
    // V3.7-fix8: cached nav-item rects to avoid getBoundingClientRect on every focus change
    var _navItemRects = null;     // Array of { left, width } per nav item, or null when stale
    var _navBarLeft = 0;          // Cached top-nav-bar getBoundingClientRect().left
    var _navResizeTimer = null;   // Debounce timer for window resize re-measure
    var _navResizeBound = false;  // Resize listener bound flag
    var _currentScreen = null;    // screen name string
    var _historyStack = [];       // [{ screen, params }]

    // V3-2: lock to stop rapid Enter/Back presses from overlapping transitions.
    // navigateTo / goBack / the login zoom check this before starting work.
    var _transitioning = false;
    var TRANSITION_LOCK_MS = 300;

    // V3-5 fix: when the user flicks Left/Right across the top nav faster than
    // the transition lock (e.g. NP → Home in 4 presses), the lock swallows the
    // later navigateTo calls. The pill follows focus but the page doesn't
    // change. Track the last desired target so we can catch up once the lock
    // releases.
    var _pendingNavTarget = null;

    // V3-6-fix NAV-1: snapshot map keyed by `_focusKeyForScreen()`. Library
    // grid focus is saved on Enter; album-tracks focus is saved on Enter.
    // Back from a sub-screen (or NP) tries to restore the matching snapshot
    // so the user lands on the row/tile they came from instead of being
    // bounced back to the top nav.
    var _savedFocus = {};

    function _beginTransition() {
        if (_transitioning) return false;
        _transitioning = true;
        setTimeout(function() {
            _transitioning = false;
            // If the user moved the nav focus during the lock and the current
            // screen doesn't match what they ended up on, navigate now.
            if (_pendingNavTarget && _pendingNavTarget !== _currentScreen) {
                var target = _pendingNavTarget;
                _pendingNavTarget = null;
                var targetIdx = _navIndexForScreen(target);
                var currentIdx = _navIndexForScreen(_currentScreen);
                var slideDir = (targetIdx >= 0 && currentIdx >= 0 && targetIdx > currentIdx)
                    ? 'slide-left' : 'slide-right';
                navigateTo(target, null, slideDir);
            } else {
                _pendingNavTarget = null;
            }
        }, TRANSITION_LOCK_MS);
        return true;
    }

    // Map legacy 'left' / 'right' third-arg values to the new transition names.
    function _normaliseTransition(t) {
        if (t === 'left') return 'slide-left';
        if (t === 'right') return 'slide-right';
        return t || null;
    }

    // --- Screen Registry ---
    var _screens = {
        home: HomeScreen,
        library: LibraryScreen,
        search: SearchScreen,
        playlists: PlaylistsScreen,
        nowplaying: NowPlayingScreen,
        queue: QueueScreen,
        settings: SettingsScreen,
        album: AlbumScreen,
        artist: ArtistScreen
    };

    var _screenTitles = {
        home: 'Home',
        library: 'Library',
        search: 'Search',
        playlists: 'Playlists',
        nowplaying: 'Now Playing',
        queue: 'Queue',
        settings: 'Settings',
        album: 'Album',
        artist: 'Artist'
    };

    // v3 top nav order: Home | Library | Playlists | Queue | Now Playing | Search | Settings
    var NAV_ITEMS = [
        { id: 'home',       label: 'Home',        type: 'text' },
        { id: 'library',    label: 'Library',     type: 'text' },
        { id: 'playlists',  label: 'Playlists',   type: 'text' },
        { id: 'queue',      label: 'Queue',       type: 'text' },
        { id: 'nowplaying', label: 'Now Playing', type: 'text' },
        { id: 'search',     label: null,          type: 'icon', icon: 'search' },
        { id: 'settings',   label: null,          type: 'icon', icon: 'settings' }
    ];

    // Primary nav screen ids (flat, no drill-down). Sub-screens (album, artist) push onto history.
    var _navScreens = ['home', 'library', 'playlists', 'queue', 'nowplaying', 'search', 'settings'];

    function _navIndexForScreen(screenName) {
        for (var i = 0; i < NAV_ITEMS.length; i++) {
            if (NAV_ITEMS[i].id === screenName) return i;
        }
        return -1;
    }

    // =========================================
    //  Tizen Media Key Registration
    // =========================================

    function registerTizenKeys() {
        if (typeof tizen === 'undefined' || !tizen.tvinputdevice) {
            log('App', 'Not on Tizen — skipping key registration');
            return;
        }
        var keys = [
            'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
            'MediaFastForward', 'MediaRewind', 'MediaTrackPrevious', 'MediaTrackNext',
            'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'
        ];
        keys.forEach(function(key) {
            try {
                tizen.tvinputdevice.registerKey(key);
            } catch (e) {
                console.warn('[Sonance][App] Failed to register key: ' + key, e);
            }
        });
        log('App', 'Registered ' + keys.length + ' media/colour keys');
    }

    // =========================================
    //  Accent Colour (P14e)
    // =========================================

    var DEFAULT_ACCENT_HEX = '#e44d8a';
    var DEFAULT_ACCENT_RGB = '228, 77, 138';

    function applyAccentColor(hex, rgb) {
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-rgb', rgb);
        document.documentElement.style.setProperty('--accent-glow', 'rgba(' + rgb + ', 0.35)');
        document.documentElement.style.setProperty('--accent-soft', 'rgba(' + rgb + ', 0.15)');
    }

    function resetAccentColor() {
        try {
            localStorage.removeItem('sonance-accent-color');
            localStorage.removeItem('sonance-accent-rgb');
        } catch (e) {}
        applyAccentColor(DEFAULT_ACCENT_HEX, DEFAULT_ACCENT_RGB);
    }

    function loadAccentColor() {
        try {
            var savedHex = localStorage.getItem('sonance-accent-color');
            var savedRgb = localStorage.getItem('sonance-accent-rgb');
            if (savedHex && savedRgb) {
                applyAccentColor(savedHex, savedRgb);
            }
        } catch (e) {
            log('App', 'Failed to load accent color: ' + e.message);
        }
    }

    function saveAccentColor(hex, rgb) {
        try {
            localStorage.setItem('sonance-accent-color', hex);
            localStorage.setItem('sonance-accent-rgb', rgb);
        } catch (e) {
            log('App', 'Failed to save accent color: ' + e.message);
        }
        applyAccentColor(hex, rgb);
    }

    function getAccentColor() {
        var v = getComputedStyle(document.documentElement).getPropertyValue('--accent');
        return (v && v.trim()) || DEFAULT_ACCENT_HEX;
    }

    function getAccentRgb() {
        var v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb');
        return (v && v.trim()) || DEFAULT_ACCENT_RGB;
    }

    // Apply saved accent immediately so nothing paints with stale pink
    loadAccentColor();

    // =========================================
    //  Init
    // =========================================

    function init() {
        log('App', 'Sonance starting...');

        _appContainer = document.getElementById('app');

        // Re-apply saved accent (belt-and-braces in case <html> was replaced)
        loadAccentColor();

        // Initialize subsystems
        FocusManager.init();
        Player.init();
        if (typeof LazyLoader !== 'undefined') LazyLoader.init();

        // Check auth state
        if (AuthManager.isLoggedIn()) {
            log('App', 'Existing session found, validating...');
            _validateAndShowApp();
        } else {
            log('App', 'No session, showing login');
            _showLogin();
        }
    }

    // =========================================
    //  Login / Auth
    // =========================================

    function _showLogin() {
        _appContainer.textContent = '';
        _currentScreen = null;
        _historyStack = [];
        _topNavEl = null;
        _topNavPillEl = null;
        _navItemElements = [];
        _navItemRects = null;
        _pageCurrent = null;
        _contentArea = null;
        // V3.7-fix18: clear the per-screen preload completion gate so a
        // different user (or a fresh login) starts with cold caches.
        _preloadDone = {};

        // Reset FocusManager — clear all zones
        FocusManager.clearContentZones();
        FocusManager.unregisterZone('topnav');
        FocusManager.unregisterZone('nowplaying-bar');

        LoginScreen.render(_appContainer, function() {
            // V3-2: zoom the login screen forward, then swap to the app shell
            // which zooms the home screen in behind it.
            _loginToAppShellZoom();
        });
        LoginScreen.activate();
    }

    // V3-2: login-success zoom. The login card scales up (as if diving through
    // it) while fading out, then we tear it down and bring up the app shell
    // with the home screen scaling from 0.95 to 1.
    function _loginToAppShellZoom() {
        if (!_beginTransition()) return;

        var loginEl = document.querySelector('.login-screen');
        if (!loginEl) {
            _showAppShell(true);
            return;
        }

        loginEl.style.willChange = 'transform, opacity';
        loginEl.style.transition = 'transform 0.4s ease, opacity 0.3s ease';
        loginEl.style.transform = 'scale(1.15)';
        loginEl.style.opacity = '0';

        setTimeout(function() {
            _showAppShell(true);
        }, 350);
    }

    function _validateAndShowApp() {
        var api = AuthManager.getApi();
        if (!api) {
            _showLogin();
            return;
        }

        api.ping().then(function() {
            log('App', 'Session valid');
            _showAppShell();
        }).catch(function(err) {
            log('App', 'Session validation failed: ' + err.message);
            _showLogin();
        });
    }

    // =========================================
    //  App Shell
    // =========================================

    function _showAppShell(entryZoom) {
        _appContainer.textContent = '';
        _historyStack = [];

        var layout = el('div', { className: 'app-layout' });

        // Top navigation bar (floating)
        layout.appendChild(_buildTopNav());

        // Page container with live page layer
        var pageContainer = el('div', { id: 'page-container' });
        _pageCurrent = el('div', { id: 'page-current', className: 'page-layer content-area' });
        pageContainer.appendChild(_pageCurrent);
        // Keep content-area alias for existing code that reads #content-area
        _pageCurrent.setAttribute('data-content-area', '1');
        _contentArea = _pageCurrent;
        layout.appendChild(pageContainer);

        // Colour hint bar + NP bar are fixed-position (CSS handles it)
        layout.appendChild(_buildColourHintBar());
        layout.appendChild(_buildNowPlayingBar());

        _appContainer.appendChild(layout);

        // Register persistent focus zones
        _registerTopNavZone();
        _registerNowPlayingBarZone();

        // Auto-open Now Playing when user initiates playback (P15b)
        Player.on('userplay', function() {
            if (SonanceSettings.autoNowPlaying && _currentScreen !== 'nowplaying') {
                navigateTo('nowplaying');
            }
        });

        // Navigate to home screen
        navigateTo('home');

        // V3-2 login zoom entry: page layer scales up from 0.95 to 1 to mirror
        // the outgoing login scaling past 1.
        if (entryZoom && _pageCurrent) {
            _pageCurrent.style.transition = 'none';
            _pageCurrent.style.transform = 'scale(0.95)';
            _pageCurrent.style.opacity = '0';
            _pageCurrent.style.willChange = 'transform, opacity';
            void _pageCurrent.offsetHeight;
            _pageCurrent.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            _pageCurrent.style.transform = 'scale(1)';
            _pageCurrent.style.opacity = '1';
            setTimeout(function() {
                if (_pageCurrent) {
                    _pageCurrent.style.transition = '';
                    _pageCurrent.style.transform = '';
                    _pageCurrent.style.opacity = '';
                    _pageCurrent.style.willChange = '';
                }
            }, 320);
        }

        // Set initial focus to top nav
        FocusManager.setActiveZone('topnav', 0);
        _setPillState('focused');

        // Register Samsung remote media/colour keys (no-op in browser)
        registerTizenKeys();

        // Load starred (favourites) cache in the background
        var api = AuthManager.getApi();
        if (api && typeof StarredCache !== 'undefined') {
            StarredCache.load(api).catch(function(err) {
                log('App', 'StarredCache load failed: ' + (err && err.message));
            });
        }

        log('App', 'App shell rendered');
    }

    // =========================================
    //  Top Nav Builder (v3)
    // =========================================

    function _createSearchIcon() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', '11');
        circle.setAttribute('cy', '11');
        circle.setAttribute('r', '7');
        circle.setAttribute('stroke', 'currentColor');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
        var line = document.createElementNS(ns, 'path');
        line.setAttribute('d', 'M16.5 16.5L21 21');
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
        return svg;
    }

    function _createSettingsIcon() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '3');
        circle.setAttribute('stroke', 'currentColor');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        return svg;
    }

    function _buildTopNav() {
        var topNav = el('div', { id: 'top-nav' });
        var bar = el('div', { id: 'top-nav-bar' });
        var pill = el('div', { id: 'top-nav-pill' });
        bar.appendChild(pill);

        var items = el('div', { className: 'top-nav-items' });
        _navItemElements = [];
        // V3.7-fix8: invalidate rect cache; will be measured after layout below.
        _navItemRects = null;

        NAV_ITEMS.forEach(function(spec, i) {
            var item = el('div', {
                className: 'top-nav-item',
                'data-screen': spec.id
            });
            if (spec.type === 'icon') {
                var icon;
                if (spec.icon === 'search') icon = _createSearchIcon();
                else if (spec.icon === 'settings') icon = _createSettingsIcon();
                if (icon) item.appendChild(icon);
            } else {
                item.appendChild(document.createTextNode(spec.label));
            }

            item.addEventListener('click', function() {
                var oldIdx = _navIndex;
                _navIndex = i;
                FocusManager.setActiveZone('topnav', i);
                _setPillState('focused');
                _updateNavItemClasses();
                _updatePillPosition(i, oldIdx !== i);
                if (_currentScreen !== spec.id) {
                    var dir = i > oldIdx ? 'left' : 'right';
                    navigateTo(spec.id, null, dir);
                }
            });

            _navItemElements.push(item);
            items.appendChild(item);
        });

        bar.appendChild(items);
        topNav.appendChild(bar);
        _topNavEl = topNav;
        _topNavPillEl = pill;

        // Position the pill once the items are on the DOM (deferred).
        // V3.7-fix8: also (re-)measure rects after layout settles.
        setTimeout(function() {
            _measureNavRects();
            _updatePillPosition(_navIndex, false);
        }, 0);

        // V3.7-fix8: bind a debounced resize listener once to invalidate +
        // re-measure cached rects when the viewport changes (browser only).
        if (!_navResizeBound) {
            _navResizeBound = true;
            window.addEventListener('resize', function() {
                if (_navResizeTimer) clearTimeout(_navResizeTimer);
                _navResizeTimer = setTimeout(function() {
                    _navResizeTimer = null;
                    _measureNavRects();
                    _updatePillPosition(_navIndex, false);
                }, 120);
            });
        }

        return topNav;
    }

    // V3.7-fix8: measure nav item rects once after render / on resize so that
    // _updatePillPosition() can avoid getBoundingClientRect() on every focus
    // change. Falls back to nulling the cache if the bar isn't yet rendered.
    function _measureNavRects() {
        var bar = document.getElementById('top-nav-bar');
        if (!bar || !_navItemElements.length) {
            _navItemRects = null;
            return;
        }
        var barRect = bar.getBoundingClientRect();
        _navBarLeft = barRect.left;
        var rects = [];
        var anyZero = false;
        for (var i = 0; i < _navItemElements.length; i++) {
            var r = _navItemElements[i].getBoundingClientRect();
            if (r.width === 0) anyZero = true;
            rects.push({ left: r.left, width: r.width });
        }
        // If layout isn't ready (any zero-width item), keep cache stale so the
        // next call retries; do not memoise broken values.
        _navItemRects = anyZero ? null : rects;
    }

    function _updatePillPosition(itemIndex, animate) {
        if (!_topNavPillEl) return;
        var item = _navItemElements[itemIndex];
        if (!item) return;
        // V3.7-fix8: lazy-measure if cache is stale (first paint or post-resize
        // before timer fires).
        if (!_navItemRects || !_navItemRects[itemIndex]) {
            _measureNavRects();
        }
        if (!_navItemRects || !_navItemRects[itemIndex] || _navItemRects[itemIndex].width === 0) {
            // Not yet laid out (hidden or mid-transition); retry on next frame —
            // but only if the caller's index is still the current nav index.
            setTimeout(function() {
                if (_navIndex === itemIndex) _updatePillPosition(itemIndex, animate);
            }, 16);
            return;
        }
        var rect = _navItemRects[itemIndex];
        var itemWidth = rect.width;
        // Item's actual rendered left offset relative to the bar — includes any
        // margin/padding that offsetLeft would miss in certain layouts.
        var itemLeft = rect.left - _navBarLeft;
        // GPU-only: translateX positions the pill, scaleX stretches its fixed
        // 100px base to match the target item's width. transform-origin:left
        // keeps the left edge anchored to itemLeft.
        var scaleX = itemWidth / 100;
        if (animate) {
            _topNavPillEl.style.transition = 'transform 0.25s ease';
        } else {
            _topNavPillEl.style.transition = 'none';
        }
        _topNavPillEl.style.transform = 'translateX(' + itemLeft + 'px) scaleX(' + scaleX + ')';
    }

    function _setPillState(state) {
        _pillState = state;
        if (!_topNavPillEl) return;
        _topNavPillEl.classList.remove('focused', 'selected');
        _topNavPillEl.classList.add(state);
    }

    function _updateNavItemClasses() {
        _navItemElements.forEach(function(el, i) {
            el.classList.toggle('focused', i === _navIndex && _pillState === 'focused');
            el.classList.toggle('selected', i === _navIndex);
        });
    }

    function setNavBarVisible(visible) {
        if (_topNavEl) {
            _topNavEl.style.display = visible ? '' : 'none';
        }
        // Note: page-container `.no-nav` (fullbleed top:0) is managed separately
        // per-screen via _setPageFullbleed() — decoupled so the nav can float
        // over a fullbleed screen (Now Playing) while staying visible.
    }

    function _setPageFullbleed(fullbleed) {
        var container = document.getElementById('page-container');
        if (!container) return;
        if (fullbleed) container.classList.add('no-nav');
        else container.classList.remove('no-nav');
    }

    // --- Now Playing auto-hide nav timer ---
    var _navAutoHideTimer = null;
    var NAV_AUTO_HIDE_MS = 5000;

    function _isNavBarVisible() {
        return !!(_topNavEl && _topNavEl.style.display !== 'none');
    }

    function _scheduleNavAutoHide() {
        _cancelNavAutoHide();
        _navAutoHideTimer = setTimeout(function() {
            _navAutoHideTimer = null;
            if (_currentScreen !== 'nowplaying') return;
            if (!_isNavBarVisible()) return;
            setNavBarVisible(false);
            _setPillState('selected');
            _updateNavItemClasses();
            // If the user is still on the nav bar when the timer fires,
            // drop focus into NP content (same behaviour as pressing Down).
            if (FocusManager.getActiveZone() === 'topnav') {
                var zone = _getPageFirstZone();
                if (zone) FocusManager.setActiveZone(zone, undefined, true);
            }
        }, NAV_AUTO_HIDE_MS);
    }

    function _cancelNavAutoHide() {
        if (_navAutoHideTimer) {
            clearTimeout(_navAutoHideTimer);
            _navAutoHideTimer = null;
        }
    }

    function _setNpBarCollapsed(collapsed) {
        var container = document.getElementById('page-container');
        if (!container) return;
        if (collapsed) container.classList.add('no-np-bar');
        else container.classList.remove('no-np-bar');
    }

    function _getPageFirstZone() {
        // Zones that screens register (in priority order).
        // V3-6-fix NAV-3: library-grid is preferred over library-subnav so
        // Down from the top nav lands on the first grid tile, not the side
        // sub-nav. The sub-nav is reachable via Left from the grid.
        // V3-6-fix3 NAV-1: 'queue-list' is preferred over 'queue-card' so
        // Down from the topnav lands on the first queue row when there are
        // items; 'queue-card' is the empty-queue fallback.
        var candidates = ['content', 'library-grid', 'library-subnav', 'queue-list', 'queue-card', 'search-results', 'album-tracks', 'np-controls'];
        for (var i = 0; i < candidates.length; i++) {
            if (FocusManager.hasZone(candidates[i])) return candidates[i];
        }
        return null;
    }

    // =========================================
    //  Now Playing Bar (Live)
    // =========================================

    // References for live updates
    var _npBarArt = null;
    var _npBarTitle = null;
    var _npBarArtist = null;
    var _npBarMiniProgress = null;
    var _npBarPlayBtn = null;

    function _buildNowPlayingBar() {
        var npBar = el('div', { className: 'now-playing-bar', id: 'now-playing-bar' });

        // Initial state — no track, bar hidden. updateNpBarVisibility will
        // adjust once playback starts or the user navigates.
        npBar.style.opacity = '0';
        npBar.style.pointerEvents = 'none';

        // Mini progress line at top (GPU-safe scaleX)
        _npBarMiniProgress = el('div', { className: 'mini-progress' });
        _npBarMiniProgress.style.setProperty('--progress', '0');
        npBar.appendChild(_npBarMiniProgress);

        // Left: album art + track info (clickable to open Now Playing screen)
        var npLeft = el('div', { className: 'now-playing-bar-left' });
        npLeft.style.cursor = 'pointer';
        npLeft.addEventListener('click', function() {
            if (Player.getState().currentTrack) {
                navigateTo('nowplaying');
            }
        });

        _npBarArt = el('div', { className: 'now-playing-bar-art' });
        npLeft.appendChild(_npBarArt);

        var npInfo = el('div', { className: 'now-playing-bar-info' });
        _npBarTitle = el('div', { className: 'now-playing-bar-title' }, 'No track playing');
        _npBarArtist = el('div', { className: 'now-playing-bar-artist' }, 'Select a song to begin');
        npInfo.appendChild(_npBarTitle);
        npInfo.appendChild(_npBarArtist);
        npLeft.appendChild(npInfo);
        npBar.appendChild(npLeft);

        // Centre: transport controls
        var npCenter = el('div', { className: 'now-playing-bar-center' });

        var prevBtn = el('button', { className: 'np-bar-btn' });
        var prevSvg = createSvg(SVG_PATHS.skipPrev);
        prevSvg.style.width = '20px';
        prevSvg.style.height = '20px';
        prevSvg.style.fill = 'currentColor';
        prevBtn.appendChild(prevSvg);
        prevBtn.addEventListener('click', function() { Player.previous(); });
        npCenter.appendChild(prevBtn);

        _npBarPlayBtn = el('button', { className: 'play-btn-main np-bar-btn' });
        var playSvg = createSvg(SVG_PATHS.play);
        playSvg.style.width = '18px';
        playSvg.style.height = '18px';
        _npBarPlayBtn.appendChild(playSvg);
        _npBarPlayBtn.addEventListener('click', function() { Player.togglePlayPause(); });
        npCenter.appendChild(_npBarPlayBtn);

        var nextBtn = el('button', { className: 'np-bar-btn' });
        var nextSvg = createSvg(SVG_PATHS.skipNext);
        nextSvg.style.width = '20px';
        nextSvg.style.height = '20px';
        nextSvg.style.fill = 'currentColor';
        nextBtn.appendChild(nextSvg);
        nextBtn.addEventListener('click', function() { Player.next(); });
        npCenter.appendChild(nextBtn);

        npBar.appendChild(npCenter);

        // Subscribe to player events
        _subscribeNowPlayingBar();

        return npBar;
    }

    // V3-5: preload the NP-sized cover art the moment the track changes.
    // When the user later opens the Now Playing screen the image comes from
    // the browser HTTP cache, so it renders in one frame rather than painting
    // in horizontal bands as the network bytes arrive.
    // V3-6: warm ImageCache for the screen the user is sliding toward, so
    // album art is already decoded by the time the transition lands.
    // Throttled to once per (screen, second) to avoid hammering the API
    // when the user flicks across the nav bar.
    // V3.7-fix18: 5-minute completion gate. The inner getAlbumList2 calls
    // already go through SubsonicAPI._cachedRequest (which has an in-memory
    // map and a localStorage TTL after fix6), so the gate prevents redundant
    // ImageCache.preload churn within the cache TTL window. Reset on logout
    // (see _showLogin) so a different user starts fresh.
    var _preloadDone = {};
    var PRELOAD_GATE_MS = 5 * 60 * 1000;
    function _preloadScreenImages(screenId) {
        var now = Date.now();
        var last = _preloadDone[screenId] || 0;
        if (now - last < PRELOAD_GATE_MS) return;

        var api = AuthManager.getApi();
        if (!api) return;

        if (screenId === 'home') {
            api.getAlbumList2('newest', 12, 0).then(function(albums) {
                var ids = [];
                for (var i = 0; i < albums.length; i++) {
                    if (albums[i].coverArt) ids.push(albums[i].coverArt);
                }
                ImageCache.preload(ids, 300);
                _preloadDone[screenId] = Date.now();
            }).catch(function() {});
        } else if (screenId === 'library') {
            api.getAlbumList2('alphabeticalByName', 24, 0).then(function(albums) {
                var ids = [];
                for (var i = 0; i < albums.length; i++) {
                    if (albums[i].coverArt) ids.push(albums[i].coverArt);
                }
                ImageCache.preload(ids, 300);
                _preloadDone[screenId] = Date.now();
            }).catch(function() {});
        }
    }

    function _preloadNpArt(track) {
        if (!track) return;
        var coverId = track.coverArt || track.albumId;
        if (!coverId) return;
        // Route through ImageCache so the NP screen and bg blur both reuse
        // the same in-memory entries on subsequent visits.
        ImageCache.get(coverId, 600, null);
        ImageCache.get(coverId, 100, null);
    }

    function _subscribeNowPlayingBar() {
        Player.on('trackchange', function(track) {
            _preloadNpArt(track);
            _updateNpBarTrack(track);
            _updateNpBarVisibility();
        });

        Player.on('progress', function(data) {
            if (_npBarMiniProgress && data.duration > 0) {
                var ratio = data.currentTime / data.duration;
                _npBarMiniProgress.style.setProperty('--progress', ratio.toString());
            }
        });

        Player.on('play', function() {
            _updateNpBarPlayIcon(true);
            _updateNpBarVisibility();
        });

        Player.on('pause', function() {
            _updateNpBarPlayIcon(false);
        });
    }

    // Show the NP bar only when a track is loaded AND the user is not on the
    // Now Playing screen (which replaces the bar). Opacity transition is
    // GPU-composited; page-container bottom snaps instantly via `no-np-bar`.
    function _updateNpBarVisibility() {
        var bar = document.getElementById('now-playing-bar');
        if (!bar) return;

        var state = Player.getState();
        var hasTrack = !!(state && state.currentTrack);
        var onNpScreen = _currentScreen === 'nowplaying';
        var shouldShow = hasTrack && !onNpScreen;

        if (shouldShow) {
            bar.style.display = '';
            bar.style.opacity = '1';
            bar.style.pointerEvents = 'auto';
            _setNpBarCollapsed(false);
        } else {
            bar.style.opacity = '0';
            bar.style.pointerEvents = 'none';
            _setNpBarCollapsed(true);
        }
    }

    function _updateNpBarTrack(track) {
        if (!track) return;
        if (_npBarTitle) _npBarTitle.textContent = track.title || 'Unknown';
        if (_npBarArtist) {
            var parts = [];
            if (track.artist) parts.push(track.artist);
            if (track.album) parts.push(track.album);
            _npBarArtist.textContent = parts.join(' \u2014 ') || 'Unknown';
        }

        // Update album art (always visible — no lazy load, but cache-routed)
        if (_npBarArt) {
            _npBarArt.textContent = '';
            var api = AuthManager.getApi();
            var coverId = track.coverArt || track.albumId;
            if (api && coverId) {
                var img = document.createElement('img');
                img.className = 'lazy-art loaded';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.onerror = function() {
                    if (img.parentNode) img.parentNode.removeChild(img);
                };
                img.src = ImageCache.getUrl(coverId, 100);
                _npBarArt.appendChild(img);
            }
        }

        // Reset progress
        if (_npBarMiniProgress) _npBarMiniProgress.style.setProperty('--progress', '0');
    }

    function _updateNpBarPlayIcon(isPlaying) {
        if (!_npBarPlayBtn) return;
        _npBarPlayBtn.textContent = '';
        var icon = createSvg(isPlaying ? SVG_PATHS.pause : SVG_PATHS.play);
        icon.style.width = '18px';
        icon.style.height = '18px';
        _npBarPlayBtn.appendChild(icon);
    }

    // =========================================
    //  Focus Zone Registration
    // =========================================

    function _registerTopNavZone() {
        FocusManager.registerZone('topnav', {
            selector: '.top-nav-item',
            columns: NAV_ITEMS.length,
            defaultIndex: 0,
            onFocus: function(index) {
                _navIndex = index;
                // Returning to the nav from content — show focused (accent) pill.
                _setPillState('focused');
                _updateNavItemClasses();
                _updatePillPosition(index, true);
                // V3-6: warm ImageCache for the nav item under focus so the
                // images are already in memory when the slide transition
                // completes.
                _preloadScreenImages(NAV_ITEMS[index].id);
                // On NP, returning focus to the nav (via Up) re-shows the bar
                // and restarts the 5s auto-hide timer.
                if (_currentScreen === 'nowplaying') {
                    setNavBarVisible(true);
                    _scheduleNavAutoHide();
                }
            },
            onActivate: function(index) {
                // Enter — navigate to the activated nav item if it's not the
                // current screen, then drop focus into page content. Without
                // this, pressing Enter on (e.g.) Home from the NP screen would
                // just re-enter NP's content — the user expects it to switch
                // screens like Left/Right does, but immediately enter content.
                _cancelNavAutoHide();

                var targetScreen = NAV_ITEMS[index].id;
                if (_currentScreen !== targetScreen) {
                    var oldIdx = _navIndex;
                    _navIndex = index;
                    var slideDir = index > oldIdx ? 'left' : 'right';
                    _pendingNavTarget = targetScreen;
                    navigateTo(targetScreen, null, slideDir);
                }

                // After navigation, _currentScreen is the target. If we just
                // left NP, hide the NP-only nav-bar overlay.
                if (_currentScreen === 'nowplaying') setNavBarVisible(false);

                var zone = _getPageFirstZone();
                if (zone) {
                    _setPillState('selected');
                    _updateNavItemClasses();
                    FocusManager.setActiveZone(zone, undefined, true);
                }
            },
            onKey: function(direction) {
                if (direction === 'down') {
                    // V3.7-fix29 Bug 4: don't cancel the NP auto-hide here
                    // and don't yank the bar invisible. Let the existing
                    // 5 s timer run so the user sees the pill state
                    // transition from 'focused' to 'selected' before the
                    // bar fades out. On non-NP screens the nav bar is
                    // always visible, so cancelling the timer is a no-op
                    // there but keeps explicit semantics.
                    if (_currentScreen !== 'nowplaying') _cancelNavAutoHide();
                    var zone = _getPageFirstZone();
                    if (zone) {
                        _setPillState('selected');
                        _updateNavItemClasses();
                        FocusManager.setActiveZone(zone, undefined, true);
                    }
                    return true;
                }
                if (direction === 'left' || direction === 'right') {
                    // User is actively browsing — restart the auto-hide timer on NP.
                    if (_currentScreen === 'nowplaying') _scheduleNavAutoHide();
                    var len = NAV_ITEMS.length;
                    var newIndex = direction === 'right'
                        ? (_navIndex + 1) % len
                        : (_navIndex - 1 + len) % len;
                    // Update focus — onFocus will update pill + classes
                    FocusManager.setActiveZone('topnav', newIndex);
                    _setPillState('focused');
                    _updateNavItemClasses();
                    // Navigate page content with matching slide direction
                    var slideDir = direction === 'right' ? 'left' : 'right';
                    var target = NAV_ITEMS[newIndex].id;
                    if (_currentScreen !== target) {
                        // Always record desired target so _beginTransition can
                        // catch up if this call is swallowed by the lock.
                        _pendingNavTarget = target;
                        navigateTo(target, null, slideDir);
                    }
                    return true;
                }
                return false;
            },
            neighbors: {}
        });
    }

    function _registerNowPlayingBarZone() {
        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'topnav'
            }
        });
    }

    // =========================================
    //  Screen Router
    // =========================================

    /**
     * Navigate to a screen by name.
     * Primary nav screens replace the history stack; sub-screens push to it.
     * `transition` may be:
     *   'slide-left' | 'slide-right' — top-nav left/right slide
     *   'zoom-in' | 'zoom-out'       — sub-page zoom (Enter / Back)
     *   'left' | 'right'             — legacy aliases for slide-*
     *   null                         — snap (no animation)
     */
    function navigateTo(screenName, params, transition) {
        var screen = _screens[screenName];
        if (!screen) {
            log('App', 'Unknown screen: ' + screenName);
            return;
        }

        transition = _normaliseTransition(transition);

        // Lock against rapid double-presses. Only animated transitions take the
        // lock — snap navigations (null transition, e.g. initial home load) run
        // through without gating, which keeps boot-time nav unaffected.
        if (transition && !_beginTransition()) return;

        _navigateToScreen(screenName, params, transition);

        // History management
        var isPrimary = _navScreens.indexOf(screenName) >= 0;
        if (isPrimary) {
            if (screenName === 'nowplaying') {
                // NP is a temporary view — push instead of replace so Back
                // returns to the screen the user came from. Guard against
                // double-push when NP is already on top (e.g. NP bar click
                // while already on NP).
                if (_historyStack.length === 0
                    || _historyStack[_historyStack.length - 1].screen !== 'nowplaying') {
                    _historyStack.push({ screen: 'nowplaying', params: params });
                }
            } else {
                // Primary nav: replace stack (nav navigation is flat)
                _historyStack = [{ screen: screenName, params: params }];
            }
        } else {
            // Sub-screen: push to stack (drill-down)
            _historyStack.push({ screen: screenName, params: params });
        }
    }

    // =========================================
    //  Focus snapshot/restore (V3-6-fix NAV-1)
    // =========================================

    function _focusKeyForScreen(screenName) {
        if (!screenName) return null;
        // Library is sub-tabbed — key the snapshot to the active tab so
        // switching tabs after a drill-down doesn't cross-pollute focus.
        if (screenName === 'library' &&
            typeof LibraryScreen !== 'undefined' &&
            typeof LibraryScreen.getActiveTab === 'function') {
            return 'library:' + LibraryScreen.getActiveTab();
        }
        return screenName;
    }

    function saveCurrentFocus() {
        var key = _focusKeyForScreen(_currentScreen);
        if (!key) return;
        var snap = FocusManager.snapshot();
        if (!snap || !snap.zone) return;
        // Only save content focus — never the top nav or NP bar.
        if (snap.zone === 'topnav' || snap.zone === 'nowplaying-bar') return;
        _savedFocus[key] = snap;
    }

    /**
     * Try to restore the saved focus for the screen we just navigated TO.
     * Returns true if the snapshot existed and we either restored it
     * synchronously or scheduled an async retry; in both cases the caller
     * should NOT fall back to forcing the top nav. Returns false when no
     * snapshot is available — caller should apply default focus behaviour.
     */
    function _tryRestoreFocusForCurrentScreen() {
        var key = _focusKeyForScreen(_currentScreen);
        if (!key) return false;
        var snap = _savedFocus[key];
        if (!snap) return false;

        // Sync attempt — succeeds when the destination's content zones are
        // already registered (e.g. fast LAN, cached data).
        if (FocusManager.restore(snap)) {
            delete _savedFocus[key];
            _setPillState('selected');
            _updateNavItemClasses();
            return true;
        }

        // V3.7-fix17: replace the 50ms × 20 polling loop with a one-shot
        // observer fired by FocusManager.registerZone. A 2s safety timeout
        // drops the snapshot quietly if the zone never registers.
        var fired = false;
        var safety = setTimeout(function() {
            if (fired) return;
            fired = true;
            log('App', 'Focus restore: zone "' + snap.zone + '" never registered; dropping snapshot');
            delete _savedFocus[key];
        }, 2000);
        FocusManager.onceZoneRegistered(snap.zone, function() {
            if (fired) return;
            fired = true;
            clearTimeout(safety);
            if (FocusManager.restore(snap)) {
                delete _savedFocus[key];
                _setPillState('selected');
                _updateNavItemClasses();
            } else {
                delete _savedFocus[key];
            }
        });
        return true;
    }

    /**
     * Go back — navigation stack handler.
     *
     * Priority of actions:
     *   1. If the exit dialog is open, dismiss it.
     *   2. If on Now Playing, pop NP from the stack and return to the previous
     *      screen. NP is a temporary view — Back always leaves it regardless
     *      of which focus zone the user was in.
     *   3. If on a sub-screen (history length > 1), zoom back to the parent.
     *   4. If focus is in page content on a primary screen, return it to the
     *      top nav.
     *   5. At the root with focus on the top nav, show the exit dialog.
     */
    function goBack() {
        // 1. Exit dialog dismiss
        if (_exitDialogOpen) {
            _dismissExitDialog();
            return;
        }

        // 1b. Give the current screen a chance to handle Back itself — used by
        // screens that have in-screen detail modes (e.g. Library genre songs,
        // Playlists detail) where the back motion is within the screen, not a
        // navigation-stack pop.
        var current = _currentScreen && _screens[_currentScreen];
        if (current && typeof current.handleBack === 'function') {
            try {
                if (current.handleBack()) return;
            } catch (e) {
                log('App', 'handleBack threw: ' + e.message);
            }
        }

        // 2. Now Playing → pop and return to previous screen
        if (_currentScreen === 'nowplaying') {
            if (!_beginTransition()) return;
            _cancelNavAutoHide();
            setNavBarVisible(true);

            var npIdx = _navIndexForScreen('nowplaying');

            if (_historyStack.length > 1) {
                // Remove NP from the stack
                _historyStack.pop();
                var prev = _historyStack[_historyStack.length - 1];

                // Find nearest primary nav screen in the remaining stack to
                // position the pill (prev may be a sub-screen like album).
                var prevPrimaryIdx = -1;
                for (var i = _historyStack.length - 1; i >= 0; i--) {
                    var idx = _navIndexForScreen(_historyStack[i].screen);
                    if (idx >= 0) { prevPrimaryIdx = idx; break; }
                }

                // Slide in from whichever side matches the pill-restore motion
                var slideDir = null;
                if (prevPrimaryIdx >= 0 && npIdx >= 0) {
                    slideDir = prevPrimaryIdx < npIdx ? 'right' : 'left';
                }

                _navigateToScreen(prev.screen, prev.params, slideDir);

                // If prev is a sub-screen, _navigateToScreen doesn't move the
                // pill — do it here so it ends up on the correct primary.
                var prevIsPrimary = _navIndexForScreen(prev.screen) >= 0;
                if (!prevIsPrimary && prevPrimaryIdx >= 0) {
                    _navIndex = prevPrimaryIdx;
                    _updatePillPosition(prevPrimaryIdx, true);
                }
            } else {
                // NP was the only entry on the stack (auto-NP on app start).
                // Go to Home.
                _historyStack = [{ screen: 'home', params: null }];
                _navigateToScreen('home', null, 'right');
            }

            // V3-6-fix NAV-1: try to restore the saved focus first; only
            // fall through to forcing the top nav if no snapshot is queued.
            if (!_tryRestoreFocusForCurrentScreen()) {
                FocusManager.setActiveZone('topnav', _navIndex, true);
                _setPillState('focused');
                _updateNavItemClasses();
            }
            return;
        }

        // 3. Sub-screen → zoom out to parent (V3-2)
        if (_historyStack.length > 1) {
            if (!_beginTransition()) return;
            _historyStack.pop();
            var prev = _historyStack[_historyStack.length - 1];
            _navigateToScreen(prev.screen, prev.params, 'zoom-out');
            // V3-6-fix NAV-1: prefer restoring the parent's saved focus
            // (e.g. the library tile the user came from) over bouncing the
            // user back up to the top nav.
            if (!_tryRestoreFocusForCurrentScreen()) {
                FocusManager.setActiveZone('topnav', _navIndex, true);
                _setPillState('focused');
                _updateNavItemClasses();
            }
            return;
        }

        // 4. Primary screen with focus in page content → return to top nav
        var activeZone = FocusManager.getActiveZone();
        if (activeZone && activeZone !== 'topnav' && activeZone !== 'nowplaying-bar') {
            FocusManager.setActiveZone('topnav', _navIndex, true);
            _setPillState('focused');
            _updateNavItemClasses();
            return;
        }

        // 5. At root primary with focus on top nav → exit dialog
        _showExitDialog();
    }

    // --- Exit Dialogue (P5.2) ---
    var _exitDialogOpen = false;
    var _exitOverlay = null;
    var _exitPreviousZone = null;

    function _showExitDialog() {
        if (_exitDialogOpen) return;
        _exitDialogOpen = true;

        // Remember current zone to restore on cancel
        _exitPreviousZone = FocusManager.getActiveZone();

        // Build overlay
        _exitOverlay = el('div', { className: 'exit-overlay' });
        var card = el('div', { className: 'exit-card' });
        card.appendChild(el('div', { className: 'exit-card-title' }, 'Exit Sonance?'));
        card.appendChild(el('div', { className: 'exit-card-subtitle' }, 'Are you sure you want to exit?'));

        var buttons = el('div', { className: 'exit-card-buttons' });
        var cancelBtn = el('button', { className: 'exit-btn exit-btn-cancel focusable', id: 'exit-cancel' }, 'Cancel');
        var exitBtn = el('button', { className: 'exit-btn exit-btn-exit focusable', id: 'exit-confirm' }, 'Exit');
        buttons.appendChild(cancelBtn);
        buttons.appendChild(exitBtn);
        card.appendChild(buttons);
        _exitOverlay.appendChild(card);

        // Append to #app (so position: absolute works relative to app)
        _appContainer.appendChild(_exitOverlay);

        // Register isolated focus zone for the dialog
        FocusManager.registerZone('exit-dialog', {
            selector: '.exit-card-buttons .focusable',
            columns: 2,
            onActivate: function(idx) {
                if (idx === 0) {
                    // Cancel
                    _dismissExitDialog();
                } else {
                    // Exit
                    _exitApp();
                }
            },
            neighbors: {}
        });
        // force=true so the topnav-protection in FocusManager doesn't swallow
        // this call when Back was pressed while focused on the nav bar.
        FocusManager.setActiveZone('exit-dialog', 0, true);
    }

    function _dismissExitDialog() {
        if (!_exitDialogOpen) return;
        _exitDialogOpen = false;

        if (_exitOverlay && _exitOverlay.parentNode) {
            _exitOverlay.parentNode.removeChild(_exitOverlay);
        }
        _exitOverlay = null;

        FocusManager.unregisterZone('exit-dialog');

        // Restore previous focus zone (force: we're explicitly restoring).
        if (_exitPreviousZone && FocusManager.hasZone(_exitPreviousZone)) {
            FocusManager.setActiveZone(_exitPreviousZone, undefined, true);
        } else {
            FocusManager.setActiveZone('topnav', _navIndex, true);
            _setPillState('focused');
            _updateNavItemClasses();
        }
        _exitPreviousZone = null;
    }

    function _exitApp() {
        // Tizen exit
        if (typeof tizen !== 'undefined' && tizen.application) {
            try {
                tizen.application.getCurrentApplication().exit();
            } catch (e) {
                log('App', 'Tizen exit failed: ' + e.message);
            }
        } else {
            // Browser fallback
            window.close();
            // If window.close() doesn't work (common in browser), dismiss and show toast
            _dismissExitDialog();
            showToast('Close this tab to exit');
        }
    }

    /**
     * Slide-in animation: new page enters from one side, ghost of the old page
     * exits to the other. Matches v2 behaviour.
     */
    function _applySlideTransition(transition, ghost) {
        var slideOut = transition === 'slide-left' ? -60 : 60;
        var slideIn  = transition === 'slide-left' ?  60 : -60;

        _pageCurrent.style.transition = 'none';
        _pageCurrent.style.transform = 'translateX(' + slideIn + 'px)';
        _pageCurrent.style.opacity = '0';
        _pageCurrent.style.willChange = 'transform, opacity';

        if (ghost) {
            ghost.style.transition = 'none';
            ghost.style.transform = 'translateX(0)';
            ghost.style.opacity = '1';
        }

        void _pageCurrent.offsetHeight;

        _pageCurrent.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        _pageCurrent.style.transform = 'translateX(0)';
        _pageCurrent.style.opacity = '1';

        if (ghost) {
            ghost.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
            ghost.style.transform = 'translateX(' + slideOut + 'px)';
            ghost.style.opacity = '0';
            setTimeout(function() {
                if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
            }, 250);
        }

        setTimeout(function() {
            if (_pageCurrent) {
                _pageCurrent.style.transition = '';
                _pageCurrent.style.transform = '';
                _pageCurrent.style.opacity = '';
                _pageCurrent.style.willChange = '';
            }
        }, 260);
    }

    /**
     * Zoom animation (V3-2):
     *   direction === 'in'  — outgoing scales UP from 1 -> 1.08 and fades out;
     *                          incoming scales from 0.92 -> 1 and fades in.
     *   direction === 'out' — outgoing scales DOWN from 1 -> 0.92 and fades
     *                          out; incoming scales from 1.08 -> 1 and fades in.
     * Only `transform` and `opacity` are touched — GPU-composited, required
     * by the Tizen 5.0 Chromium target.
     */
    function _applyZoomTransition(direction, ghost) {
        var incomingFromScale = direction === 'in' ? 0.92 : 1.08;
        var outgoingToScale   = direction === 'in' ? 1.08 : 0.92;

        // Incoming page: start scaled, transparent, no transition
        _pageCurrent.style.transition = 'none';
        _pageCurrent.style.transform = 'scale(' + incomingFromScale + ')';
        _pageCurrent.style.opacity = '0';
        _pageCurrent.style.willChange = 'transform, opacity';

        // Ghost (outgoing): neutral start, then animates out
        if (ghost) {
            ghost.style.transition = 'none';
            ghost.style.transform = 'scale(1)';
            ghost.style.opacity = '1';
            ghost.style.willChange = 'transform, opacity';
        }

        // Commit initial styles
        void _pageCurrent.offsetHeight;

        // Incoming animates to neutral
        _pageCurrent.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        _pageCurrent.style.transform = 'scale(1)';
        _pageCurrent.style.opacity = '1';

        // Ghost fades/scales out. Slightly faster opacity so the outgoing page
        // clears before the incoming settles (matches the spec's 0.2s opacity
        // window vs 0.25s transform).
        if (ghost) {
            var ghostDuration = direction === 'in' ? '0.25s' : '0.2s';
            ghost.style.transition = 'transform ' + ghostDuration + ' ease, opacity 0.2s ease';
            ghost.style.transform = 'scale(' + outgoingToScale + ')';
            ghost.style.opacity = '0';
            setTimeout(function() {
                if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
            }, 280);
        }

        setTimeout(function() {
            if (_pageCurrent) {
                _pageCurrent.style.transition = '';
                _pageCurrent.style.transform = '';
                _pageCurrent.style.opacity = '';
                _pageCurrent.style.willChange = '';
            }
        }, 290);
    }

    /**
     * Internal: perform the actual screen transition.
     * `transition`:
     *   'slide-left'  — new page enters from right
     *   'slide-right' — new page enters from left
     *   'zoom-in'     — current scales up & fades, new scales from 0.92 to 1
     *   'zoom-out'    — current scales down & fades, new scales from 1.08 to 1
     *   null          — no animation
     */
    function _navigateToScreen(screenName, params, transition) {
        var screen = _screens[screenName];
        if (!screen) return;
        transition = _normaliseTransition(transition);

        var previousScreen = _currentScreen;

        // Deactivate current screen
        if (_currentScreen && _screens[_currentScreen]) {
            _screens[_currentScreen].deactivate();
        }

        // Preserve whether focus is in the top nav — screens' activate() calls
        // setActiveZone('content') which would steal focus from the nav bar.
        var wasInTopNav = FocusManager.getActiveZone() === 'topnav';

        // Clear content focus zones
        FocusManager.clearContentZones();

        // Hide colour hints on screen change
        hideColourHints();

        // Visibility adjustments for NP and login-like screens. Class state
        // for the live layer is applied AFTER the detach-and-reuse swap below
        // (V3.7-fix7), so it lands on the new layer rather than the ghost.
        var hintBar = document.getElementById('colour-hint-bar');
        if (screenName === 'nowplaying') {
            if (hintBar) hintBar.style.display = 'none';
            _setPageFullbleed(true);
            setNavBarVisible(true);
            _cancelNavAutoHide();
            setTimeout(function() {
                if (_currentScreen === 'nowplaying' && _isNavBarVisible()) {
                    _scheduleNavAutoHide();
                }
            }, 300);
        } else {
            if (previousScreen === 'nowplaying' && hintBar) {
                hintBar.style.display = '';
            }
            _setPageFullbleed(false);
            setNavBarVisible(true);
            _cancelNavAutoHide();
        }

        // V3.7-fix7: detach-and-reuse instead of cloneNode. Demote the live
        // layer to a ghost (rename id, replace class with the page-ghost
        // marker) and create a fresh empty layer to be the new live layer.
        // No DOM is duplicated, no <img> nodes are re-decoded.
        var ghost = null;
        if (transition && _pageCurrent.firstChild) {
            var oldPage = _pageCurrent;
            var pageParent = oldPage.parentNode;

            oldPage.id = '';
            oldPage.removeAttribute('data-content-area');
            oldPage.className = 'page-ghost';

            var newPage = document.createElement('div');
            newPage.id = 'page-current';
            newPage.className = 'page-layer content-area';
            newPage.setAttribute('data-content-area', '1');
            pageParent.appendChild(newPage);

            _pageCurrent = newPage;
            _contentArea = newPage;
            ghost = oldPage;
        } else {
            // First render or no animation — reuse the existing layer. Strip
            // previous screen-specific classes since we're not creating a
            // fresh layer that would start clean.
            _pageCurrent.textContent = '';
            _pageCurrent.classList.remove('np-active', 'fullbleed', 'album-active');
        }

        // Apply screen-specific classes to the (new) live layer.
        if (screenName === 'nowplaying') {
            _pageCurrent.classList.add('np-active', 'fullbleed');
        }

        screen.render(_pageCurrent);

        // Update state
        _currentScreen = screenName;

        // NP bar shows only when a track is loaded and we're off the NP screen.
        _updateNpBarVisibility();

        // Activate new screen (registers focus zones, fetches data, etc.)
        screen.activate(params);

        // Update top-nav selected/focused indicator
        _updateTopNavForScreen(screenName);

        // Dispatch animation based on transition type. All animations touch ONLY
        // `transform` + `opacity` so the Tizen GPU composites them cleanly.
        if (transition === 'slide-left' || transition === 'slide-right') {
            _applySlideTransition(transition, ghost);
        } else if (transition === 'zoom-in') {
            _applyZoomTransition('in', ghost);
        } else if (transition === 'zoom-out') {
            _applyZoomTransition('out', ghost);
        }

        // If the user was in the top nav when they triggered this navigation,
        // keep them in the top nav — don't let the screen's activate() steal focus.
        if (wasInTopNav) {
            FocusManager.setActiveZone('topnav', _navIndex);
            _setPillState('focused');
            _updateNavItemClasses();
        } else if (!FocusManager.getActiveZone()) {
            // V3-6-fix NAV-1: when a snapshot is queued for this screen the
            // goBack path will restore focus (sync or async). Don't grab
            // the first zone in the meantime — otherwise library-subnav
            // briefly flashes into the focused (accent) state during the
            // async retry window.
            var pendingKey = _focusKeyForScreen(screenName);
            var hasPendingRestore = pendingKey && !!_savedFocus[pendingKey];
            if (!hasPendingRestore) {
                var first = _getPageFirstZone();
                if (first) FocusManager.setActiveZone(first, 0);
            }
        }

        log('App', 'Navigated to: ' + screenName);
    }

    /**
     * Update top nav focus/pill to match the current primary screen.
     */
    function _updateTopNavForScreen(screenName) {
        var navIdx = -1;
        for (var i = 0; i < NAV_ITEMS.length; i++) {
            if (NAV_ITEMS[i].id === screenName) { navIdx = i; break; }
        }
        if (navIdx >= 0) {
            _navIndex = navIdx;
            // V3.7-fix29 Bug 5: mirror the index into FocusManager so a
            // later Up-press from page content lands on the pill matching
            // the current primary screen, not whichever pill the user last
            // visited via topnav slide. setZoneIndex does NOT change the
            // active zone — only updates the remembered focus index.
            FocusManager.setZoneIndex('topnav', navIdx);
            _updateNavItemClasses();
            _updatePillPosition(navIdx, true);
        } else {
            // Sub-screen (album/artist) — keep selection on whatever primary led here; don't change index
            _updateNavItemClasses();
        }
    }

    /**
     * Zoom an element's content swap (V3-2, in-screen variant).
     * For screens that toggle modes internally (Library genre mode, Playlists
     * playlist-detail) instead of routing to a new screen. `renderFn(container)`
     * is invoked to produce the new content; we animate around it.
     *
     *   direction === 'in'  — used when drilling into detail (e.g. genre card
     *                          clicked, playlist card clicked)
     *   direction === 'out' — used when returning from detail
     *
     * Returns early when already transitioning (honours the same lock as
     * navigateTo) to keep rapid-press behaviour consistent.
     */
    function zoomContent(containerEl, renderFn, direction) {
        if (!containerEl || typeof renderFn !== 'function') return;
        if (!_beginTransition()) return;
        direction = direction === 'out' ? 'out' : 'in';

        var incomingFromScale = direction === 'in' ? 0.92 : 1.08;
        var outgoingToScale   = direction === 'in' ? 1.08 : 0.92;

        var parent = containerEl.parentNode;

        // Ensure the parent establishes a positioning context so the
        // absolutely-positioned ghost overlays the source exactly — some
        // screens (e.g. `.library-screen`) use default `position: static`.
        var savedParentPosition = null;
        if (parent) {
            var parentComputedPos = getComputedStyle(parent).position;
            if (parentComputedPos === 'static') {
                savedParentPosition = parent.style.position;
                parent.style.position = 'relative';
            }
        }

        // V3.7-fix7: detach-and-move instead of cloneNode. Move the existing
        // children into a fresh ghost wrapper so containerEl stays the
        // caller's owned ref (renderFn fills it as before) but no DOM is
        // duplicated and no <img> is re-decoded. Geometry reads still pin
        // the wrapper to the source's box.
        var ghost = null;
        if (containerEl.firstChild && parent) {
            ghost = document.createElement('div');
            ghost.className = 'page-ghost';
            ghost.style.position = 'absolute';
            ghost.style.top    = containerEl.offsetTop    + 'px';
            ghost.style.left   = containerEl.offsetLeft   + 'px';
            ghost.style.width  = containerEl.offsetWidth  + 'px';
            ghost.style.height = containerEl.offsetHeight + 'px';
            ghost.style.margin = '0';
            ghost.style.pointerEvents = 'none';
            ghost.style.zIndex = '2';
            ghost.style.willChange = 'transform, opacity';

            while (containerEl.firstChild) {
                ghost.appendChild(containerEl.firstChild);
            }
            parent.appendChild(ghost);
        }

        // Render new content into the real container
        renderFn(containerEl);

        // Incoming initial state
        containerEl.style.transition = 'none';
        containerEl.style.transform = 'scale(' + incomingFromScale + ')';
        containerEl.style.opacity = '0';
        containerEl.style.willChange = 'transform, opacity';

        if (ghost) {
            ghost.style.transition = 'none';
            ghost.style.transform = 'scale(1)';
            ghost.style.opacity = '1';
        }

        void containerEl.offsetHeight;

        containerEl.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        containerEl.style.transform = 'scale(1)';
        containerEl.style.opacity = '1';

        if (ghost) {
            var ghostDuration = direction === 'in' ? '0.25s' : '0.2s';
            ghost.style.transition = 'transform ' + ghostDuration + ' ease, opacity 0.2s ease';
            ghost.style.transform = 'scale(' + outgoingToScale + ')';
            ghost.style.opacity = '0';
            setTimeout(function() {
                if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
            }, 280);
        }

        setTimeout(function() {
            containerEl.style.transition = '';
            containerEl.style.transform = '';
            containerEl.style.opacity = '';
            containerEl.style.willChange = '';
            if (savedParentPosition !== null && parent) {
                parent.style.position = savedParentPosition;
            }
        }, 290);
    }

    /**
     * Show login screen (called by Settings logout).
     */
    function showLogin() {
        _showLogin();
    }

    /**
     * Get the API instance (convenience for screens).
     */
    function getApi() {
        return AuthManager.getApi();
    }

    /**
     * Return the current screen name (or null before first navigation).
     */
    function getCurrentScreen() {
        return _currentScreen;
    }

    // =========================================
    //  Event Bus (V3.8)
    // =========================================
    var _eventListeners = {};

    function on(name, fn) {
        if (typeof fn !== 'function') return;
        if (!_eventListeners[name]) _eventListeners[name] = [];
        _eventListeners[name].push(fn);
    }

    function off(name, fn) {
        var arr = _eventListeners[name];
        if (!arr) return;
        _eventListeners[name] = arr.filter(function(f) { return f !== fn; });
    }

    function emit(name, payload) {
        var arr = _eventListeners[name];
        if (!arr) return;
        for (var i = 0; i < arr.length; i++) {
            try { arr[i](payload); }
            catch (e) { log('App', 'Event handler error (' + name + '): ' + e.message); }
        }
    }

    // V3.8: orchestrate side-effects of a library-selection change.
    //   - Stop playback + clear queue (release AVPlay if active).
    //   - Drop in-memory + LS API caches (scoped to this user/server).
    //   - Reload StarredCache against the new selection.
    //   - Persist the new selection.
    //   - Emit 'libraries-changed' for any interested listeners.
    //   - Leave the user on the current screen; Home / Library re-fetch
    //     with the new scope on their next activation, since their
    //     activate() reads AuthManager.getSelectedLibraries() afresh and
    //     the LS cache has been cleared.
    function applyLibraryChange(newIds) {
        log('App', 'Applying library change');

        if (typeof Player !== 'undefined') {
            try { Player.stop(); } catch (e) { /* ignore */ }
            try { Player.clearQueue(); } catch (e) { /* ignore */ }
        }

        var api = AuthManager.getApi();
        var creds = AuthManager.getCredentials();
        if (api && typeof api.clearMemoryCache === 'function') {
            api.clearMemoryCache();
        } else if (typeof SubsonicAPI !== 'undefined' && SubsonicAPI.clearCache) {
            SubsonicAPI.clearCache();
        }
        if (typeof SubsonicAPI !== 'undefined' && SubsonicAPI.clearLocalCache) {
            SubsonicAPI.clearLocalCache(creds.username, creds.serverUrl);
        }

        if (typeof StarredCache !== 'undefined') {
            StarredCache.clear();
        }

        AuthManager.setSelectedLibraries(newIds);

        if (api && typeof StarredCache !== 'undefined' && StarredCache.load) {
            StarredCache.load(api).catch(function(err) {
                log('App', 'StarredCache reload failed: ' + (err && err.message));
            });
        }

        emit('libraries-changed', { libraryIds: newIds });
    }

    // =========================================
    //  Bootstrap
    // =========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init: init,
        navigateTo: navigateTo,
        goBack: goBack,
        showLogin: showLogin,
        showAppShell: _showAppShell,
        getApi: getApi,
        getCurrentScreen: getCurrentScreen,
        showToast: showToast,
        showColourHints: showColourHints,
        hideColourHints: hideColourHints,
        zoomContent: zoomContent,
        setNavBarVisible: setNavBarVisible,
        // V3-6-fix NAV-1: snapshot the current zone+index so Back from a
        // sub-screen / NP returns to it. Called from grid + track onActivate.
        saveCurrentFocus: saveCurrentFocus,
        // Used by Library's in-screen genre-detail handleBack so the genre
        // grid's tile is refocused after the cross-fade out.
        tryRestoreFocus: _tryRestoreFocusForCurrentScreen,
        returnToTopNav: function() {
            FocusManager.setActiveZone('topnav', _navIndex);
            _setPillState('focused');
            _updateNavItemClasses();
        },
        applyAccentColor: applyAccentColor,
        saveAccentColor: saveAccentColor,
        resetAccentColor: resetAccentColor,
        getAccentColor: getAccentColor,
        getAccentRgb: getAccentRgb,
        DEFAULT_ACCENT_HEX: DEFAULT_ACCENT_HEX,
        DEFAULT_ACCENT_RGB: DEFAULT_ACCENT_RGB,
        // V3.8 event bus + library-change orchestrator
        on: on,
        off: off,
        emit: emit,
        applyLibraryChange: applyLibraryChange
    };
})();
