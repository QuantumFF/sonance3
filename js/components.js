/* ============================================
   Sonance — Reusable UI Components
   Album art, artist avatars, loading skeletons
   ============================================ */

var SonanceComponents = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var NS = 'http://www.w3.org/2000/svg';

    // =========================================
    //  Colour Generation
    // =========================================

    /**
     * Generate a consistent HSL colour from a string.
     * Returns { hue, base, light, dark } for gradient use.
     */
    function hashColor(str) {
        if (!str) str = 'unknown';
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        var hue = Math.abs(hash % 360);
        return {
            hue: hue,
            base: 'hsl(' + hue + ', 45%, 30%)',
            light: 'hsl(' + hue + ', 50%, 40%)',
            dark: 'hsl(' + ((hue + 40) % 360) + ', 40%, 18%)'
        };
    }

    // =========================================
    //  SVG Placeholders
    // =========================================

    /** Vinyl record icon — concentric circles for album placeholder */
    function _createVinylSvg() {
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.style.width = '45%';
        svg.style.height = '45%';
        svg.style.opacity = '0.25';

        var radii = [42, 34, 26, 8];
        radii.forEach(function(r) {
            var c = document.createElementNS(NS, 'circle');
            c.setAttribute('cx', '50');
            c.setAttribute('cy', '50');
            c.setAttribute('r', String(r));
            c.setAttribute('fill', 'none');
            c.setAttribute('stroke', 'white');
            c.setAttribute('stroke-width', '1.5');
            svg.appendChild(c);
        });

        // Centre dot
        var dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', '50');
        dot.setAttribute('cy', '50');
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', 'white');
        svg.appendChild(dot);

        return svg;
    }

    /** Person silhouette icon for artist placeholder */
    function _createPersonSvg() {
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.style.width = '45%';
        svg.style.height = '45%';
        svg.style.opacity = '0.3';
        svg.style.fill = 'white';

        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z');
        svg.appendChild(path);

        return svg;
    }

    // =========================================
    //  Album Art Component
    // =========================================

    /**
     * Render album art with lazy loading and error fallback.
     * @param {Object} album  - Album object with coverArt, name, artist fields
     * @param {number} size   - Pixel size (0 = fill parent via CSS)
     * @param {Object} api    - SubsonicAPI instance (used as a "has API" check)
     */
    function renderAlbumArt(album, size, api) {
        var fillMode = (size === 0);
        var container = el('div', { className: fillMode ? 'album-art album-art-fill' : 'album-art' });

        if (!fillMode) {
            container.style.width = size + 'px';
            container.style.height = size + 'px';
            container.style.flexShrink = '0';
        }
        container.style.borderRadius = (size > 100 || fillMode) ? '10px' : '6px';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';

        // V3-6: image sizes per perf brief.
        // - grid cards (fillMode):  300
        // - small thumbs (≤80):     100  (queue 44, search 52, library album 80)
        // - home cards (≤180):      300  (home album cards 162)
        // - detail panels (≤220):   500  (album detail 180, artist detail 200)
        // - NP large art (>220):    600  (now-playing screen 280)
        var requestSize;
        if (fillMode) requestSize = 300;
        else if (size <= 80) requestSize = 100;
        else if (size <= 180) requestSize = 300;
        else if (size <= 220) requestSize = 500;
        else requestSize = 600;

        var coverArtId = album && album.coverArt;

        // Always render the placeholder underneath. Once the image loads it
        // fades in over the placeholder via CSS opacity transition.
        var ph = _albumPlaceholder(album);
        if (fillMode) {
            ph.style.position = 'absolute';
            ph.style.top = '0';
            ph.style.left = '0';
        }
        container.appendChild(ph);

        if (coverArtId && api) {
            var img = document.createElement('img');
            img.className = 'lazy-art';
            img.setAttribute('alt', (album.name || album.title || 'Album') + ' cover');
            img.setAttribute('data-coverart', coverArtId);
            img.setAttribute('data-size', String(requestSize));
            img.style.position = 'absolute';
            img.style.top = '0';
            img.style.left = '0';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.display = 'block';

            img.onerror = function() {
                if (img.parentNode) img.parentNode.removeChild(img);
            };

            container.appendChild(img);

            // Hand off to LazyLoader. It will set src + 'loaded' class
            // when the image enters the viewport (or immediately if already
            // cached / no IntersectionObserver).
            if (typeof LazyLoader !== 'undefined') {
                LazyLoader.observe(img);
            } else {
                img.src = ImageCache.getUrl(coverArtId, requestSize);
                img.classList.add('loaded');
            }
        }

        return container;
    }

    function _albumPlaceholder(album) {
        var name = (album && (album.name || album.title || album.artist)) || 'Unknown';
        var colors = hashColor(name);

        var div = el('div', { className: 'art-placeholder' });
        div.style.width = '100%';
        div.style.height = '100%';
        div.style.background = 'linear-gradient(135deg, ' + colors.base + ', ' + colors.dark + ')';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.borderRadius = 'inherit';

        div.appendChild(_createVinylSvg());
        return div;
    }

    // =========================================
    //  Artist Avatar Component
    // =========================================

    /**
     * Render artist avatar (circular) with lazy loading and fallback.
     * @param {Object} artist - Artist object with id, name, coverArt fields
     * @param {number} size   - Pixel diameter
     * @param {Object} api    - SubsonicAPI instance
     */
    function renderArtistAvatar(artist, size, api) {
        var container = el('div', { className: 'artist-avatar' });
        container.style.width = size + 'px';
        container.style.height = size + 'px';
        container.style.borderRadius = '50%';
        container.style.overflow = 'hidden';
        container.style.flexShrink = '0';
        container.style.position = 'relative';

        // V3-6: artist photos
        // - search thumb (≤60):    100
        // - similar / album (≤80): 100
        // - grid avatar (≤120):    300  (library artists 100)
        // - detail (>120):         500  (artist detail 200)
        var requestSize;
        if (size <= 80) requestSize = 100;
        else if (size <= 120) requestSize = 300;
        else requestSize = 500;

        // Placeholder underneath
        var ph = _artistPlaceholder(artist);
        ph.style.position = 'absolute';
        ph.style.top = '0';
        ph.style.left = '0';
        container.appendChild(ph);

        if (api && artist && artist.id) {
            var artId = artist.coverArt || ('ar-' + artist.id);
            var img = document.createElement('img');
            img.className = 'lazy-art';
            img.setAttribute('alt', (artist.name || 'Artist'));
            img.setAttribute('data-coverart', artId);
            img.setAttribute('data-size', String(requestSize));
            img.style.position = 'absolute';
            img.style.top = '0';
            img.style.left = '0';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            img.style.display = 'block';

            img.onerror = function() {
                if (img.parentNode) img.parentNode.removeChild(img);
            };

            container.appendChild(img);

            if (typeof LazyLoader !== 'undefined') {
                LazyLoader.observe(img);
            } else {
                img.src = ImageCache.getUrl(artId, requestSize);
                img.classList.add('loaded');
            }
        }

        return container;
    }

    function _artistPlaceholder(artist) {
        var name = (artist && artist.name) || 'Unknown';
        var colors = hashColor(name);

        var div = el('div', { className: 'art-placeholder' });
        div.style.width = '100%';
        div.style.height = '100%';
        div.style.background = 'linear-gradient(135deg, ' + colors.base + ', ' + colors.dark + ')';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.borderRadius = '50%';

        div.appendChild(_createPersonSvg());
        return div;
    }

    // =========================================
    //  Loading Skeletons
    // =========================================

    /**
     * Render a row of pulsing skeleton placeholder cards.
     */
    function renderSkeletonCards(count, width, height, extraClass) {
        var fragment = document.createDocumentFragment();
        for (var i = 0; i < count; i++) {
            var card = el('div', { className: 'skeleton' + (extraClass ? ' ' + extraClass : '') });
            card.style.width = width + 'px';
            card.style.height = height + 'px';
            card.style.flexShrink = '0';
            card.style.borderRadius = '10px';
            fragment.appendChild(card);
        }
        return fragment;
    }

    // =========================================
    //  Public API
    // =========================================

    return {
        hashColor: hashColor,
        renderAlbumArt: renderAlbumArt,
        renderArtistAvatar: renderArtistAvatar,
        renderSkeletonCards: renderSkeletonCards
    };
})();
