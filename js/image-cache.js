/* ============================================
   Sonance — Image Cache + Lazy Loader (V3-6)
   In-memory cover-art cache and IntersectionObserver-based
   lazy loading. The TV's HTTP cache evicts album art aggressively;
   this module holds decoded URLs in memory for the session so that
   navigating Library/Home back and forth does NOT refetch art.
   ============================================ */

/* global SonanceUtils */

var ImageCache = (function() {
    'use strict';

    var log = (typeof SonanceUtils !== 'undefined' && SonanceUtils.log)
        ? SonanceUtils.log
        : function() {};

    var _cache = {};      // key → { img: Image, url: string, loaded: boolean }
    var _loading = {};    // key → [callback, callback, ...]
    var _keys = [];       // LRU order tracking
    var MAX_SIZE = 500;

    function _getApi() {
        // App.getApi is added in app.js — fall back to AuthManager during boot.
        if (typeof App !== 'undefined' && App.getApi) {
            var a = App.getApi();
            if (a) return a;
        }
        if (typeof AuthManager !== 'undefined' && AuthManager.getApi) {
            return AuthManager.getApi();
        }
        return null;
    }

    function _touchKey(key) {
        var idx = _keys.indexOf(key);
        if (idx > -1) _keys.splice(idx, 1);
        _keys.push(key);
    }

    function _addKey(key) {
        _keys.push(key);
        while (_keys.length > MAX_SIZE) {
            var oldest = _keys.shift();
            delete _cache[oldest];
        }
    }

    /**
     * Get a cached image URL or trigger loading.
     * @param {string} coverArtId - Subsonic cover art ID
     * @param {number} size       - requested image pixel size
     * @param {function} onLoad   - callback(url) when ready (optional)
     * @returns {string|null}     - cached URL if already available, else null
     */
    function get(coverArtId, size, onLoad) {
        if (!coverArtId) return null;

        var key = coverArtId + '_' + size;

        // Already cached and loaded
        if (_cache[key] && _cache[key].loaded) {
            _touchKey(key);
            if (onLoad) onLoad(_cache[key].url);
            return _cache[key].url;
        }

        // Currently loading — queue the callback
        if (_loading[key]) {
            if (onLoad) _loading[key].push(onLoad);
            return null;
        }

        var api = _getApi();
        if (!api) return null;

        // Not cached — start loading
        _loading[key] = onLoad ? [onLoad] : [];
        var url = api.getCoverArtUrl(coverArtId, size);

        var img = new Image();
        img.onload = function() {
            _cache[key] = { img: img, url: url, loaded: true };
            _addKey(key);
            var callbacks = _loading[key] || [];
            delete _loading[key];
            for (var i = 0; i < callbacks.length; i++) {
                try { callbacks[i](url); } catch (e) {}
            }
        };
        img.onerror = function() {
            delete _loading[key];
            // Don't cache errors — allow retry
        };
        img.src = url;

        return null;
    }

    /**
     * Preload a batch of cover art IDs. Fire and forget.
     */
    function preload(coverArtIds, size) {
        if (!coverArtIds) return;
        for (var i = 0; i < coverArtIds.length; i++) {
            if (coverArtIds[i]) get(coverArtIds[i], size, null);
        }
    }

    /**
     * Synchronous URL lookup. Returns the cached URL if available, otherwise
     * a freshly-built URL (which the browser will fetch). Does NOT trigger
     * lazy loading — use get() / LazyLoader for that.
     */
    function getUrl(coverArtId, size) {
        if (!coverArtId) return '';
        var key = coverArtId + '_' + size;
        if (_cache[key] && _cache[key].loaded) {
            _touchKey(key);
            return _cache[key].url;
        }
        var api = _getApi();
        if (!api) return '';
        return api.getCoverArtUrl(coverArtId, size);
    }

    function clear() {
        _cache = {};
        _loading = {};
        _keys = [];
        _urlCache = {};
        _urlLoading = {};
        _urlKeys = [];
        log('ImageCache', 'cleared');
    }

    function size() {
        return _keys.length;
    }

    /* ============================================
       URL-keyed cache (V3-6-fix2 PERF-5)
       Some images are addressed by raw URL rather than Subsonic coverArt
       id — most notably the artist hero photo from Last.fm
       (`info.largeImageUrl`). LRU-capped sibling to the coverArt cache so
       returning to a previously-viewed artist hits the cache instantly.
       ============================================ */
    var _urlCache = {};      // url → { img: Image, loaded: bool }
    var _urlLoading = {};    // url → [callbacks]
    var _urlKeys = [];

    function _touchUrlKey(k) {
        var i = _urlKeys.indexOf(k);
        if (i > -1) _urlKeys.splice(i, 1);
        _urlKeys.push(k);
    }

    function _addUrlKey(k) {
        _urlKeys.push(k);
        while (_urlKeys.length > MAX_SIZE) {
            var oldest = _urlKeys.shift();
            delete _urlCache[oldest];
        }
    }

    /**
     * Get a cached image by raw URL or trigger loading.
     * @param {string} url      - the absolute URL of the image
     * @param {function} onLoad - callback(url) when ready (optional)
     * @returns {string|null}   - the URL if already cached, else null
     */
    function getByUrl(url, onLoad) {
        if (!url) return null;

        if (_urlCache[url] && _urlCache[url].loaded) {
            _touchUrlKey(url);
            if (onLoad) onLoad(url);
            return url;
        }

        if (_urlLoading[url]) {
            if (onLoad) _urlLoading[url].push(onLoad);
            return null;
        }

        _urlLoading[url] = onLoad ? [onLoad] : [];
        var img = new Image();
        img.onload = function() {
            _urlCache[url] = { img: img, loaded: true };
            _addUrlKey(url);
            var cbs = _urlLoading[url] || [];
            delete _urlLoading[url];
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](url); } catch (e) {}
            }
        };
        img.onerror = function() {
            delete _urlLoading[url];
            // Don't cache errors — allow retry
        };
        img.src = url;
        return null;
    }

    return {
        get: get,
        preload: preload,
        getUrl: getUrl,
        getByUrl: getByUrl,
        clear: clear,
        size: size
    };
})();

/* ============================================
   LazyLoader
   IntersectionObserver-based image loader.
   Cards render with a placeholder. As they scroll into view (with a 200px
   buffer) the observer kicks off the cache fetch; when the image is ready
   the `loaded` class triggers the GPU-friendly opacity fade-in.
   ============================================ */

var LazyLoader = (function() {
    'use strict';

    var log = (typeof SonanceUtils !== 'undefined' && SonanceUtils.log)
        ? SonanceUtils.log
        : function() {};

    var _observer = null;

    function _onIntersect(entries) {
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry.isIntersecting) continue;
            var img = entry.target;
            _loadImage(img);
            _observer.unobserve(img);
        }
    }

    function _loadImage(img) {
        var coverArtId = img.getAttribute('data-coverart');
        var sizeAttr = img.getAttribute('data-size');
        var size = parseInt(sizeAttr, 10) || 300;
        if (!coverArtId) return;

        var cachedUrl = ImageCache.get(coverArtId, size, function(url) {
            // Defensive: img may have been removed by re-render
            if (!img || !img.parentNode) return;
            img.src = url;
            img.classList.add('loaded');
        });
        if (cachedUrl) {
            img.src = cachedUrl;
            img.classList.add('loaded');
        }
    }

    function init() {
        if (typeof IntersectionObserver === 'undefined') {
            console.warn('[Sonance][LazyLoader] IntersectionObserver not available — eager loading');
            _observer = null;
            return;
        }
        _observer = new IntersectionObserver(_onIntersect, {
            root: null,
            rootMargin: '200px 0px',
            threshold: 0.01
        });
        log('LazyLoader', 'initialized');
    }

    /**
     * Register an <img> element for lazy loading.
     * The element must have data-coverart and data-size attributes set.
     */
    function observe(img) {
        if (!img) return;
        if (_observer) {
            _observer.observe(img);
        } else {
            // Fallback: load immediately (no IntersectionObserver)
            _loadImage(img);
        }
    }

    /**
     * Force-load now, regardless of viewport visibility. Used for above-the-fold
     * elements like the Now Playing bar where we never want a placeholder shown.
     */
    function forceLoad(img) {
        if (!img) return;
        if (_observer) _observer.unobserve(img);
        _loadImage(img);
    }

    function disconnect() {
        if (_observer) _observer.disconnect();
    }

    return {
        init: init,
        observe: observe,
        forceLoad: forceLoad,
        disconnect: disconnect
    };
})();
