/* ============================================
   Sonance — Utility Module
   ============================================ */

var SonanceUtils = (function() {
    'use strict';

    // --- Console Logger ---
    function log(module, message) {
        console.log('[Sonance][' + module + '] ' + message);
    }

    function warn(module, message) {
        console.warn('[Sonance][' + module + '] ' + message);
    }

    function error(module, message) {
        console.error('[Sonance][' + module + '] ' + message);
    }

    // --- DOM Helpers ---
    function el(tag, attrs) {
        var element = document.createElement(tag);
        var children = Array.prototype.slice.call(arguments, 2);

        if (attrs) {
            Object.keys(attrs).forEach(function(key) {
                if (key === 'className') {
                    element.className = attrs[key];
                } else if (key === 'style' && typeof attrs[key] === 'object') {
                    Object.keys(attrs[key]).forEach(function(prop) {
                        element.style[prop] = attrs[key][prop];
                    });
                } else if (key.indexOf('on') === 0) {
                    var eventName = key.substring(2).toLowerCase();
                    element.addEventListener(eventName, attrs[key]);
                } else {
                    element.setAttribute(key, attrs[key]);
                }
            });
        }

        children.forEach(function(child) {
            if (child === null || child === undefined) return;
            if (typeof child === 'string' || typeof child === 'number') {
                element.appendChild(document.createTextNode(String(child)));
            } else if (child instanceof HTMLElement || child instanceof SVGElement) {
                element.appendChild(child);
            }
        });

        return element;
    }

    function $(selector) {
        return document.querySelector(selector);
    }

    function $$(selector) {
        return document.querySelectorAll(selector);
    }

    // --- SVG Helper (safe DOM creation, no innerHTML) ---
    function createSvg(pathData, viewBox) {
        viewBox = viewBox || '0 0 24 24';
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', viewBox);
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
        return svg;
    }

    // --- Star Icon Helper (outline/filled) ---
    // Uses currentColor for stroke/fill so colour is controlled by CSS.
    var STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';

    function createStarSvg(filled) {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('xmlns', ns);
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', STAR_PATH);
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('fill', filled ? 'currentColor' : 'none');
        svg.appendChild(path);
        return svg;
    }

    // --- SVG Path Data Constants ---
    var SVG_PATHS = {
        musicNote: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
        home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
        grid: 'M3 3h8v8H3V3zm0 10h8v8H3v-8zm10-10h8v8h-8V3zm0 10h8v8h-8v-8z',
        search: 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
        playlist: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
        nowPlaying: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
        queue: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
        settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
        play: 'M8 5v14l11-7z',
        pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
        skipNext: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
        skipPrev: 'M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z',
        volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.47 4.47 0 0 0 2.5-3.5z',
        shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z'
    };

    // --- Generate Random Salt ---
    function generateSalt(length) {
        length = length || 12;
        var chars = '0123456789abcdef';
        var salt = '';
        for (var i = 0; i < length; i++) {
            salt += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return salt;
    }

    // --- Format Duration ---
    function formatDuration(seconds) {
        if (!seconds && seconds !== 0) return '0:00';
        seconds = Math.floor(seconds);
        var mins = Math.floor(seconds / 60);
        var secs = seconds % 60;
        return mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    // --- MD5 Hash ---
    // Lightweight MD5 implementation (based on Joseph Myers' implementation)
    function md5(string) {
        function md5cycle(x, k) {
            var a = x[0], b = x[1], c = x[2], d = x[3];

            a = ff(a, b, c, d, k[0], 7, -680876936);
            d = ff(d, a, b, c, k[1], 12, -389564586);
            c = ff(c, d, a, b, k[2], 17, 606105819);
            b = ff(b, c, d, a, k[3], 22, -1044525330);
            a = ff(a, b, c, d, k[4], 7, -176418897);
            d = ff(d, a, b, c, k[5], 12, 1200080426);
            c = ff(c, d, a, b, k[6], 17, -1473231341);
            b = ff(b, c, d, a, k[7], 22, -45705983);
            a = ff(a, b, c, d, k[8], 7, 1770035416);
            d = ff(d, a, b, c, k[9], 12, -1958414417);
            c = ff(c, d, a, b, k[10], 17, -42063);
            b = ff(b, c, d, a, k[11], 22, -1990404162);
            a = ff(a, b, c, d, k[12], 7, 1804603682);
            d = ff(d, a, b, c, k[13], 12, -40341101);
            c = ff(c, d, a, b, k[14], 17, -1502002290);
            b = ff(b, c, d, a, k[15], 22, 1236535329);

            a = gg(a, b, c, d, k[1], 5, -165796510);
            d = gg(d, a, b, c, k[6], 9, -1069501632);
            c = gg(c, d, a, b, k[11], 14, 643717713);
            b = gg(b, c, d, a, k[0], 20, -373897302);
            a = gg(a, b, c, d, k[5], 5, -701558691);
            d = gg(d, a, b, c, k[10], 9, 38016083);
            c = gg(c, d, a, b, k[15], 14, -660478335);
            b = gg(b, c, d, a, k[4], 20, -405537848);
            a = gg(a, b, c, d, k[9], 5, 568446438);
            d = gg(d, a, b, c, k[14], 9, -1019803690);
            c = gg(c, d, a, b, k[3], 14, -187363961);
            b = gg(b, c, d, a, k[8], 20, 1163531501);
            a = gg(a, b, c, d, k[13], 5, -1444681467);
            d = gg(d, a, b, c, k[2], 9, -51403784);
            c = gg(c, d, a, b, k[7], 14, 1735328473);
            b = gg(b, c, d, a, k[12], 20, -1926607734);

            a = hh(a, b, c, d, k[5], 4, -378558);
            d = hh(d, a, b, c, k[8], 11, -2022574463);
            c = hh(c, d, a, b, k[11], 16, 1839030562);
            b = hh(b, c, d, a, k[14], 23, -35309556);
            a = hh(a, b, c, d, k[1], 4, -1530992060);
            d = hh(d, a, b, c, k[4], 11, 1272893353);
            c = hh(c, d, a, b, k[7], 16, -155497632);
            b = hh(b, c, d, a, k[10], 23, -1094730640);
            a = hh(a, b, c, d, k[13], 4, 681279174);
            d = hh(d, a, b, c, k[0], 11, -358537222);
            c = hh(c, d, a, b, k[3], 16, -722521979);
            b = hh(b, c, d, a, k[6], 23, 76029189);
            a = hh(a, b, c, d, k[9], 4, -640364487);
            d = hh(d, a, b, c, k[12], 11, -421815835);
            c = hh(c, d, a, b, k[15], 16, 530742520);
            b = hh(b, c, d, a, k[2], 23, -995338651);

            a = ii(a, b, c, d, k[0], 6, -198630844);
            d = ii(d, a, b, c, k[7], 10, 1126891415);
            c = ii(c, d, a, b, k[14], 15, -1416354905);
            b = ii(b, c, d, a, k[5], 21, -57434055);
            a = ii(a, b, c, d, k[12], 6, 1700485571);
            d = ii(d, a, b, c, k[3], 10, -1894986606);
            c = ii(c, d, a, b, k[10], 15, -1051523);
            b = ii(b, c, d, a, k[1], 21, -2054922799);
            a = ii(a, b, c, d, k[8], 6, 1873313359);
            d = ii(d, a, b, c, k[15], 10, -30611744);
            c = ii(c, d, a, b, k[6], 15, -1560198380);
            b = ii(b, c, d, a, k[13], 21, 1309151649);
            a = ii(a, b, c, d, k[4], 6, -145523070);
            d = ii(d, a, b, c, k[11], 10, -1120210379);
            c = ii(c, d, a, b, k[2], 15, 718787259);
            b = ii(b, c, d, a, k[9], 21, -343485551);

            x[0] = add32(a, x[0]);
            x[1] = add32(b, x[1]);
            x[2] = add32(c, x[2]);
            x[3] = add32(d, x[3]);
        }

        function cmn(q, a, b, x, s, t) {
            a = add32(add32(a, q), add32(x, t));
            return add32((a << s) | (a >>> (32 - s)), b);
        }

        function ff(a, b, c, d, x, s, t) {
            return cmn((b & c) | ((~b) & d), a, b, x, s, t);
        }

        function gg(a, b, c, d, x, s, t) {
            return cmn((b & d) | (c & (~d)), a, b, x, s, t);
        }

        function hh(a, b, c, d, x, s, t) {
            return cmn(b ^ c ^ d, a, b, x, s, t);
        }

        function ii(a, b, c, d, x, s, t) {
            return cmn(c ^ (b | (~d)), a, b, x, s, t);
        }

        function md5blk(s) {
            var md5blks = [];
            for (var i = 0; i < 64; i += 4) {
                md5blks[i >> 2] = s.charCodeAt(i) +
                    (s.charCodeAt(i + 1) << 8) +
                    (s.charCodeAt(i + 2) << 16) +
                    (s.charCodeAt(i + 3) << 24);
            }
            return md5blks;
        }

        var hex_chr = '0123456789abcdef'.split('');

        function rhex(n) {
            var s = '';
            for (var j = 0; j < 4; j++) {
                s += hex_chr[(n >> (j * 8 + 4)) & 0x0F] +
                     hex_chr[(n >> (j * 8)) & 0x0F];
            }
            return s;
        }

        function hex(x) {
            return rhex(x[0]) + rhex(x[1]) + rhex(x[2]) + rhex(x[3]);
        }

        function add32(a, b) {
            return (a + b) & 0xFFFFFFFF;
        }

        function md5str(s) {
            var n = s.length;
            var state = [1732584193, -271733879, -1732584194, 271733878];
            var i;

            for (i = 64; i <= n; i += 64) {
                md5cycle(state, md5blk(s.substring(i - 64, i)));
            }

            s = s.substring(i - 64);
            var tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (i = 0; i < s.length; i++) {
                tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
            }
            tail[i >> 2] |= 0x80 << ((i % 4) << 3);

            if (i > 55) {
                md5cycle(state, tail);
                for (i = 0; i < 16; i++) tail[i] = 0;
            }

            tail[14] = n * 8;
            md5cycle(state, tail);

            return hex(state);
        }

        return md5str(string);
    }

    // --- Paginated Loader ---
    function PaginatedLoader(fetchFn, pageSize) {
        this.pageSize = pageSize || 50;
        this.offset = 0;
        this.hasMore = true;
        this.loading = false;
        this.fetchFn = fetchFn;
    }

    PaginatedLoader.prototype.loadNext = function(callback) {
        if (this.loading || !this.hasMore) return;
        this.loading = true;
        var self = this;
        this.fetchFn(this.pageSize, this.offset).then(function(items) {
            self.offset += items.length;
            self.hasMore = items.length >= self.pageSize;
            self.loading = false;
            callback(items, self.hasMore);
        }).catch(function(err) {
            self.loading = false;
            error('Pagination', err.message || String(err));
        });
    };

    PaginatedLoader.prototype.reset = function() {
        this.offset = 0;
        this.hasMore = true;
        this.loading = false;
    };

    // --- Virtual Grid (V3-6-fix2 PERF-2) ---
    // For libraries with hundreds of cards, mounting every card is expensive
    // even with lazy image loading. VirtualGrid keeps only the visible rows
    // (plus a buffer) in the DOM. The scroll container gets a tall spacer so
    // scroll height matches the full collection; an absolutely-positioned
    // grid translates by `startRow * itemHeight` to land in the right place.
    //
    // Usage:
    //   var vg = new VirtualGrid({
    //       scrollContainer: ...,   // element that scrolls
    //       mountContainer: ...,    // becomes position:relative; spacer + grid live inside
    //       items: [...],
    //       renderItem: function(item, index) { return cardElement; },
    //       itemHeight: 220,
    //       columns: 8,             // optional; auto-detected if itemMinWidth provided
    //       itemMinWidth: 130,      // px; used to compute columns from container width
    //       gridClassName: 'library-grid library-artists-grid',
    //       bufferRows: 2,
    //       onRangeRender: function(elements, startIndex, endIndex) { ... }
    //   });
    //   vg.init();
    //   ...
    //   vg.destroy();
    function VirtualGrid(opts) {
        this.scrollContainer = opts.scrollContainer;
        this.mountContainer = opts.mountContainer;
        this.items = opts.items || [];
        this.renderItem = opts.renderItem;
        this.itemHeight = opts.itemHeight || 220;
        this.itemMinWidth = opts.itemMinWidth || 0;
        this.fixedColumns = opts.columns || 0;
        this.gridClassName = opts.gridClassName || '';
        this.bufferRows = (opts.bufferRows !== undefined) ? opts.bufferRows : 2;
        this.onRangeRender = opts.onRangeRender || function(){};
        this._columns = 1;
        this._range = { start: -1, end: -1 };
        this._spacer = null;
        this._grid = null;
        this._scrollHandler = null;
        this._scrollRafId = null;
    }

    VirtualGrid.prototype._calcColumns = function() {
        if (this.fixedColumns) {
            this._columns = this.fixedColumns;
            return;
        }
        var w = this.mountContainer.clientWidth || this.scrollContainer.clientWidth || 0;
        if (!w || !this.itemMinWidth) { this._columns = 1; return; }
        // Mirror auto-fill minmax behaviour (approximate). 16px gap allowance.
        var c = Math.floor((w + 16) / (this.itemMinWidth + 16));
        this._columns = Math.max(1, c);
    };

    VirtualGrid.prototype.init = function() {
        var mount = this.mountContainer;
        mount.textContent = '';
        mount.style.position = 'relative';

        this._spacer = document.createElement('div');
        this._spacer.style.width = '100%';
        mount.appendChild(this._spacer);

        this._grid = document.createElement('div');
        if (this.gridClassName) this._grid.className = this.gridClassName;
        this._grid.style.cssText = 'position:absolute;top:0;left:0;right:0;';
        mount.appendChild(this._grid);

        this._calcColumns();
        var totalRows = Math.ceil(this.items.length / this._columns);
        this._spacer.style.height = (totalRows * this.itemHeight) + 'px';

        var self = this;
        this._scrollHandler = function() {
            // Coalesce into one rAF — Tizen's TV scroll fires aggressively.
            if (self._scrollRafId !== null) return;
            self._scrollRafId = requestAnimationFrame(function() {
                self._scrollRafId = null;
                self._updateVisibleRange(false);
            });
        };
        this.scrollContainer.addEventListener('scroll', this._scrollHandler);

        this._updateVisibleRange(true);
    };

    VirtualGrid.prototype._mountTopWithin = function() {
        // offsetTop of mountContainer relative to scrollContainer.
        var top = 0;
        var node = this.mountContainer;
        while (node && node !== this.scrollContainer) {
            top += node.offsetTop || 0;
            node = node.offsetParent;
        }
        return top;
    };

    VirtualGrid.prototype._updateVisibleRange = function(force) {
        if (!this._grid || !this.scrollContainer) return;
        var sc = this.scrollContainer;
        var scrollTop = sc.scrollTop;
        var viewportH = sc.clientHeight;
        var mountTop = this._mountTopWithin();

        var relTop = scrollTop - mountTop;
        var firstRow = Math.floor(relTop / this.itemHeight);
        var lastRow = Math.ceil((relTop + viewportH) / this.itemHeight);

        var totalRows = Math.ceil(this.items.length / this._columns);
        var startRow = Math.max(0, firstRow - this.bufferRows);
        var endRow = Math.min(totalRows, lastRow + this.bufferRows);

        var startIndex = startRow * this._columns;
        var endIndex = Math.min(endRow * this._columns, this.items.length);

        if (!force && startIndex === this._range.start && endIndex === this._range.end) {
            return;
        }

        this._grid.textContent = '';
        this._grid.style.transform = 'translateY(' + (startRow * this.itemHeight) + 'px)';

        var elements = [];
        for (var i = startIndex; i < endIndex; i++) {
            var node = this.renderItem(this.items[i], i);
            if (node) {
                node.setAttribute('data-vg-index', String(i));
                this._grid.appendChild(node);
                elements.push(node);
                if (typeof LazyLoader !== 'undefined' && node.querySelectorAll) {
                    var imgs = node.querySelectorAll('img.lazy-art');
                    for (var k = 0; k < imgs.length; k++) {
                        LazyLoader.observe(imgs[k]);
                    }
                }
            }
        }

        this._range = { start: startIndex, end: endIndex };
        this.onRangeRender(elements, startIndex, endIndex);
    };

    /**
     * Force the visible range to include `index`. Adjusts scrollTop if the
     * index is currently outside the rendered band. Returns the rendered
     * DOM node for that index (or null if beyond items length).
     */
    VirtualGrid.prototype.ensureIndexVisible = function(index) {
        if (index < 0 || index >= this.items.length) return null;
        // Already rendered?
        if (index >= this._range.start && index < this._range.end) {
            return this._grid.querySelector('[data-vg-index="' + index + '"]');
        }
        // Scroll so that the row containing `index` is on screen.
        var row = Math.floor(index / this._columns);
        var sc = this.scrollContainer;
        var mountTop = this._mountTopWithin();
        var targetTop = mountTop + row * this.itemHeight;
        // Keep some padding — aim for a quarter of the viewport above.
        var pad = Math.floor(sc.clientHeight * 0.25);
        var newScroll = Math.max(0, targetTop - pad);
        // If row is already partly visible just nudge into bounds.
        var currentTop = sc.scrollTop - mountTop;
        var rowTop = row * this.itemHeight;
        if (rowTop < currentTop) {
            sc.scrollTop = mountTop + rowTop;
        } else if (rowTop + this.itemHeight > currentTop + sc.clientHeight) {
            sc.scrollTop = mountTop + rowTop - sc.clientHeight + this.itemHeight + 20;
        } else {
            sc.scrollTop = newScroll;
        }
        // Force re-render synchronously so caller can grab the node.
        if (this._scrollRafId !== null) {
            cancelAnimationFrame(this._scrollRafId);
            this._scrollRafId = null;
        }
        this._updateVisibleRange(true);
        return this._grid.querySelector('[data-vg-index="' + index + '"]');
    };

    VirtualGrid.prototype.getColumns = function() {
        return this._columns;
    };

    VirtualGrid.prototype.getCount = function() {
        return this.items.length;
    };

    VirtualGrid.prototype.scrollToIndex = function(index) {
        var row = Math.floor(index / this._columns);
        var mountTop = this._mountTopWithin();
        this.scrollContainer.scrollTop = mountTop + row * this.itemHeight;
    };

    VirtualGrid.prototype.destroy = function() {
        if (this._scrollHandler && this.scrollContainer) {
            this.scrollContainer.removeEventListener('scroll', this._scrollHandler);
        }
        if (this._scrollRafId !== null) {
            cancelAnimationFrame(this._scrollRafId);
            this._scrollRafId = null;
        }
        this._scrollHandler = null;
        this._spacer = null;
        this._grid = null;
        this._range = { start: -1, end: -1 };
    };

    // --- Lyrics Parser (OpenSubsonic) ---
    // Accepts the subsonic-response object returned by SubsonicAPI._request.
    // Returns a single structuredLyrics entry (synced preferred) or null.
    function parseLyricsResponse(subResponse) {
        if (!subResponse || !subResponse.lyricsList) return null;
        var all = subResponse.lyricsList.structuredLyrics;
        if (!all) return null;
        if (!Array.isArray(all)) all = [all];
        if (!all.length) return null;
        var synced = null;
        var unsynced = null;
        for (var i = 0; i < all.length; i++) {
            var entry = all[i];
            if (!entry) continue;
            // Navidrome may return the line list under `line` (can be array or single object)
            var lines = entry.line;
            if (!lines) continue;
            if (!Array.isArray(lines)) lines = [lines];
            if (!lines.length) continue;
            var normalized = {
                lang: entry.lang || '',
                synced: !!entry.synced,
                line: lines
            };
            if (normalized.synced && !synced) synced = normalized;
            if (!normalized.synced && !unsynced) unsynced = normalized;
        }
        return synced || unsynced || null;
    }

    // --- Public API ---
    return {
        log: log,
        warn: warn,
        error: error,
        el: el,
        $: $,
        $$: $$,
        createSvg: createSvg,
        createStarSvg: createStarSvg,
        SVG_PATHS: SVG_PATHS,
        generateSalt: generateSalt,
        formatDuration: formatDuration,
        md5: md5,
        PaginatedLoader: PaginatedLoader,
        VirtualGrid: VirtualGrid,
        parseLyricsResponse: parseLyricsResponse
    };
})();
