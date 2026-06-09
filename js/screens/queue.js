/* ============================================
   Sonance — Queue Screen
   Split layout: now playing card + up next list
   ============================================ */

var QueueScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _active = false;

    // DOM references — REDESIGN: full-width list, no now-playing card (the
    // top-left mini player already shows the current track).
    var _queueList = null;
    // V3.7-fix13: diff state for incremental queue-list updates
    var _lastQueueKeys = [];          // composite "id|queueIdx" keys
    var _rowByKey = Object.create(null); // key -> DOM node
    var _emptyEl = null;              // placeholder for "Queue is empty" message
    var _currentPlayingRow = null;    // marks .queue-row-playing row, when applicable

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(element) {
        var container = document.getElementById('queue-list');
        if (!container || !element) return;
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

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        // REDESIGN: single full-width track list (the mini player shows the
        // current track, so the now-playing card is gone).
        var wrapper = el('div', { className: 'queue-screen' });
        wrapper.appendChild(el('div', { className: 'queue-heading' }, 'Queue'));

        _queueList = el('div', { className: 'queue-list', id: 'queue-list' });
        wrapper.appendChild(_queueList);

        container.appendChild(wrapper);
        log('Queue', 'Queue screen rendered');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;

        _renderQueueList(Player.getState());

        // Subscribe to events
        Player.on('trackchange', _onTrackChange);
        Player.on('queuechange', _onQueueChange);

        _registerFocusZones();
    }

    // =========================================
    //  Event Handlers
    // =========================================

    function _onTrackChange(track) {
        if (!_active) return;
        // V3.7-fix13: trackchange shifts the queueIndex which usually drops
        // the head row from the up-next list. Run the diff (which mutates
        // exactly one row in the typical case) instead of full re-render.
        var hadRows = _lastQueueKeys.length > 0;
        _diffQueueList(Player.getState());
        var hasRows = _lastQueueKeys.length > 0;
        // Re-register zones only when the empty/non-empty state flipped.
        if (hadRows !== hasRows) _registerFocusZones();
    }

    function _onQueueChange() {
        if (!_active) return;
        var hadRows = _lastQueueKeys.length > 0;
        _diffQueueList(Player.getState());
        var hasRows = _lastQueueKeys.length > 0;
        if (hadRows !== hasRows) _registerFocusZones();
    }

    // =========================================
    //  UI Updates
    // =========================================

    // V3.7-fix13: build the up-next item list (source of truth for the diff).
    function _computeUpNext(pState) {
        var queue = pState.queue;
        var currentIdx = pState.queueIndex;
        var upNext = [];
        for (var i = currentIdx + 1; i < queue.length; i++) {
            upNext.push({ track: queue[i], queueIdx: i });
        }
        if (pState.repeat === 'all' && currentIdx > 0) {
            for (var j = 0; j < currentIdx; j++) {
                upNext.push({ track: queue[j], queueIdx: j });
            }
        }
        return upNext;
    }

    function _rowKey(track, queueIdx) {
        return (track && track.id ? track.id : '?') + '|' + queueIdx;
    }

    function _createRow(track, queueIdx, displayIdx, api) {
        var row = el('div', {
            className: 'queue-row focusable',
            'data-queue-idx': String(queueIdx),
            'data-song-id': track.id || ''
        });

        var numEl = el('div', { className: 'queue-row-num' }, String(displayIdx + 1));
        row.appendChild(numEl);

        var thumb = el('div', { className: 'queue-row-thumb' });
        var coverId = track.coverArt || track.albumId;
        if (api && coverId) {
            var img = document.createElement('img');
            img.className = 'lazy-art';
            img.setAttribute('data-coverart', coverId);
            img.setAttribute('data-size', '100');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '4px';
            img.onerror = function() {
                if (img.parentNode) img.parentNode.removeChild(img);
            };
            thumb.appendChild(img);
            if (typeof LazyLoader !== 'undefined') LazyLoader.observe(img);
        }
        row.appendChild(thumb);

        var info = el('div', { className: 'queue-row-info' });
        info.appendChild(el('div', { className: 'queue-row-title' }, track.title || 'Unknown'));
        info.appendChild(el('div', { className: 'queue-row-artist' }, track.artist || 'Unknown'));
        row.appendChild(info);

        row.appendChild(el('div', { className: 'queue-row-duration' }, (track._formattedDuration || formatDuration(track.duration))));

        // Click to jump to this track
        row.addEventListener('click', function() {
            Player.jumpToQueueIndex(queueIdx);
        });

        return row;
    }

    // Initial mount: full render and seed the diff state.
    function _renderQueueList(pState) {
        if (!_queueList) return;
        _queueList.textContent = '';
        _rowByKey = Object.create(null);
        _lastQueueKeys = [];
        _emptyEl = null;

        var upNext = _computeUpNext(pState);
        if (upNext.length === 0) {
            _emptyEl = el('div', { className: 'queue-empty' }, 'Queue is empty');
            _queueList.appendChild(_emptyEl);
            return;
        }

        var api = AuthManager.getApi();
        for (var i = 0; i < upNext.length; i++) {
            var key = _rowKey(upNext[i].track, upNext[i].queueIdx);
            var row = _createRow(upNext[i].track, upNext[i].queueIdx, i, api);
            _queueList.appendChild(row);
            _rowByKey[key] = row;
            _lastQueueKeys.push(key);
        }
    }

    // V3.7-fix13: incremental diff between _lastQueueKeys and the new upNext.
    // Removes rows that disappeared, inserts new rows at the right position,
    // updates the visible row-number index for any kept rows whose position
    // shifted. O(n) where n = max(old, new).
    function _diffQueueList(pState) {
        if (!_queueList) return;

        // First-render path or recovering from empty state: full render.
        if (_lastQueueKeys.length === 0 && !_emptyEl) {
            _renderQueueList(pState);
            return;
        }

        var upNext = _computeUpNext(pState);
        var newKeys = new Array(upNext.length);
        for (var n = 0; n < upNext.length; n++) {
            newKeys[n] = _rowKey(upNext[n].track, upNext[n].queueIdx);
        }

        // Empty -> non-empty: drop placeholder, build rows.
        if (_emptyEl && upNext.length > 0) {
            if (_emptyEl.parentNode) _emptyEl.parentNode.removeChild(_emptyEl);
            _emptyEl = null;
            _renderQueueList(pState);
            return;
        }
        // Non-empty -> empty: clear rows, show placeholder.
        if (_lastQueueKeys.length > 0 && upNext.length === 0) {
            _queueList.textContent = '';
            _rowByKey = Object.create(null);
            _lastQueueKeys = [];
            _emptyEl = el('div', { className: 'queue-empty' }, 'Queue is empty');
            _queueList.appendChild(_emptyEl);
            return;
        }

        // Build a Set-like map of new keys for O(1) lookup.
        var newKeySet = Object.create(null);
        for (var k = 0; k < newKeys.length; k++) newKeySet[newKeys[k]] = true;

        // Remove rows that disappeared.
        for (var o = 0; o < _lastQueueKeys.length; o++) {
            var oldKey = _lastQueueKeys[o];
            if (!newKeySet[oldKey]) {
                var oldRow = _rowByKey[oldKey];
                if (oldRow && oldRow.parentNode) oldRow.parentNode.removeChild(oldRow);
                delete _rowByKey[oldKey];
            }
        }

        // Reconcile order + insert new rows.
        var api = AuthManager.getApi();
        for (var p = 0; p < upNext.length; p++) {
            var item = upNext[p];
            var key = newKeys[p];
            var existing = _rowByKey[key];
            // Reference node currently at position p in the live DOM.
            var refNode = _queueList.children[p] || null;

            if (!existing) {
                var newRow = _createRow(item.track, item.queueIdx, p, api);
                _rowByKey[key] = newRow;
                if (refNode) {
                    _queueList.insertBefore(newRow, refNode);
                } else {
                    _queueList.appendChild(newRow);
                }
            } else {
                // Move into place if not already there.
                if (refNode !== existing) {
                    _queueList.insertBefore(existing, refNode);
                }
                // Update the visible row-number index when the position shifted.
                var num = existing.firstChild;
                if (num && num.className === 'queue-row-num') {
                    var want = String(p + 1);
                    if (num.textContent !== want) num.textContent = want;
                }
            }
        }

        _lastQueueKeys = newKeys;
    }

    // V3.7-fix13: indicator-only update for a now-playing row, mirroring the
    // album.js _updatePlayingIndicator pattern. Used if a future layout shows
    // the current track inside the queue list — currently a no-op visually
    // because the up-next list excludes the playing track, but kept so that
    // the trackchange path has a clean handle.
    function _updateQueuePlayingIndicator(songId) {
        if (_currentPlayingRow) {
            _currentPlayingRow.classList.remove('queue-row-playing');
            _currentPlayingRow = null;
        }
        if (!songId || !_queueList) return;
        var row = _queueList.querySelector('[data-song-id="' + songId + '"]');
        if (row) {
            row.classList.add('queue-row-playing');
            _currentPlayingRow = row;
        }
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        var queueRows = document.querySelectorAll('#queue-list .focusable');
        var hasQueue = queueRows.length > 0;

        // REDESIGN: a single full-width list zone. When the queue is empty
        // there is nothing focusable — leave focus on the top nav.
        if (hasQueue) {
            FocusManager.registerZone('queue-list', {
                selector: '#queue-list .focusable',
                columns: 1,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                onColourButton: function(colour, idx, element) {
                    if (colour === 'red') {
                        var queueIdx = element.getAttribute('data-queue-idx');
                        if (queueIdx !== null) {
                            Player.removeFromQueue(parseInt(queueIdx, 10));
                            App.showToast('Removed from queue');
                        }
                    }
                },
                neighbors: {
                    down: 'nowplaying-bar'
                }
            });
            App.showColourHints([
                { colour: 'red', label: 'Remove' }
            ]);
            FocusManager.setActiveZone('queue-list', 0);
        } else {
            FocusManager.unregisterZone('queue-list');
            App.hideColourHints();
        }
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;

        Player.off('trackchange', _onTrackChange);
        Player.off('queuechange', _onQueueChange);
        App.hideColourHints();

        _container = null;
        _queueList = null;
        // V3.7-fix13: reset diff state so a re-entry rebuilds cleanly.
        _lastQueueKeys = [];
        _rowByKey = Object.create(null);
        _emptyEl = null;
        _currentPlayingRow = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
