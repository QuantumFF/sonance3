/* ============================================
   Sonance — Focus Manager
   D-Pad navigation system for Samsung TV remote
   ============================================ */

var FocusManager = (function() {
    'use strict';

    var log = SonanceUtils.log;

    // Zone registry: name → config object
    var _zones = {};
    // Per-zone remembered focus index
    var _focusIndex = {};
    // Currently active zone name
    var _activeZone = null;
    // Currently focused DOM element
    var _currentElement = null;
    // Input mode: suppresses d-pad handling while a native input has focus (Tizen IME)
    var _inputMode = false;
    // V3.7-fix17: one-shot observers fired when a named zone first registers.
    // Replaces the 50ms × 20 polling loop in app.js's focus-restore path.
    var _zoneObservers = {};

    function init() {
        log('Focus', 'FocusManager initialized');
        document.addEventListener('keydown', _handleKeyDown);
    }

    /**
     * Register a focus zone.
     * config: {
     *   selector: string,          // CSS selector for focusable elements
     *   getElements: function,     // Alternative: returns element array
     *   columns: number,           // Grid columns (1 = vertical list)
     *   onActivate: function(idx, el),  // Enter key handler
     *   onFocus: function(idx, el),     // Focus change handler
     *   neighbors: { up, down, left, right },  // Adjacent zone names
     *   defaultIndex: number       // Initial focus index
     * }
     */
    function registerZone(name, config) {
        // REDESIGN: the 'nowplaying-bar' zone is now the top-left mini player,
        // owned and registered once by the app shell (selector '.mini-player').
        // Legacy per-screen code still re-registers it with the dead
        // '.np-bar-btn' selector — ignore those so the mini-player zone is not
        // clobbered. (The dead registrations are removed per-screen.)
        if (name === 'nowplaying-bar' && config &&
            typeof config.selector === 'string' &&
            config.selector.indexOf('np-bar-btn') >= 0) {
            return;
        }

        // V3.7-fix20: make re-registration with the same selector + virtual
        // flag idempotent. The topnav zone, in particular, is re-registered
        // on logout/login round trips because clearContentZones() preserves
        // it, so a duplicate register would otherwise stack listeners and
        // re-cache elements pointlessly.
        var existing = _zones[name];
        if (existing && config &&
            typeof config.selector === 'string' &&
            existing.selector === config.selector &&
            !!existing.virtual === !!config.virtual) {
            // Refresh the element cache (DOM may have been re-rendered)
            // and return without replacing the zone object itself — but
            // V3.7-fix29: copy mutable config fields so re-registration
            // with the same selector but updated columns/handlers is
            // honoured. Preserves _cachedEls (just refreshed below) and
            // any other internal state, including _focusIndex[name].
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[FocusManager] Re-register of zone "' + name + '"');
            }
            existing._cachedEls = Array.prototype.slice.call(
                document.querySelectorAll(config.selector)
            );
            existing.columns = config.columns;
            existing.neighbors = config.neighbors;
            existing.onActivate = config.onActivate;
            existing.onFocus = config.onFocus;
            existing.onKey = config.onKey;
            existing.getElements = config.getElements;
            // Fire any pending observers — they're waiting on the zone
            // being available, which it now (still) is.
            var pendingDup = _zoneObservers[name];
            if (pendingDup && pendingDup.length) {
                delete _zoneObservers[name];
                for (var d = 0; d < pendingDup.length; d++) {
                    try { pendingDup[d](); } catch (eDup) {}
                }
            }
            return;
        }
        _zones[name] = config;
        // V3.7-fix4: cache the resolved element list once per registration so
        // d-pad keypresses don't pay for a fresh querySelectorAll. Virtual
        // zones (zone.virtual) and zones using a custom getElements() opt out.
        if (config && typeof config.selector === 'string') {
            config._cachedEls = Array.prototype.slice.call(
                document.querySelectorAll(config.selector)
            );
        }
        if (_focusIndex[name] === undefined) {
            _focusIndex[name] = config.defaultIndex || 0;
        }
        log('Focus', 'Zone registered: ' + name);
        // V3.7-fix17: fire any one-shot observers waiting on this zone.
        var pending = _zoneObservers[name];
        if (pending && pending.length) {
            delete _zoneObservers[name];
            for (var i = 0; i < pending.length; i++) {
                try { pending[i](); } catch (e) {}
            }
        }
    }

    // V3.7-fix20: debug hook for verifying that logout/login leaves exactly
    // one entry per zone name. Returns the array of registered zone names.
    function _debugZones() {
        return Object.keys(_zones);
    }

    /**
     * V3.7-fix17: register a one-shot callback that fires the moment a zone
     * is registered. If the zone is already registered, the callback is
     * scheduled on a microtask so the caller's flow stays effectively sync.
     */
    function onceZoneRegistered(name, cb) {
        if (typeof cb !== 'function') return;
        if (_zones[name]) {
            Promise.resolve().then(cb);
            return;
        }
        if (!_zoneObservers[name]) _zoneObservers[name] = [];
        _zoneObservers[name].push(cb);
    }

    /**
     * V3.7-fix4: re-resolve the cached element list for a zone. Use after
     * mutating the zone's DOM without re-registering. No-op for non-static
     * zones (virtual / getElements-based).
     */
    function invalidateZone(name) {
        var zone = _zones[name];
        if (!zone || typeof zone.selector !== 'string') return;
        zone._cachedEls = Array.prototype.slice.call(
            document.querySelectorAll(zone.selector)
        );
    }

    function unregisterZone(name) {
        delete _zones[name];
        delete _focusIndex[name];
        if (_activeZone === name) {
            _activeZone = null;
        }
    }

    /**
     * V3.7-fix29: set the remembered focus index for a zone without
     * changing the active zone or current element. Used by app.js to
     * keep _focusIndex['topnav'] in sync with the current primary
     * screen when navigation happens outside the topnav (e.g. opening
     * NP from the Now-Playing-bar or via Auto-NP).
     */
    function setZoneIndex(name, idx) {
        if (!_zones[name]) return;
        if (typeof idx !== 'number' || idx < 0) return;
        _focusIndex[name] = idx;
    }

    /**
     * Clear all zones except topnav and nowplaying-bar (the persistent zones).
     * Called when navigating between screens.
     */
    function clearContentZones() {
        var toRemove = [];
        Object.keys(_zones).forEach(function(name) {
            if (name !== 'topnav' && name !== 'nowplaying-bar') {
                toRemove.push(name);
            }
        });
        toRemove.forEach(function(name) {
            delete _zones[name];
            delete _focusIndex[name];
        });
        // V3.7-fix5: drop any will-change layer reservations from the screen
        // we're leaving so they don't carry GPU layers over to the new screen.
        _clearAllWillChange();
        // If active zone was a content zone, reset it
        if (_activeZone && _activeZone !== 'topnav' && _activeZone !== 'nowplaying-bar') {
            _activeZone = null;
            if (_currentElement) {
                _currentElement.classList.remove('focused');
                _currentElement = null;
            }
        }
    }

    function hasZone(name) {
        return !!_zones[name];
    }

    /**
     * Set the active focus zone and optionally the focus index.
     * If the active zone is 'topnav' and the user is not explicitly requesting
     * a transfer via `force`, don't let async screen activations steal focus.
     */
    function setActiveZone(name, index, force) {
        if (!_zones[name]) {
            log('Focus', 'Zone not found: ' + name);
            return;
        }
        // Don't let a screen's async activate() pull focus away from the nav bar.
        if (_activeZone === 'topnav' && name !== 'topnav' && !force) {
            // Remember the requested index for when the user does drop into content
            _focusIndex[name] = (index !== undefined) ? index : (_focusIndex[name] || 0);
            return;
        }
        _activeZone = name;
        if (index !== undefined) {
            _focusIndex[name] = index;
        } else if (typeof _zones[name].getEntryIndex === 'function') {
            // Zone declares where focus should land when entered without an
            // explicit index (e.g. a tab strip returns to its active tab).
            var entryIdx = _zones[name].getEntryIndex();
            if (typeof entryIdx === 'number' && entryIdx >= 0) _focusIndex[name] = entryIdx;
        }
        _updateFocus();
    }

    /**
     * Get the DOM elements for a zone.
     */
    function _getElements(zone) {
        if (zone.getElements) {
            return zone.getElements();
        }
        // V3.7-fix4: prefer the cached list when present. Falls through to a
        // fresh query only if registration didn't populate the cache (defence
        // in depth — should not happen for any selector-based zone).
        if (zone._cachedEls) {
            return zone._cachedEls;
        }
        if (zone.selector) {
            return Array.prototype.slice.call(document.querySelectorAll(zone.selector));
        }
        return [];
    }

    /**
     * V3-6-fix2 PERF-2: virtual zone support. When a zone has a `virtual`
     * config, FocusManager treats `virtual.getCount()` as the logical
     * element count (not the live DOM count) and asks `virtual.getItemAt(idx)`
     * to materialise the DOM node for `idx` (scrolling the virtual grid as
     * needed). This lets very large grids stay focusable even when only a
     * few rows are mounted at any time.
     */
    function _zoneCount(zone) {
        if (zone && zone.virtual && typeof zone.virtual.getCount === 'function') {
            return zone.virtual.getCount();
        }
        return _getElements(zone).length;
    }

    function _zoneItemAt(zone, idx) {
        if (zone && zone.virtual && typeof zone.virtual.getItemAt === 'function') {
            return zone.virtual.getItemAt(idx);
        }
        var elements = _getElements(zone);
        return elements[idx] || null;
    }

    // V3-6 / V3.7-fix5: dynamic will-change. Adding `will-change: transform`
    // to every focusable card would reserve a GPU compositing layer per card
    // and blow the TV's VRAM. Promote only the focused element, capped at 5
    // entries; older entries are evicted and reset to `''`. The previous
    // implementation kept an unbounded array that grew across long sessions.
    var _willChangeSet = (typeof Set !== 'undefined') ? new Set() : null;
    var _willChangeOrder = [];
    var WILL_CHANGE_CAP = 5;

    function _setWillChange(el) {
        if (!el || !el.style) return;
        if (_willChangeSet && _willChangeSet.has(el)) return;
        if (_willChangeSet) _willChangeSet.add(el);
        _willChangeOrder.push(el);
        while (_willChangeOrder.length > WILL_CHANGE_CAP) {
            var evicted = _willChangeOrder.shift();
            if (_willChangeSet) _willChangeSet.delete(evicted);
            if (evicted && evicted.style) evicted.style.willChange = '';
        }
        el.style.willChange = 'transform';
    }

    function _clearAllWillChange() {
        for (var i = 0; i < _willChangeOrder.length; i++) {
            var el = _willChangeOrder[i];
            if (el && el.style) el.style.willChange = '';
        }
        _willChangeOrder = [];
        if (_willChangeSet) _willChangeSet.clear();
    }

    // V3-6-fix2 PERF-4: rAF-coalesced scroll + onFocus.
    // scrollIntoView() and the screen's own _scrollToFocused() both read
    // layout properties (offsetTop / offsetHeight / clientHeight); doing
    // that synchronously per-keypress causes layout thrash on Tizen.
    // We batch all of it into one rAF that reads the LATEST _currentElement,
    // so rapid d-pad presses coalesce into one scroll-and-notify pass per
    // frame instead of one per press.
    var _focusRafId = null;
    function _scheduleFocusCallbacks() {
        if (_focusRafId !== null) return;
        _focusRafId = requestAnimationFrame(function() {
            _focusRafId = null;
            var zone = _zones[_activeZone];
            if (!zone) return;
            var el = _currentElement;
            if (!el) return;
            var idx = _focusIndex[_activeZone] || 0;
            try {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } catch (e) {
                el.scrollIntoView(false);
            }
            if (zone.onFocus) {
                zone.onFocus(idx, el);
            }
        });
    }

    /**
     * Update the visual focus: remove old, apply new.
     */
    function _updateFocus() {
        // Remove previous focus class
        if (_currentElement) {
            _currentElement.classList.remove('focused');
        }

        var zone = _zones[_activeZone];
        if (!zone) return;

        var total = _zoneCount(zone);
        if (total === 0) return;

        // Clamp index to valid range
        var idx = _focusIndex[_activeZone];
        if (idx === undefined || idx === null || idx < 0) idx = 0;
        if (idx >= total) idx = total - 1;
        _focusIndex[_activeZone] = idx;

        // Resolve the DOM node — virtual zones may scroll/render to materialise it.
        var node = _zoneItemAt(zone, idx);
        if (!node) return;

        // Apply focus (cheap: class + GPU will-change toggle, no layout reads)
        _currentElement = node;
        _currentElement.classList.add('focused');
        _setWillChange(_currentElement);

        // Blur any browser-focused input to prevent dual focus
        var activeEl = document.activeElement;
        if (activeEl && activeEl !== document.body && activeEl !== _currentElement) {
            if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
                activeEl.blur();
            }
        }

        // Defer scroll-into-view + zone.onFocus to next frame so the focus
        // class repaint and the layout-reading scroll work happen in
        // separate frames (and rapid presses coalesce into one rAF).
        _scheduleFocusCallbacks();
    }

    /**
     * Move focus in a direction within the current zone.
     * At zone edges, tries transitioning to a neighbor zone.
     */
    function moveFocus(direction) {
        var zone = _zones[_activeZone];
        if (!zone) return;

        // Allow zones to intercept directional input (e.g. seeking)
        if (zone.onKey && zone.onKey(direction) === true) return;

        var total = _zoneCount(zone);
        if (total === 0) return;

        var cols = zone.columns || 1;
        var idx = _focusIndex[_activeZone] || 0;
        var newIdx = idx;

        if (direction === 'up') {
            newIdx = idx - cols;
            if (newIdx < 0) {
                _tryTransition('up');
                return;
            }
        } else if (direction === 'down') {
            newIdx = idx + cols;
            if (newIdx >= total) {
                _tryTransition('down');
                return;
            }
        } else if (direction === 'left') {
            if (cols > 1 && (idx % cols) > 0) {
                newIdx = idx - 1;
            } else {
                _tryTransition('left');
                return;
            }
        } else if (direction === 'right') {
            if (cols > 1 && (idx % cols) < cols - 1 && idx + 1 < total) {
                newIdx = idx + 1;
            } else {
                _tryTransition('right');
                return;
            }
        }

        _focusIndex[_activeZone] = newIdx;
        _updateFocus();
    }

    /**
     * Try to transition focus to a neighbor zone.
     */
    function _tryTransition(direction) {
        var zone = _zones[_activeZone];
        if (!zone) return;
        var neighbors = zone.neighbors || {};

        var neighborName = neighbors[direction];
        // v3: Up from any zone with no explicit up-neighbor returns to the top nav.
        if (!neighborName && direction === 'up' && _activeZone !== 'topnav' && _zones.topnav) {
            neighborName = 'topnav';
        }
        if (!neighborName) return;

        var neighbor = _zones[neighborName];
        if (!neighbor) return;

        var neighborCount = _zoneCount(neighbor);
        if (neighborCount === 0) return;

        // Determine target index in neighbor zone
        var targetIdx;
        if (typeof neighbor.getEntryIndex === 'function') {
            // Zone dictates its own entry index (e.g. tab strip → active tab),
            // overriding the directional first/last default below.
            var gi = neighbor.getEntryIndex(direction);
            targetIdx = (typeof gi === 'number' && gi >= 0) ? gi : (_focusIndex[neighborName] || 0);
        } else if (neighborName === 'topnav') {
            // Returning to the top nav: always land on the nav item that matches
            // the current primary screen (remembered index), not the last item.
            targetIdx = _focusIndex[neighborName] || 0;
        } else if (direction === 'up') {
            // Coming from below: land on last item
            targetIdx = neighborCount - 1;
        } else if (direction === 'down') {
            // Coming from above: land on first item
            targetIdx = 0;
        } else {
            // Left/Right: preserve remembered position
            targetIdx = _focusIndex[neighborName] || 0;
        }

        targetIdx = Math.max(0, Math.min(targetIdx, neighborCount - 1));
        _focusIndex[neighborName] = targetIdx;
        // Directional transitions from topnav should fall through unprotected
        // (user explicitly moved focus); from other zones to topnav likewise.
        _activeZone = neighborName;
        _updateFocus();
    }

    /**
     * Activate (Enter key) the currently focused element.
     */
    function activateFocused() {
        var zone = _zones[_activeZone];
        if (!zone) return;

        var idx = _focusIndex[_activeZone] || 0;
        if (idx >= _zoneCount(zone)) return;

        var node = _zoneItemAt(zone, idx);
        if (node && zone.onActivate) {
            zone.onActivate(idx, node);
        }
    }

    function getCurrentFocused() {
        return _currentElement;
    }

    function getActiveZone() {
        return _activeZone;
    }

    /**
     * Set input mode — suppresses d-pad handling while a native input has focus.
     * Called by login screen (and any future input screens) on focus/blur.
     */
    function setInputMode(enabled) {
        _inputMode = !!enabled;
        log('Focus', 'Input mode: ' + (_inputMode ? 'ON' : 'OFF'));
    }

    /**
     * Central keyboard event handler.
     * Handles arrow keys, Enter, Back/Escape, and media keys.
     */
    function _handleKeyDown(e) {
        var keyCode = e.keyCode;

        // If focused in an input/textarea, don't intercept navigation keys
        var activeEl = document.activeElement;
        var isInput = activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT'
        );

        if (isInput || _inputMode) {
            // Only intercept Escape/Back in inputs to return to managed focus
            if (keyCode === 10009 || keyCode === 27) {
                e.preventDefault();
                if (activeEl && activeEl.blur) {
                    activeEl.blur();
                }
                _inputMode = false;
                if (_activeZone) {
                    _updateFocus();
                }
            }
            return; // Let input handle all other keys normally
        }

        // Back (Samsung 10009) / Escape (browser 27) — always handle, even without active zone
        if (keyCode === 10009 || keyCode === 27) {
            e.preventDefault();
            if (typeof App !== 'undefined' && App.goBack) {
                App.goBack();
            }
            return;
        }

        // If no active zone, don't intercept anything else
        if (!_activeZone) return;

        // Arrow keys
        if (keyCode === 38) { // Up
            e.preventDefault();
            moveFocus('up');
        } else if (keyCode === 40) { // Down
            e.preventDefault();
            moveFocus('down');
        } else if (keyCode === 37) { // Left
            e.preventDefault();
            moveFocus('left');
        } else if (keyCode === 39) { // Right
            e.preventDefault();
            moveFocus('right');
        }
        // Enter
        else if (keyCode === 13) {
            e.preventDefault();
            activateFocused();
        }
        // Media keys — forwarded to Player
        else if (keyCode === 10252) { // Play/Pause
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.togglePlayPause();
        } else if (keyCode === 10253) { // Stop
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.pause();
        } else if (keyCode === 10412) { // Rewind/Previous
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.previous();
        } else if (keyCode === 10417) { // Fast Forward/Next
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.next();
        }
        // Spacebar — Play/Pause (browser testing convenience)
        else if (keyCode === 32) {
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.togglePlayPause();
        }
        // Samsung colour buttons (always handle)
        else if (keyCode === 403 || e.key === 'ColorF0Red') {
            e.preventDefault();
            _handleColourButton('red');
        } else if (keyCode === 404 || e.key === 'ColorF1Green') {
            e.preventDefault();
            _handleColourButton('green');
        } else if (keyCode === 405 || e.key === 'ColorF2Yellow') {
            e.preventDefault();
            _handleColourButton('yellow');
        } else if (keyCode === 406 || e.key === 'ColorF3Blue') {
            e.preventDefault();
            _handleColourButton('blue');
        }
        // Browser keyboard fallbacks (R/G/Y/B) — only if active zone supports colour buttons
        else if (_hasColourButtonSupport()) {
            if (e.key === 'r' || e.key === 'R') {
                e.preventDefault();
                _handleColourButton('red');
            } else if (e.key === 'g' || e.key === 'G') {
                e.preventDefault();
                _handleColourButton('green');
            } else if (e.key === 'y' || e.key === 'Y') {
                e.preventDefault();
                _handleColourButton('yellow');
            } else if (e.key === 'b' || e.key === 'B') {
                e.preventDefault();
                _handleColourButton('blue');
            }
        }
    }

    /**
     * Check if the active zone supports colour buttons.
     */
    function _hasColourButtonSupport() {
        var zone = _zones[_activeZone];
        return zone && typeof zone.onColourButton === 'function';
    }

    /**
     * Handle colour button press — delegates to the active zone's onColourButton handler.
     */
    function _handleColourButton(colour) {
        var zone = _zones[_activeZone];
        if (!zone || !zone.onColourButton) return;

        var idx = _focusIndex[_activeZone] || 0;
        if (idx < _zoneCount(zone)) {
            zone.onColourButton(colour, idx, _zoneItemAt(zone, idx));
        }
    }

    /**
     * Intercept transition into topnav from any zone: also flip pill to focused
     * state so the user sees the nav bar light up immediately.
     */
    function _onTransitionToTopNav() {
        if (typeof App !== 'undefined' && App.returnToTopNav) {
            // handled by caller / App.returnToTopNav — nothing more to do here
        }
    }

    /**
     * V3-6-fix NAV-1: capture the current zone + index so the caller can
     * restore focus later (e.g. after Back returns to a Library grid).
     * Returns null when no content zone is active.
     */
    function snapshot() {
        if (!_activeZone) return null;
        return { zone: _activeZone, index: _focusIndex[_activeZone] || 0 };
    }

    /**
     * V3-6-fix NAV-1: restore focus to a previously snapshotted zone+index.
     * Returns false when the zone hasn't been re-registered yet (caller can
     * retry asynchronously while the page's data finishes loading).
     */
    function restore(snap) {
        if (!snap || !snap.zone) return false;
        if (!_zones[snap.zone]) return false;
        setActiveZone(snap.zone, snap.index, true);
        return true;
    }

    return {
        init: init,
        registerZone: registerZone,
        unregisterZone: unregisterZone,
        invalidateZone: invalidateZone,
        clearContentZones: clearContentZones,
        setActiveZone: setActiveZone,
        setZoneIndex: setZoneIndex,
        moveFocus: moveFocus,
        activateFocused: activateFocused,
        getCurrentFocused: getCurrentFocused,
        getActiveZone: getActiveZone,
        setInputMode: setInputMode,
        hasZone: hasZone,
        snapshot: snapshot,
        restore: restore,
        onceZoneRegistered: onceZoneRegistered,
        // V3.7-fix20: diagnostic — returns current zone names. Useful from
        // the DevTools console to verify there is exactly one 'topnav' entry
        // after a logout/login round trip.
        _debugZones: _debugZones
    };
})();
