/* ============================================
   Sonance — Home Screen (REDESIGN)
   Full-bleed cinematic hero, 2×3 quick-access grid, horizontal scroll rows.
   ============================================ */

var HomeScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var _container = null;
    var _heroAlbum = null;
    var _newestAlbums = [];
    var _recentAlbums = [];
    var _playlists = [];
    var _quickAccess = [];

    // =========================================
    //  Scroll Helper (Chromium 63 safe — anchored scrolling)
    // =========================================

    function _scrollToFocused(element) {
        var container = document.querySelector('.home-screen');
        if (!container || !element) return;
        var elTop = element.offsetTop;
        var elBottom = elTop + element.offsetHeight;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + container.clientHeight;
        if (elBottom > viewBottom) {
            container.scrollTop = elBottom - container.clientHeight + 32;
        } else if (elTop < viewTop) {
            container.scrollTop = elTop - 32;
        }
    }

    // =========================================
    //  Render (builds DOM with loading skeletons)
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'home-screen' });

        // Full-bleed hero — loading skeleton
        var hero = el('div', { className: 'home-hero', id: 'home-hero' });
        hero.appendChild(el('div', { className: 'skeleton home-hero-skeleton' }));
        wrapper.appendChild(hero);

        // Quick-access 2×3 grid (replaces "Recently Played")
        var qaSection = el('div', { className: 'home-section home-qa-section' });
        var qaGrid = el('div', { className: 'home-qa-grid', id: 'home-qa-grid' });
        qaGrid.appendChild(SonanceComponents.renderSkeletonCards(6, 0, 88, 'skeleton-qa'));
        qaSection.appendChild(qaGrid);
        wrapper.appendChild(qaSection);

        // Recently Added row
        var newestSection = el('div', { className: 'home-section' });
        newestSection.appendChild(el('div', { className: 'home-section-heading' }, 'Recently Added'));
        var newestRow = el('div', { className: 'home-row', id: 'home-newest-row' });
        newestRow.appendChild(SonanceComponents.renderSkeletonCards(6, 210, 280, 'skeleton-card'));
        newestSection.appendChild(newestRow);
        wrapper.appendChild(newestSection);

        // Playlists row
        var playlistSection = el('div', { className: 'home-section' });
        playlistSection.appendChild(el('div', { className: 'home-section-heading' }, 'Your Playlists'));
        var playlistRow = el('div', { className: 'home-row', id: 'home-playlists-row' });
        playlistRow.appendChild(SonanceComponents.renderSkeletonCards(5, 210, 210, 'skeleton-card'));
        playlistSection.appendChild(playlistRow);
        wrapper.appendChild(playlistSection);

        container.appendChild(wrapper);

        // Delegated click listeners (cards carry data-album-id / data-playlist-id).
        qaGrid.addEventListener('click', _onAlbumRowClick);
        newestRow.addEventListener('click', _onAlbumRowClick);
        playlistRow.addEventListener('click', _onPlaylistRowClick);

        log('Home', 'Home screen rendered (loading state)');
    }

    function _onAlbumRowClick(ev) {
        var card = ev.target.closest('.album-card, .qa-tile');
        if (!card) return;
        var id = card.getAttribute('data-album-id');
        if (!id) return;
        var title = card.getAttribute('data-album-title') || '';
        App.navigateTo('album', { id: id, title: title }, 'zoom-in');
    }

    function _onPlaylistRowClick(ev) {
        var card = ev.target.closest('.playlist-card');
        if (!card) return;
        var id = card.getAttribute('data-playlist-id');
        if (!id) return;
        App.navigateTo('playlists', { id: id }, 'zoom-in');
    }

    // =========================================
    //  Activate (fetch data and populate)
    // =========================================

    function activate(params) {
        var api = App.getApi();
        if (!api) {
            log('Home', 'No API instance available');
            return;
        }

        var libraryIds = AuthManager.getSelectedLibraries();

        var newestPromise = api.getAlbumList2('newest', 12, 0, libraryIds);
        var recentPromise = api.getAlbumList2('recent', 12, 0, libraryIds);
        var playlistPromise = api.getPlaylists();

        Promise.all([newestPromise, recentPromise, playlistPromise]).then(function(results) {
            _newestAlbums = results[0] || [];
            _recentAlbums = results[1] || [];
            _playlists = results[2] || [];

            _heroAlbum = _newestAlbums[0] || _recentAlbums[0] || null;
            _quickAccess = _buildQuickAccess();

            _renderHero(api);
            _renderQuickAccess(api);
            _renderNewestAlbums(api);
            _renderPlaylists(api);
            _registerFocusZones();

            log('Home', 'Home screen data loaded');
        }).catch(function(err) {
            log('Home', 'Error loading home data: ' + err.message);
            _renderError();
        });
    }

    // Deduplicated recents, backfilled with starred albums (then newest) so the
    // quick-access grid is always 6 distinct items where possible.
    function _buildQuickAccess() {
        var seen = {};
        var out = [];
        function add(album) {
            if (!album || !album.id || seen[album.id]) return;
            if (out.length >= 6) return;
            seen[album.id] = true;
            out.push(album);
        }
        _recentAlbums.forEach(add);
        if (out.length < 6 && typeof StarredCache !== 'undefined' && StarredCache.getAlbums) {
            StarredCache.getAlbums().forEach(add);
        }
        if (out.length < 6) _newestAlbums.forEach(add);
        return out;
    }

    // =========================================
    //  Full-bleed Hero
    // =========================================

    function _renderHero(api) {
        var heroContainer = document.getElementById('home-hero');
        if (!heroContainer) return;
        heroContainer.textContent = '';

        if (!_heroAlbum) {
            var welcome = el('div', { className: 'home-hero-content' });
            welcome.appendChild(el('div', { className: 'home-hero-label' }, 'WELCOME TO'));
            welcome.appendChild(el('div', { className: 'home-hero-title' }, 'Sonance'));
            welcome.appendChild(el('div', { className: 'home-hero-subtitle' }, 'Start playing music to see your activity here'));
            heroContainer.appendChild(welcome);
            return;
        }

        var album = _heroAlbum;
        var coverId = album.coverArt || album.id;

        // Sharp album cover, left-aligned, with the details following it.
        var cover = el('div', { className: 'home-hero-cover' });
        if (coverId && typeof ImageCache !== 'undefined') {
            var coverImg = el('img', {
                className: 'home-hero-cover-img',
                src: ImageCache.getUrl(coverId, 600),
                alt: album.name || album.title || 'Album cover'
            });
            cover.appendChild(coverImg);
        }
        heroContainer.appendChild(cover);

        var info = el('div', { className: 'home-hero-content' });
        info.appendChild(el('div', { className: 'home-hero-label' }, 'LATEST ADDITION'));
        info.appendChild(el('div', { className: 'home-hero-title' }, album.name || album.title || 'Unknown Album'));

        var meta = album.artist || 'Unknown Artist';
        if (album.year) meta += ' · ' + album.year;
        info.appendChild(el('div', { className: 'home-hero-subtitle' }, meta));

        var buttons = el('div', { className: 'home-hero-buttons' });

        var playBtn = el('button', { className: 'hero-play-btn focusable' });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = '22px';
        playIcon.style.height = '22px';
        playIcon.style.fill = 'currentColor';
        playIcon.style.flexShrink = '0';
        playBtn.appendChild(playIcon);
        playBtn.appendChild(document.createTextNode(' Play'));
        playBtn.addEventListener('click', function() { _playHero(api, false); });
        buttons.appendChild(playBtn);

        var shuffleBtn = el('button', { className: 'hero-shuffle-btn focusable' });
        var shuffleIcon = createSvg(SVG_PATHS.shuffle);
        shuffleIcon.style.width = '22px';
        shuffleIcon.style.height = '22px';
        shuffleIcon.style.fill = 'currentColor';
        shuffleIcon.style.flexShrink = '0';
        shuffleBtn.appendChild(shuffleIcon);
        shuffleBtn.appendChild(document.createTextNode(' Shuffle'));
        shuffleBtn.addEventListener('click', function() { _playHero(api, true); });
        buttons.appendChild(shuffleBtn);

        info.appendChild(buttons);
        heroContainer.appendChild(info);
    }

    function _playHero(api, shuffle) {
        if (!_heroAlbum) return;
        api.getAlbum(_heroAlbum.id).then(function(full) {
            var songs = (full && full.song) || [];
            if (!songs.length) {
                App.navigateTo('album', { id: _heroAlbum.id, title: _heroAlbum.name || _heroAlbum.title }, 'zoom-in');
                return;
            }
            if (shuffle) Player.shuffleQueue(songs);
            else Player.setQueue(songs, 0);
        }).catch(function(err) {
            log('Home', 'Hero play failed: ' + (err && err.message));
        });
    }

    // =========================================
    //  Quick-access 2×3 grid
    // =========================================

    function _renderQuickAccess(api) {
        var grid = document.getElementById('home-qa-grid');
        if (!grid) return;
        grid.textContent = '';

        if (!_quickAccess.length) {
            grid.appendChild(el('div', { className: 'home-empty' }, 'Nothing here yet'));
            return;
        }

        _quickAccess.forEach(function(album) {
            var tile = el('div', {
                className: 'qa-tile focusable',
                'data-album-id': album.id,
                'data-album-title': album.name || album.title || ''
            });
            var art = el('div', { className: 'qa-tile-art' });
            art.appendChild(SonanceComponents.renderAlbumArt(album, 72, api));
            tile.appendChild(art);
            var info = el('div', { className: 'qa-tile-info' });
            info.appendChild(el('div', { className: 'qa-tile-title' }, album.name || album.title || 'Unknown'));
            info.appendChild(el('div', { className: 'qa-tile-artist' }, album.artist || 'Unknown Artist'));
            tile.appendChild(info);
            grid.appendChild(tile);
        });
    }

    // =========================================
    //  Recently Added Row
    // =========================================

    function _renderNewestAlbums(api) {
        var row = document.getElementById('home-newest-row');
        if (!row) return;
        row.textContent = '';

        if (!_newestAlbums || _newestAlbums.length === 0) {
            row.appendChild(el('div', { className: 'home-empty' }, 'No recently added albums'));
            return;
        }

        _newestAlbums.forEach(function(album) {
            var card = el('div', {
                className: 'album-card focusable',
                'data-album-id': album.id,
                'data-album-title': album.name || album.title || ''
            });
            card.appendChild(SonanceComponents.renderAlbumArt(album, 210, api));
            card.appendChild(el('div', { className: 'album-card-title' }, album.name || album.title || 'Unknown'));
            card.appendChild(el('div', { className: 'album-card-artist' }, album.artist || 'Unknown Artist'));
            row.appendChild(card);
        });
    }

    // =========================================
    //  Playlists Row
    // =========================================

    function _renderPlaylists(api) {
        var row = document.getElementById('home-playlists-row');
        if (!row) return;
        row.textContent = '';

        if (!_playlists || _playlists.length === 0) {
            row.appendChild(el('div', { className: 'home-empty' }, 'No playlists yet'));
            return;
        }

        _playlists.forEach(function(playlist) {
            var colors = playlist._gradient || SonanceComponents.hashColor(playlist.name || '');
            var card = el('div', {
                className: 'playlist-card focusable',
                'data-playlist-id': playlist.id
            });
            card.style.background = 'linear-gradient(135deg, ' + colors.base + ' 0%, var(--bg-card) 100%)';
            card.appendChild(el('div', { className: 'playlist-card-name' }, playlist.name || 'Untitled'));
            card.appendChild(el('div', { className: 'playlist-card-count' },
                (playlist.songCount || 0) + ' tracks'));
            row.appendChild(card);
        });
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        var heroButtons = document.querySelectorAll('#home-hero .focusable');
        var qaTiles = document.querySelectorAll('#home-qa-grid .focusable');
        var newestCards = document.querySelectorAll('#home-newest-row .focusable');
        var playlistCards = document.querySelectorAll('#home-playlists-row .focusable');

        var hasHero = heroButtons.length > 0;
        var hasQa = qaTiles.length > 0;
        var hasNewest = newestCards.length > 0;
        var hasPlaylists = playlistCards.length > 0;

        var firstZone = hasHero ? 'content' : (hasQa ? 'home-qa' : (hasNewest ? 'content' : 'home-playlists'));

        // Hero buttons → registered as 'content' (top nav Down lands here)
        if (hasHero) {
            FocusManager.registerZone('content', {
                selector: '#home-hero .focusable',
                columns: heroButtons.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    down: hasQa ? 'home-qa' : (hasNewest ? 'home-newest' : (hasPlaylists ? 'home-playlists' : undefined))
                }
            });
        }

        // Quick-access grid (2 rows × 3 cols)
        if (hasQa) {
            FocusManager.registerZone('home-qa', {
                selector: '#home-qa-grid .focusable',
                columns: 3,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    up: hasHero ? 'content' : 'topnav',
                    down: hasNewest ? 'home-newest' : (hasPlaylists ? 'home-playlists' : undefined)
                }
            });
            if (!hasHero) {
                // No hero — make the grid the 'content' entry zone too.
                FocusManager.registerZone('content', {
                    selector: '#home-qa-grid .focusable',
                    columns: 3,
                    onActivate: function(idx, element) { element.click(); },
                    onFocus: function(idx, element) { _scrollToFocused(element); },
                    neighbors: {
                        left: 'topnav',
                        down: hasNewest ? 'home-newest' : (hasPlaylists ? 'home-playlists' : undefined)
                    }
                });
            }
        }

        // Recently Added row
        if (hasNewest) {
            FocusManager.registerZone('home-newest', {
                selector: '#home-newest-row .focusable',
                columns: newestCards.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    up: hasQa ? 'home-qa' : (hasHero ? 'content' : 'topnav'),
                    down: hasPlaylists ? 'home-playlists' : undefined
                }
            });
            if (!hasHero && !hasQa) {
                FocusManager.registerZone('content', {
                    selector: '#home-newest-row .focusable',
                    columns: newestCards.length,
                    onActivate: function(idx, element) { element.click(); },
                    onFocus: function(idx, element) { _scrollToFocused(element); },
                    neighbors: { left: 'topnav', down: hasPlaylists ? 'home-playlists' : undefined }
                });
            }
        }

        // Playlists row (bottom — no down)
        if (hasPlaylists) {
            FocusManager.registerZone('home-playlists', {
                selector: '#home-playlists-row .focusable',
                columns: playlistCards.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'topnav',
                    up: hasNewest ? 'home-newest' : (hasQa ? 'home-qa' : (hasHero ? 'content' : 'topnav'))
                }
            });
        }

        FocusManager.setActiveZone(firstZone, 0);
    }

    // =========================================
    //  Error State
    // =========================================

    function _renderError() {
        var heroContainer = document.getElementById('home-hero');
        if (heroContainer) {
            heroContainer.textContent = '';
            heroContainer.style.background = 'var(--bg-card)';
            var errDiv = el('div', { className: 'home-error' });
            errDiv.appendChild(el('div', { className: 'home-error-text' }, 'Unable to load data. Check your connection.'));
            heroContainer.appendChild(errDiv);
        }
        var qa = document.getElementById('home-qa-grid');
        if (qa) qa.textContent = '';
        var newestRow = document.getElementById('home-newest-row');
        if (newestRow) newestRow.textContent = '';
        var playlistRow = document.getElementById('home-playlists-row');
        if (playlistRow) playlistRow.textContent = '';
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _container = null;
        _heroAlbum = null;
        _newestAlbums = [];
        _recentAlbums = [];
        _playlists = [];
        _quickAccess = [];
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
