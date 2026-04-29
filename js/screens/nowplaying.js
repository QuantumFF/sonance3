/* ============================================
   Sonance — Now Playing Screen
   Full-screen player with album art, progress,
   transport controls, volume, and synced lyrics (P14b).
   ============================================ */

var NowPlayingScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var warn = SonanceUtils.warn;
    var createSvg = SonanceUtils.createSvg;
    var createStarSvg = SonanceUtils.createStarSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;
    var parseLyricsResponse = SonanceUtils.parseLyricsResponse;

    var _container = null;
    var _active = false;

    // V3-6-fix4 PERF-6: cached progress-bar pixel width. _updateProgress
    // used to call getBoundingClientRect() on every progress tick; the
    // bar width is fixed for the duration of the screen (unless the
    // viewport resizes), so we cache it.
    var _progressBarWidth = 0;
    // V3.7-fix15: cache the full rect (left + width) so the click-to-seek
    // handler doesn't read getBoundingClientRect() on every click.
    var _progressBarLeft = 0;
    var _progressMeasureRaf = null;
    var _progressResizeBound = null;

    // V3-6-fix5 FIX-2: deferred initial-focus handle. The synchronous
    // setActiveZone('content', 2) call was being undone by navigateTo's
    // post-activate `wasInTopNav` re-grab (app.js ~line 1535) when NP was
    // opened from the top nav, so play/pause never visibly received focus
    // until the nav-bar auto-hide timer fired ~5 s later. Scheduling the
    // focus call via rAF lets the navigateTo() pass complete first; the
    // rAF then forces focus onto the play button regardless of whether
    // the user came from topnav, the persistent NP bar, or auto-open.
    var _initialFocusRaf = null;

    // DOM references for live updates
    var _artImg = null;
    // V3.7-fix19: persistent <img> + placeholder elements created once at
    // render-time. Track changes mutate _artImgEl.src in place.
    var _artImgEl = null;
    var _artPlaceholderEl = null;
    var _titleEl = null;
    var _subtitleEl = null;
    var _progressFill = null;
    var _progressScrubber = null;
    var _timeCurrent = null;
    var _timeTotal = null;
    var _playBtn = null;
    var _shuffleBtn = null;
    var _repeatBtn = null;
    var _starBtn = null;
    var _lyricsBtn = null;
    var _bgEl = null;
    var _progressBar = null;

    // Layout + lyrics
    var _layoutEl = null;
    var _leftEl = null;
    var _lyricsPanel = null;
    var _lyricsWrapper = null;
    var _lyricsLinesEl = null;
    var _lyricsBuildRaf = null;        // V3-6-fix4 PERF-3: deferred-build handle
    var _willChangeClearTimer = null;  // V3-6-fix4 PERF-4: clear-after-transition

    // Lyrics state
    var _lyricsCache = {};        // songId → parsed lyrics | null
    var _pendingFetches = {};     // songId → true while a request is in flight
    var _currentLyrics = null;    // parsed structured lyrics for current track (or null)
    var _lyricsVisible = false;
    // V3-6-fix4 PERF-1: deferred-fetch handles. rAF first guarantees the
    // current paint cycle ran; rIC then waits for browser idle time so the
    // network request never races first paint.
    var _lyricsRaf = null;
    var _lyricsIdleHandle = null;

    var _hasRic = (typeof requestIdleCallback === 'function');
    function _ric(fn) {
        if (_hasRic) {
            return requestIdleCallback(fn, { timeout: 1500 });
        }
        return setTimeout(fn, 0);
    }
    function _cancelRic(handle) {
        if (handle === null || handle === undefined) return;
        if (_hasRic && typeof cancelIdleCallback === 'function') {
            cancelIdleCallback(handle);
        } else {
            clearTimeout(handle);
        }
    }
    function _cancelLyricsDefer() {
        if (_lyricsRaf !== null) {
            cancelAnimationFrame(_lyricsRaf);
            _lyricsRaf = null;
        }
        if (_lyricsIdleHandle !== null) {
            _cancelRic(_lyricsIdleHandle);
            _lyricsIdleHandle = null;
        }
    }

    // Remove all children of a node (safer than innerHTML = '')
    function _clearNode(node) {
        if (!node) return;
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    // =========================================
    //  LyricsScroller
    // =========================================

    var LyricsScroller = {
        _wrapper: null,
        _container: null,
        _lines: [],
        _lineElements: [],
        _activeIndex: -1,
        _synced: false,
        _currentOffset: 0,
        // V3-6-fix4 PERF-2: cache layout dimensions populated once on init
        // (and on window resize). _scrollToActive used to read offsetTop /
        // offsetHeight / clientHeight every progress tick (~250 ms while
        // playing); now those are array lookups.
        _wrapperHeight: 0,
        _contentHeight: 0,
        _lineOffsets: [],
        _lineHeights: [],
        _scrollRaf: null,
        _resizeBound: null,

        init: function(wrapper, container, lyricsData) {
            this._wrapper = wrapper;
            this._container = container;
            this._lines = (lyricsData && lyricsData.line) ? lyricsData.line : [];
            this._synced = !!(lyricsData && lyricsData.synced);
            // V3.7-fix16: ensure ascending sort by start so the binary
            // search in update() is correct. Most parsers emit sorted
            // input but defensively re-sort if any pair is out of order.
            if (this._synced && this._lines.length > 1) {
                var sorted = true;
                for (var s = 1; s < this._lines.length; s++) {
                    var prevT = this._lines[s - 1].start;
                    var curT = this._lines[s].start;
                    if (typeof prevT === 'number' && typeof curT === 'number' && curT < prevT) {
                        sorted = false; break;
                    }
                }
                if (!sorted) {
                    this._lines = this._lines.slice().sort(function(a, b) {
                        return (a.start || 0) - (b.start || 0);
                    });
                }
            }
            this._activeIndex = -1;
            this._currentOffset = 0;
            this._render();
            this._refreshLayoutCache();
            if (!this._resizeBound) {
                var self = this;
                this._resizeBound = function() { self._refreshLayoutCache(); };
                window.addEventListener('resize', this._resizeBound);
            }
        },

        _refreshLayoutCache: function() {
            if (!this._wrapper || !this._container) {
                this._wrapperHeight = 0;
                this._contentHeight = 0;
                this._lineOffsets = [];
                this._lineHeights = [];
                return;
            }
            this._wrapperHeight = this._wrapper.clientHeight || 0;
            this._contentHeight = this._container.scrollHeight || 0;
            var n = this._lineElements.length;
            this._lineOffsets = new Array(n);
            this._lineHeights = new Array(n);
            for (var i = 0; i < n; i++) {
                var lineEl = this._lineElements[i];
                this._lineOffsets[i] = lineEl.offsetTop;
                this._lineHeights[i] = lineEl.offsetHeight;
            }
        },

        _render: function() {
            _clearNode(this._container);
            this._lineElements = [];
            if (!this._lines.length) {
                var empty = document.createElement('div');
                empty.className = 'np-lyrics-empty';
                empty.textContent = 'No lyrics available';
                this._container.appendChild(empty);
                return;
            }
            var frag = document.createDocumentFragment();
            var initialClass = this._synced ? 'lyrics-line lyrics-upcoming' : 'lyrics-line';
            for (var i = 0; i < this._lines.length; i++) {
                var line = this._lines[i];
                var lineEl = document.createElement('div');
                lineEl.className = initialClass;
                lineEl.textContent = (line && line.value) ? line.value : '';
                frag.appendChild(lineEl);
                this._lineElements.push(lineEl);
            }
            this._container.appendChild(frag);
            this._container.style.transition = 'none';
            this._container.style.transform = 'translateY(0)';
        },

        update: function(currentTimeMs) {
            if (!this._synced || !this._lines.length) return;

            // V3.7-fix16: binary search for the largest index whose start
            // <= currentTimeMs. Constant cost per update regardless of
            // song length. -1 means "before the first line".
            var lo = 0, hi = this._lines.length - 1, newIndex = -1;
            while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                var t = this._lines[mid].start;
                if (typeof t !== 'number') {
                    // Lines without timestamps are skipped — fall back to
                    // a left-walk to find the previous indexed line.
                    var k = mid - 1;
                    while (k >= 0 && typeof this._lines[k].start !== 'number') k--;
                    if (k >= 0 && this._lines[k].start <= currentTimeMs) {
                        newIndex = k;
                        lo = mid + 1;
                    } else {
                        hi = mid - 1;
                    }
                } else if (t <= currentTimeMs) {
                    newIndex = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }

            if (newIndex === this._activeIndex) return;
            this._activeIndex = newIndex;

            for (var j = 0; j < this._lineElements.length; j++) {
                var el2 = this._lineElements[j];
                if (j === newIndex) {
                    el2.className = 'lyrics-line lyrics-active';
                } else if (j < newIndex) {
                    el2.className = 'lyrics-line lyrics-past';
                } else {
                    el2.className = 'lyrics-line lyrics-upcoming';
                }
            }

            this._scrollToActive();
        },

        _scrollToActive: function() {
            if (this._activeIndex < 0) return;
            if (!this._wrapper || !this._container) return;
            // Lazy-recompute if cache was cleared (e.g. resize between ticks).
            if (!this._lineOffsets.length && this._lineElements.length) {
                this._refreshLayoutCache();
            }
            var lineTop = this._lineOffsets[this._activeIndex] || 0;
            var lineH = this._lineHeights[this._activeIndex] || 0;
            var wrapperH = this._wrapperHeight || this._wrapper.clientHeight;
            var targetScroll = lineTop - (wrapperH * 0.33) + (lineH / 2);
            if (targetScroll < 0) targetScroll = 0;
            this._currentOffset = targetScroll;
            var container = this._container;
            if (this._scrollRaf !== null) cancelAnimationFrame(this._scrollRaf);
            this._scrollRaf = requestAnimationFrame(function() {
                container.style.transition = 'transform 0.3s ease';
                container.style.transform = 'translateY(' + (-targetScroll) + 'px)';
            });
        },

        jumpTo: function(currentTimeMs) {
            if (!this._container) return;
            this._container.style.transition = 'none';
            this._activeIndex = -1;
            this.update(currentTimeMs);
            var self = this;
            setTimeout(function() {
                if (self._container) {
                    self._container.style.transition = 'transform 0.3s ease';
                }
            }, 50);
        },

        scrollBy: function(deltaPx) {
            if (!this._container) return;
            var current = this._currentOffset || 0;
            current += deltaPx;
            var contentH = this._contentHeight || (this._container.scrollHeight || 0);
            var wrapperH = this._wrapperHeight || (this._wrapper ? this._wrapper.clientHeight : 0);
            var maxScroll = Math.max(0, contentH - wrapperH);
            if (current < 0) current = 0;
            if (current > maxScroll) current = maxScroll;
            this._currentOffset = current;
            this._container.style.transition = 'transform 0.3s ease';
            this._container.style.transform = 'translateY(' + (-current) + 'px)';
        },

        reset: function() {
            // V3.7-fix29 Bug 2: leave .np-lyrics-lines genuinely empty so
            // reset() doubles as the swap-to-empty-state path used when a
            // track without lyrics arrives while the panel is open. Stale
            // line nodes from the previous track must not remain visible.
            // Safe to call repeatedly and on a freshly-constructed scroller
            // (no _container yet) — both branches no-op cleanly.
            this._activeIndex = -1;
            this._currentOffset = 0;
            if (this._container) {
                this._container.style.transition = 'none';
                this._container.style.transform = 'translateY(0)';
                _clearNode(this._container);
            }
            this._lineElements = [];
            this._lines = [];
            this._synced = false;
            this._wrapperHeight = 0;
            this._contentHeight = 0;
            this._lineOffsets = [];
            this._lineHeights = [];
        },

        destroy: function() {
            _clearNode(this._container);
            if (this._scrollRaf !== null) {
                cancelAnimationFrame(this._scrollRaf);
                this._scrollRaf = null;
            }
            if (this._resizeBound) {
                window.removeEventListener('resize', this._resizeBound);
                this._resizeBound = null;
            }
            this._wrapper = null;
            this._container = null;
            this._lineElements = [];
            this._lines = [];
            this._activeIndex = -1;
            this._currentOffset = 0;
            this._synced = false;
            this._wrapperHeight = 0;
            this._contentHeight = 0;
            this._lineOffsets = [];
            this._lineHeights = [];
        }
    };

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'np-screen' });

        // Blurred album art background (P5.3)
        _bgEl = el('div', { className: 'np-bg-image' });
        wrapper.appendChild(_bgEl);

        // Dark overlay for text readability
        wrapper.appendChild(el('div', { className: 'np-bg-overlay' }));

        // Two-column layout (P14b): .np-left + .np-lyrics-panel
        _layoutEl = el('div', { className: 'np-layout' });

        var left = el('div', { className: 'np-left' });
        _leftEl = left;

        // Album art (280px) — V3.7-fix19: build the cover container once
        // with a persistent <img> + placeholder; track changes only mutate
        // src and toggle visibility.
        var artWrap = el('div', { className: 'np-screen-art' });
        _artImg = el('div', { className: 'np-screen-art-inner' });
        _artImgEl = document.createElement('img');
        _artImgEl.className = 'lazy-art loaded';
        _artImgEl.style.width = '100%';
        _artImgEl.style.height = '100%';
        _artImgEl.style.objectFit = 'cover';
        _artImgEl.style.borderRadius = '16px';
        _artImgEl.setAttribute('decoding', 'async');
        // Browser-only: lazy attribute is harmless on Tizen but skip if it
        // would cause an instant fetch suppression we don't want.
        if (typeof window.webapis === 'undefined') {
            _artImgEl.setAttribute('loading', 'lazy');
        }
        _artImgEl.onerror = function() {
            _showArtPlaceholder(null);
        };
        _artImg.appendChild(_artImgEl);
        artWrap.appendChild(_artImg);
        left.appendChild(artWrap);

        // Track title
        _titleEl = el('div', { className: 'np-screen-title' }, 'No track playing');
        left.appendChild(_titleEl);

        // Artist — Album
        _subtitleEl = el('div', { className: 'np-screen-subtitle' }, 'Select a song to begin');
        left.appendChild(_subtitleEl);

        // Progress bar
        var progressWrap = el('div', { className: 'np-screen-progress-wrap' });

        _progressBar = el('div', { className: 'np-screen-progress focusable', id: 'np-progress-bar' });
        var progressTrack = el('div', { className: 'np-screen-progress-track' });
        _progressFill = el('div', { className: 'np-screen-progress-fill' });
        _progressScrubber = el('div', { className: 'np-screen-progress-scrubber' });
        progressTrack.appendChild(_progressFill);
        progressTrack.appendChild(_progressScrubber);
        _progressBar.appendChild(progressTrack);

        _progressBar.addEventListener('click', function(e) {
            // V3.7-fix15: prefer the cached rect (populated on activate +
            // resize). Fall back to a one-off measure if not yet cached.
            var left = _progressBarLeft;
            var width = _progressBarWidth;
            if (!width) {
                var r = _progressBar.getBoundingClientRect();
                left = r.left;
                width = r.width;
                _progressBarLeft = left;
                _progressBarWidth = width;
            }
            if (!width) return;
            var pct = ((e.clientX - left) / width) * 100;
            pct = Math.max(0, Math.min(100, pct));
            Player.seekPercent(pct);
        });

        progressWrap.appendChild(_progressBar);

        var timeRow = el('div', { className: 'np-screen-time-row' });
        _timeCurrent = el('div', { className: 'np-screen-time' }, '0:00');
        _timeTotal = el('div', { className: 'np-screen-time' }, '0:00');
        timeRow.appendChild(_timeCurrent);
        timeRow.appendChild(_timeTotal);
        progressWrap.appendChild(timeRow);

        left.appendChild(progressWrap);

        // Transport controls
        var controls = el('div', { className: 'np-screen-controls' });

        _shuffleBtn = el('button', { className: 'np-ctrl-btn np-ctrl-toggle focusable', id: 'np-shuffle' });
        var shuffleSvg = createSvg(SVG_PATHS.shuffle);
        shuffleSvg.style.width = '22px';
        shuffleSvg.style.height = '22px';
        shuffleSvg.style.fill = 'currentColor';
        _shuffleBtn.appendChild(shuffleSvg);
        _shuffleBtn.addEventListener('click', function() { Player.toggleShuffle(); });
        controls.appendChild(_shuffleBtn);

        var prevBtn = el('button', { className: 'np-ctrl-btn focusable', id: 'np-prev' });
        var prevSvg = createSvg(SVG_PATHS.skipPrev);
        prevSvg.style.width = '28px';
        prevSvg.style.height = '28px';
        prevSvg.style.fill = 'currentColor';
        prevBtn.appendChild(prevSvg);
        prevBtn.addEventListener('click', function() { Player.previous(); });
        controls.appendChild(prevBtn);

        _playBtn = el('button', { className: 'np-ctrl-play focusable', id: 'np-play' });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = '22px';
        playIcon.style.height = '22px';
        _playBtn.appendChild(playIcon);
        _playBtn.addEventListener('click', function() { Player.togglePlayPause(); });
        controls.appendChild(_playBtn);

        var nextBtn = el('button', { className: 'np-ctrl-btn focusable', id: 'np-next' });
        var nextSvg = createSvg(SVG_PATHS.skipNext);
        nextSvg.style.width = '28px';
        nextSvg.style.height = '28px';
        nextSvg.style.fill = 'currentColor';
        nextBtn.appendChild(nextSvg);
        nextBtn.addEventListener('click', function() { Player.next(); });
        controls.appendChild(nextBtn);

        _repeatBtn = el('button', { className: 'np-ctrl-btn np-ctrl-toggle focusable', id: 'np-repeat' });
        var repeatSvg = createSvg('M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z');
        repeatSvg.style.width = '22px';
        repeatSvg.style.height = '22px';
        repeatSvg.style.fill = 'currentColor';
        _repeatBtn.appendChild(repeatSvg);
        _repeatBtn.addEventListener('click', function() { Player.toggleRepeat(); });
        controls.appendChild(_repeatBtn);

        _starBtn = el('button', { className: 'np-ctrl-btn np-ctrl-star focusable', id: 'np-star' });
        _starBtn.addEventListener('click', function() {
            var track = Player.getState().currentTrack;
            var api = AuthManager.getApi();
            if (!track || !api) return;
            var nowStarred = StarredCache.toggleSong(track.id, api);
            _updateStar(nowStarred);
            App.showToast(nowStarred ? 'Added to favourites' : 'Removed from favourites');
        });
        controls.appendChild(_starBtn);

        // Lyrics button (P14b) — last in the row
        _lyricsBtn = el('button', {
            className: 'np-ctrl-btn np-ctrl-lyrics focusable is-unavailable',
            id: 'np-lyrics'
        });
        var lyricsSvg = createSvg('M3 5h14M3 9h10M3 13h12M3 17h8');
        lyricsSvg.style.width = '24px';
        lyricsSvg.style.height = '24px';
        var lyricsPath = lyricsSvg.querySelector('path');
        if (lyricsPath) {
            lyricsPath.setAttribute('stroke', 'currentColor');
            lyricsPath.setAttribute('stroke-width', '2');
            lyricsPath.setAttribute('stroke-linecap', 'round');
            lyricsPath.setAttribute('fill', 'none');
        }
        lyricsSvg.setAttribute('fill', 'none');
        _lyricsBtn.appendChild(lyricsSvg);
        _lyricsBtn.addEventListener('click', _toggleLyrics);
        controls.appendChild(_lyricsBtn);

        left.appendChild(controls);

        _layoutEl.appendChild(left);

        // Lyrics panel (P14b) — V3-6-fix4 PERF-3: outer panel only on the
        // synchronous render path. Inner wrapper + lines container are built
        // in a rAF below so the screen can paint and become interactive
        // before any lyrics-side DOM work runs. _ensureLyricsPanelInner()
        // synchronously back-fills if the user toggles lyrics ON first.
        _lyricsPanel = el('div', { className: 'np-lyrics-panel' });
        _layoutEl.appendChild(_lyricsPanel);

        wrapper.appendChild(_layoutEl);
        container.appendChild(wrapper);

        _lyricsBuildRaf = requestAnimationFrame(function() {
            _lyricsBuildRaf = null;
            _ensureLyricsPanelInner();
        });

        log('NowPlaying', 'Now Playing screen rendered');
    }

    function _ensureLyricsPanelInner() {
        if (!_lyricsPanel || _lyricsWrapper) return;
        _lyricsWrapper = el('div', { className: 'np-lyrics-scroll-wrapper' });
        _lyricsLinesEl = el('div', { className: 'np-lyrics-lines' });
        _lyricsWrapper.appendChild(_lyricsLinesEl);
        _lyricsPanel.appendChild(_lyricsWrapper);
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;

        var pState = Player.getState();
        if (pState.currentTrack) {
            _updateTrack(pState.currentTrack);
            // V3-6-fix4 PERF-1: defer lyrics off the open critical path.
            // Cache hit applies synchronously; cache miss schedules a fetch
            // for the next idle window so first paint + focus aren't blocked.
            _scheduleLyricsForTrack(pState.currentTrack);
        }
        _updateProgress(pState.currentTime, pState.duration);
        _updatePlayIcon(pState.isPlaying);
        _updateShuffle(pState.shuffle);
        _updateRepeat(pState.repeat);
        _updateStar(pState.currentTrack && StarredCache.isSongStarred(pState.currentTrack.id));

        Player.on('trackchange', _onTrackChange);
        Player.on('progress', _onProgress);
        Player.on('play', _onPlay);
        Player.on('pause', _onPause);
        Player.on('shufflechange', _onShuffleChange);
        Player.on('repeatchange', _onRepeatChange);
        Player.on('seeked', _onSeeked);

        _registerFocusZones();
        // V3-6-fix5 FIX-2: defer the focus flip past navigateTo()'s
        // wasInTopNav re-grab (app.js) and force=true to bypass the
        // topnav guard inside FocusManager. By the time this rAF fires,
        // the np-controls zone is registered, the DOM is mounted, and
        // any earlier focus calls from the navigation pass have settled.
        if (_initialFocusRaf !== null) cancelAnimationFrame(_initialFocusRaf);
        _initialFocusRaf = requestAnimationFrame(function() {
            _initialFocusRaf = null;
            if (!_active) return;
            // V3.7-fix29 Bug 3: don't yank focus out of the top nav. If
            // the user arrived via a top-nav slide (or pressed Up to
            // return), let them stay on the nav pill. The Down handler /
            // 5 s auto-hide drops focus into np-controls when the user
            // is ready.
            if (FocusManager.getActiveZone() === 'topnav') return;
            // Cold-open from the now-playing-bar / track-play / Auto-NP
            // setting: focus stays here, on the play button.
            FocusManager.setActiveZone('np-controls', 2, true);
        });

        // V3-6-fix4 PERF-6 / V3.7-fix15: measure the progress bar once
        // after layout settles. _updateProgress reuses the cached width;
        // the click-to-seek handler reuses the cached left + width.
        _progressBarWidth = 0;
        _progressBarLeft = 0;
        if (_progressMeasureRaf !== null) cancelAnimationFrame(_progressMeasureRaf);
        _progressMeasureRaf = requestAnimationFrame(function() {
            _progressMeasureRaf = null;
            if (_progressBar) {
                var r = _progressBar.getBoundingClientRect();
                _progressBarWidth = r.width || 0;
                _progressBarLeft = r.left || 0;
            }
        });
        if (!_progressResizeBound) {
            // V3.7-fix15: debounce the resize re-measure so a drag-resize
            // doesn't thrash layout reads.
            var resizeTimer = null;
            _progressResizeBound = function() {
                if (resizeTimer) clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function() {
                    resizeTimer = null;
                    if (_progressBar) {
                        var r2 = _progressBar.getBoundingClientRect();
                        _progressBarWidth = r2.width || 0;
                        _progressBarLeft = r2.left || 0;
                    } else {
                        _progressBarWidth = 0;
                        _progressBarLeft = 0;
                    }
                }, 120);
            };
            window.addEventListener('resize', _progressResizeBound);
        }
    }

    function _registerFocusZones() {
        // V3-6-fix5 FIX-2: the duplicate 'content' zone (same selector as
        // 'np-controls') was removed. _getPageFirstZone() in app.js falls
        // through to 'np-controls' for NP, so Down-from-topnav and the
        // nav-auto-hide drop both still resolve correctly.
        // NP screen is fullbleed with the top nav hidden — Up/Left do not escape.
        // V3.7-fix29 Bug 1: keep the zone shape stable (constant selector +
        // columns: 7) so the lyrics button is always reachable regardless
        // of whether the current track has lyrics. The is-unavailable
        // class is visual only; the click handler treats it as a no-op.
        FocusManager.registerZone('np-controls', {
            selector: '.np-screen-controls .focusable',
            columns: 7,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                up: 'np-progress'
            }
        });

        FocusManager.registerZone('np-progress', {
            selector: '#np-progress-bar',
            columns: 1,
            onActivate: function() {},
            onFocus: function() {},
            onKey: function(direction) {
                if (direction === 'left' || direction === 'right') {
                    var delta = (direction === 'right') ? 10 : -10;
                    var pState = Player.getState();
                    Player.seekTo(Math.max(0, pState.currentTime + delta));
                    return true;
                }
                return false;
            },
            neighbors: {
                down: 'np-controls'
            }
        });
    }

    // =========================================
    //  Event Handlers
    // =========================================

    function _onTrackChange(track) {
        if (!_active) return;
        _updateTrack(track);
        _updateStar(track && StarredCache.isSongStarred(track.id));
        _scheduleLyricsForTrack(track);
    }

    function _onProgress(data) {
        if (!_active) return;
        _updateProgress(data.currentTime, data.duration);
        if (_lyricsVisible && _currentLyrics && _currentLyrics.synced) {
            LyricsScroller.update(data.currentTime * 1000);
        }
    }

    function _onSeeked(currentTime) {
        if (!_active) return;
        if (_lyricsVisible && _currentLyrics && _currentLyrics.synced) {
            LyricsScroller.jumpTo(currentTime * 1000);
        }
    }

    function _onPlay() {
        if (!_active) return;
        _updatePlayIcon(true);
    }

    function _onPause() {
        if (!_active) return;
        _updatePlayIcon(false);
    }

    function _onShuffleChange(val) {
        if (!_active) return;
        _updateShuffle(val);
    }

    function _onRepeatChange(val) {
        if (!_active) return;
        _updateRepeat(val);
    }

    // =========================================
    //  Lyrics
    // =========================================

    // V3-6-fix4 PERF-1: synchronous cache lookup + post-paint idle fetch on
    // miss. Called from activate() / trackchange instead of
    // _ensureLyricsForTrack so the screen-open critical path never blocks
    // on getLyricsBySongId. rAF + rIC chain: the rAF callback runs at the
    // top of the next frame (so first paint is complete), then rIC defers
    // the network request to browser idle time.
    function _scheduleLyricsForTrack(track) {
        _cancelLyricsDefer();

        if (!track || !track.id) {
            _currentLyrics = null;
            _updateLyricsUI();
            return;
        }
        var songId = track.id;

        // Cache hit: apply synchronously (warm-open path).
        if (_lyricsCache.hasOwnProperty(songId)) {
            _currentLyrics = _lyricsCache[songId];
            _updateLyricsUI();
            return;
        }

        // Cache miss: clear current state, schedule the network fetch for
        // when the main thread is idle. The screen has already painted by then.
        _currentLyrics = null;
        _updateLyricsUI();

        _lyricsRaf = requestAnimationFrame(function() {
            _lyricsRaf = null;
            if (!_active) return;
            _lyricsIdleHandle = _ric(function() {
                _lyricsIdleHandle = null;
                if (!_active) return;
                var ps = Player.getState();
                if (!ps.currentTrack || ps.currentTrack.id !== songId) return;
                _ensureLyricsForTrack(ps.currentTrack);
            });
        });
    }

    function _ensureLyricsForTrack(track) {
        if (!track || !track.id) {
            _currentLyrics = null;
            _updateLyricsUI();
            return;
        }
        var songId = track.id;

        if (_lyricsCache.hasOwnProperty(songId)) {
            _currentLyrics = _lyricsCache[songId];
            _updateLyricsUI();
            return;
        }

        if (_pendingFetches[songId]) {
            _currentLyrics = null;
            _updateLyricsUI();
            return;
        }

        _currentLyrics = null;
        _updateLyricsUI();

        var api = AuthManager.getApi();
        if (!api) return;
        _pendingFetches[songId] = true;
        api.getLyricsBySongId(songId).then(function(response) {
            delete _pendingFetches[songId];
            var parsed = parseLyricsResponse(response);
            _lyricsCache[songId] = parsed;
            if (!_active) return;
            var ps = Player.getState();
            if (ps.currentTrack && ps.currentTrack.id === songId) {
                _currentLyrics = parsed;
                _updateLyricsUI();
            }
        }).catch(function(err) {
            delete _pendingFetches[songId];
            _lyricsCache[songId] = null;
            warn('NowPlaying', 'Lyrics fetch failed for ' + songId + ': ' + err.message);
            if (!_active) return;
            var ps = Player.getState();
            if (ps.currentTrack && ps.currentTrack.id === songId) {
                _currentLyrics = null;
                _updateLyricsUI();
            }
        });
    }

    function _updateLyricsUI() {
        if (!_lyricsBtn) return;

        var available = !!(_currentLyrics && _currentLyrics.line && _currentLyrics.line.length);

        // V3.7-fix29 Bug 2: is-unavailable is visual only. _lyricsVisible
        // (the user's intent: panel open vs closed) is decoupled from the
        // data state and must only flip via _toggleLyrics / _openLyrics /
        // _closeLyrics in response to user input. Track changes no longer
        // close the panel.
        if (available) {
            _lyricsBtn.classList.remove('is-unavailable');
        } else {
            _lyricsBtn.classList.add('is-unavailable');
        }

        if (_lyricsVisible && available) {
            _ensureLyricsPanelInner();
            LyricsScroller.init(_lyricsWrapper, _lyricsLinesEl, _currentLyrics);
            var ps = Player.getState();
            if (_currentLyrics.synced) {
                LyricsScroller.update((ps.currentTime || 0) * 1000);
            }
        } else if (_lyricsVisible && !available) {
            // Panel still open but the new track has no lyrics — empty
            // the lines so the previous track's content doesn't linger.
            // _onProgress / _onSeeked guard with `_currentLyrics &&` so
            // they're already safe in this state.
            _ensureLyricsPanelInner();
            LyricsScroller.reset();
        }

        if (_active) _registerFocusZones();
    }

    function _toggleLyrics() {
        // V3.7-fix29 Bug 1: clicks/Enter while the button is visually
        // disabled (no lyrics for the current track) are a no-op. The
        // button stays focusable so the user can pass Right through it,
        // but pressing it must not flip _lyricsVisible.
        if (_lyricsBtn && _lyricsBtn.classList.contains('is-unavailable')) return;
        if (_lyricsVisible) {
            _closeLyrics();
        } else {
            _openLyrics();
        }
    }

    // V3-6-fix4 PERF-4: replaces the static will-change declarations on
    // .np-left, .np-lyrics-panel, .np-lyrics-lines. Set just before the
    // class flip kicks off the transition; cleared 300ms later (after
    // the 250ms slide settles) so the GPU layers don't stay reserved.
    function _enableLyricsCompositingHints() {
        if (_willChangeClearTimer !== null) {
            clearTimeout(_willChangeClearTimer);
            _willChangeClearTimer = null;
        }
        if (_leftEl) _leftEl.style.willChange = 'transform';
        if (_lyricsPanel) _lyricsPanel.style.willChange = 'transform, opacity';
        if (_lyricsLinesEl) _lyricsLinesEl.style.willChange = 'transform';
    }

    function _scheduleClearLyricsCompositingHints() {
        if (_willChangeClearTimer !== null) {
            clearTimeout(_willChangeClearTimer);
        }
        _willChangeClearTimer = setTimeout(function() {
            _willChangeClearTimer = null;
            if (_leftEl) _leftEl.style.willChange = '';
            if (_lyricsPanel) _lyricsPanel.style.willChange = '';
            if (_lyricsLinesEl) _lyricsLinesEl.style.willChange = '';
        }, 300);
    }

    function _openLyrics() {
        if (!_currentLyrics || !_currentLyrics.line || !_currentLyrics.line.length) return;
        _ensureLyricsPanelInner();
        _enableLyricsCompositingHints();
        _lyricsVisible = true;
        _layoutEl.classList.add('lyrics-active');
        _lyricsBtn.classList.add('is-active');
        LyricsScroller.init(_lyricsWrapper, _lyricsLinesEl, _currentLyrics);
        var ps = Player.getState();
        if (_currentLyrics.synced) {
            setTimeout(function() {
                LyricsScroller.update((ps.currentTime || 0) * 1000);
            }, 50);
        }
    }

    function _closeLyrics() {
        _lyricsVisible = false;
        _enableLyricsCompositingHints(); // hold hints through the close slide
        if (_layoutEl) _layoutEl.classList.remove('lyrics-active');
        if (_lyricsBtn) _lyricsBtn.classList.remove('is-active');
        LyricsScroller.reset();
        _scheduleClearLyricsCompositingHints();
    }

    // =========================================
    //  UI Update Functions
    // =========================================

    // V3.7-fix19: show/hide a single placeholder element rather than
    // rebuilding the cover container on every error/no-art frame.
    function _showArtPlaceholder(track) {
        if (!_artImg) return;
        if (_artImgEl) _artImgEl.style.display = 'none';
        if (!_artPlaceholderEl) {
            _artPlaceholderEl = document.createElement('div');
            _artPlaceholderEl.className = 'np-art-placeholder';
            _artPlaceholderEl.style.width = '100%';
            _artPlaceholderEl.style.height = '100%';
            _artImg.appendChild(_artPlaceholderEl);
        }
        // Re-skin the placeholder in place (avoid swapping nodes).
        while (_artPlaceholderEl.firstChild) {
            _artPlaceholderEl.removeChild(_artPlaceholderEl.firstChild);
        }
        if (track) {
            var ph = SonanceComponents.renderAlbumArt(track, 280, null);
            _artPlaceholderEl.appendChild(ph);
        }
        _artPlaceholderEl.style.display = '';
    }

    function _hideArtPlaceholder() {
        if (_artPlaceholderEl) _artPlaceholderEl.style.display = 'none';
    }

    function _updateTrack(track) {
        if (!track) return;

        if (_titleEl) _titleEl.textContent = track.title || 'Unknown';
        if (_subtitleEl) {
            var parts = [];
            if (track.artist) parts.push(track.artist);
            if (track.album) parts.push(track.album);
            _subtitleEl.textContent = parts.join(' — ') || 'Unknown';
        }

        // V3.7-fix19: mutate the persistent <img> src in place rather than
        // tearing down and rebuilding the cover container.
        if (_artImg) {
            var api = AuthManager.getApi();
            var npCover = track.coverArt || track.albumId;
            if (api && npCover && _artImgEl) {
                _hideArtPlaceholder();
                _artImgEl.style.display = '';
                // Pull through cache so re-opening NP for the same track
                // is instant (warm hit), or kick off a fresh fetch.
                _artImgEl.src = ImageCache.getUrl(npCover, 600);
            } else {
                _showArtPlaceholder(track);
            }
        }

        if (_bgEl) {
            var api2 = AuthManager.getApi();
            if (api2 && (track.coverArt || track.albumId)) {
                // V3-5 perf: 60px source image upscaled + blur(30px) is
                // visually equivalent to 600px + blur(100px) at a fraction
                // of the cost. URL routed through ImageCache so it doesn't
                // refetch when the user opens NP for the same track twice.
                _bgEl.style.backgroundImage = 'url(' + ImageCache.getUrl(track.coverArt || track.albumId, 100) + ')';
            } else {
                var colors = SonanceComponents.hashColor(track.album || track.title || 'unknown');
                _bgEl.style.backgroundImage = 'none';
                _bgEl.style.background = 'radial-gradient(ellipse at center, ' +
                    colors.base + ' 0%, ' + colors.dark + ' 50%, var(--bg-primary) 100%)';
            }
        }
    }

    function _updateProgress(currentTime, duration) {
        var pct = (duration > 0) ? (currentTime / duration) * 100 : 0;

        if (_progressFill) {
            _progressFill.style.setProperty('--progress', (pct / 100).toString());
        }
        if (_progressScrubber && _progressBar) {
            // V3-6-fix4 PERF-6: cached width; fall back to a live read
            // only on the very first tick before the rAF measure lands.
            var trackW = _progressBarWidth;
            if (!trackW) {
                trackW = _progressBar.getBoundingClientRect().width;
                _progressBarWidth = trackW;
            }
            _progressScrubber.style.setProperty('--scrub-x', ((pct / 100) * trackW) + 'px');
        }
        if (_timeCurrent) _timeCurrent.textContent = formatDuration(currentTime);
        if (_timeTotal) _timeTotal.textContent = formatDuration(duration);
    }

    function _updatePlayIcon(isPlaying) {
        if (!_playBtn) return;
        _clearNode(_playBtn);
        var icon = createSvg(isPlaying ? SVG_PATHS.pause : SVG_PATHS.play);
        icon.style.width = '22px';
        icon.style.height = '22px';
        _playBtn.appendChild(icon);
    }

    function _updateShuffle(active) {
        if (!_shuffleBtn) return;
        if (active) {
            _shuffleBtn.classList.add('active');
        } else {
            _shuffleBtn.classList.remove('active');
        }
    }

    function _updateStar(starred) {
        if (!_starBtn) return;
        _clearNode(_starBtn);
        var icon = createStarSvg(!!starred);
        icon.style.width = '20px';
        icon.style.height = '20px';
        _starBtn.appendChild(icon);
        if (starred) {
            _starBtn.classList.add('is-starred');
        } else {
            _starBtn.classList.remove('is-starred');
        }
    }

    function _updateRepeat(mode) {
        if (!_repeatBtn) return;
        _clearNode(_repeatBtn);

        var svgPath = 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z';
        var repeatSvg = createSvg(svgPath);
        repeatSvg.style.width = '22px';
        repeatSvg.style.height = '22px';
        repeatSvg.style.fill = 'currentColor';
        _repeatBtn.appendChild(repeatSvg);

        if (mode === 'none') {
            _repeatBtn.classList.remove('active');
        } else {
            _repeatBtn.classList.add('active');
        }

        if (mode === 'one') {
            var badge = el('span', { className: 'np-repeat-badge' }, '1');
            _repeatBtn.appendChild(badge);
        }
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;

        _cancelLyricsDefer();

        // V3-6-fix5 FIX-2: drop a still-pending initial-focus rAF so we
        // don't yank focus into a zone that's about to be unregistered.
        if (_initialFocusRaf !== null) {
            cancelAnimationFrame(_initialFocusRaf);
            _initialFocusRaf = null;
        }

        if (_lyricsBuildRaf !== null) {
            cancelAnimationFrame(_lyricsBuildRaf);
            _lyricsBuildRaf = null;
        }

        if (_willChangeClearTimer !== null) {
            clearTimeout(_willChangeClearTimer);
            _willChangeClearTimer = null;
        }

        if (_progressMeasureRaf !== null) {
            cancelAnimationFrame(_progressMeasureRaf);
            _progressMeasureRaf = null;
        }
        if (_progressResizeBound) {
            window.removeEventListener('resize', _progressResizeBound);
            _progressResizeBound = null;
        }
        _progressBarWidth = 0;
        _progressBarLeft = 0;

        Player.off('trackchange', _onTrackChange);
        Player.off('progress', _onProgress);
        Player.off('play', _onPlay);
        Player.off('pause', _onPause);
        Player.off('shufflechange', _onShuffleChange);
        Player.off('repeatchange', _onRepeatChange);
        Player.off('seeked', _onSeeked);

        if (_layoutEl) _layoutEl.classList.remove('lyrics-active');
        _lyricsVisible = false;
        LyricsScroller.destroy();

        _container = null;
        _artImg = null;
        // V3.7-fix19: drop persistent <img> + placeholder refs.
        if (_artImgEl) {
            // Releasing the bitmap by clearing src lets the browser GC the
            // decoded image when NP is closed; on re-open the new track
            // will set src again.
            _artImgEl.src = '';
        }
        _artImgEl = null;
        _artPlaceholderEl = null;
        _titleEl = null;
        _subtitleEl = null;
        _progressFill = null;
        _progressScrubber = null;
        _timeCurrent = null;
        _timeTotal = null;
        _playBtn = null;
        _shuffleBtn = null;
        _repeatBtn = null;
        _starBtn = null;
        _lyricsBtn = null;
        _bgEl = null;
        _progressBar = null;
        _layoutEl = null;
        _leftEl = null;
        _lyricsPanel = null;
        _lyricsWrapper = null;
        _lyricsLinesEl = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
