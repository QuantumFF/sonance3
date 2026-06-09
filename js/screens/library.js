/* ============================================
   Sonance — Library Screen (REDESIGN)
   Horizontal tab strip (Albums / Artists / Songs / Genres / Playlists),
   contextual Shuffle button, 3-state Favourites filter, virtualized Songs.
   ============================================ */

var LibraryScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var formatDuration = SonanceUtils.formatDuration;
    var createStarSvg = SonanceUtils.createStarSvg;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var _container = null;
    var _contentContainer = null;
    var _activeTab = 'albums';   // persists across navigations
    var _favFilter = 'all';      // REDESIGN: 'all' | 'fav' | 'nofav' — persists across tabs
    var _genreMode = false;
    var _currentGenre = null;
    var _currentSongs = null;    // Track list for colour button + shuffle support
    var _albumLoader = null;
    var _lastAlbums = [];        // accumulated album list (for shuffle source)
    var _lastArtists = [];       // (for shuffle source)
    var _lastPlaylists = [];     // (for shuffle source)
    var _artistsAll = null;
    var _artistsRenderedCount = 0;
    var _artistsChunkRaf = null;
    var _artistsChunkedZoneRegistered = false;
    var _artistsVirtualGrid = null;
    var _songsVirtualGrid = null;
    var ARTISTS_VIRTUAL_THRESHOLD = 80;
    var ARTISTS_CHUNK_SIZE = 50;
    var ARTIST_ITEM_HEIGHT = 252;   // card (~222) + 30px row gap; must match .library-artists-grid
    var ARTIST_ITEM_MIN_WIDTH = 180; // must match minmax() in .library-artists-grid
    var SONG_ITEM_HEIGHT = 80;
    var SONGS_VIRTUAL_THRESHOLD = 40;

    var SHUFFLE_FETCH_CAP = 30;  // bound multi-fetch shuffle sources

    var LIBRARY_TABS = [
        { key: 'albums',    label: 'Albums'    },
        { key: 'artists',   label: 'Artists'   },
        { key: 'songs',     label: 'Songs'     },
        { key: 'genres',    label: 'Genres'    },
        { key: 'playlists', label: 'Playlists' }
    ];

    // Tabs that support the favourites filter (Genres + Playlists have no
    // per-item starred concept).
    function _tabHasFilter(key) {
        return key === 'albums' || key === 'artists' || key === 'songs';
    }
    function _tabHasShuffle(key) {
        return key !== 'genres';
    }

    function _tabIndex(key) {
        for (var i = 0; i < LIBRARY_TABS.length; i++) {
            if (LIBRARY_TABS[i].key === key) return i;
        }
        return 0;
    }
    function _tabLabel(key) {
        for (var i = 0; i < LIBRARY_TABS.length; i++) {
            if (LIBRARY_TABS[i].key === key) return LIBRARY_TABS[i].label;
        }
        return key;
    }

    // =========================================
    //  Delegated content click routing
    // =========================================

    function _onContentClick(ev) {
        var t = ev.target;
        var albumCard = t.closest('.album-grid-card');
        if (albumCard) {
            var aid = albumCard.getAttribute('data-album-id');
            var atitle = albumCard.getAttribute('data-album-title') || '';
            if (aid) App.navigateTo('album', { id: aid, title: atitle }, 'zoom-in');
            return;
        }
        var artistCard = t.closest('.artist-grid-card');
        if (artistCard) {
            var artistId = artistCard.getAttribute('data-artist-id');
            if (artistId) App.navigateTo('artist', { id: artistId }, 'zoom-in');
            return;
        }
        var playlistCard = t.closest('.playlist-card');
        if (playlistCard) {
            var pid = playlistCard.getAttribute('data-playlist-id');
            if (pid) App.navigateTo('playlists', { id: pid }, 'zoom-in');
            return;
        }
        var songRow = t.closest('.song-row');
        if (songRow) {
            var rawIdx = songRow.getAttribute('data-song-index');
            if (rawIdx !== null && _currentSongs && _currentSongs.length) {
                var startIdx = parseInt(rawIdx, 10);
                if (!isNaN(startIdx) && _currentSongs[startIdx]) {
                    var sAlbumId = songRow.getAttribute('data-album-id');
                    if (_genreMode && sAlbumId) {
                        var sAlbumTitle = songRow.getAttribute('data-album-title') || '';
                        App.navigateTo('album', { id: sAlbumId, title: sAlbumTitle }, 'zoom-in');
                    } else {
                        Player.playAlbum(_currentSongs, startIdx);
                    }
                }
            }
            return;
        }
        var genreCard = t.closest('.genre-card');
        if (genreCard) {
            var name = genreCard.getAttribute('data-genre');
            if (!name) return;
            var api = App.getApi();
            if (!api) return;
            _genreMode = true;
            _currentGenre = name;
            if (App.zoomContent) {
                App.zoomContent(_contentContainer, function() { _loadGenreSongs(api, name); }, 'in');
            } else {
                _loadGenreSongs(api, name);
            }
            return;
        }
    }

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(container, element) {
        if (!container || !element) return;
        var elTop = element.offsetTop;
        var elBottom = elTop + element.offsetHeight;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + container.clientHeight;
        if (elBottom > viewBottom) {
            container.scrollTop = elBottom - container.clientHeight + 24;
        } else if (elTop < viewTop) {
            container.scrollTop = elTop - 24;
        }
    }

    function _getScrollContainer() {
        return document.getElementById('library-content');
    }

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'library-screen' });

        // --- Header: horizontal tab strip (left) + actions (right) ---
        var header = el('div', { className: 'library-header' });

        var tabs = el('div', { className: 'library-tabs', id: 'library-tabs-strip' });
        var pill = el('div', { className: 'library-tab-pill selected', id: 'library-tab-pill' });
        tabs.appendChild(pill);
        LIBRARY_TABS.forEach(function(tab, i) {
            var item = el('div', {
                className: 'library-tab' + (tab.key === _activeTab ? ' selected' : ''),
                'data-tab': tab.key,
                'data-index': String(i)
            }, tab.label);
            item.addEventListener('click', function() { _onTabItemClicked(tab.key); });
            tabs.appendChild(item);
        });
        header.appendChild(tabs);

        var actions = el('div', { className: 'library-actions', id: 'library-actions' });
        // Favourites filter (3-state)
        var favBtn = el('button', { className: 'library-action library-fav-filter focusable', id: 'library-fav-filter' });
        favBtn.addEventListener('click', _cycleFavFilter);
        actions.appendChild(favBtn);
        // Contextual shuffle
        var shuffleBtn = el('button', { className: 'library-action library-shuffle focusable', id: 'library-shuffle' });
        shuffleBtn.addEventListener('click', _onShuffleClicked);
        actions.appendChild(shuffleBtn);
        header.appendChild(actions);

        wrapper.appendChild(header);

        _contentContainer = el('div', { className: 'library-content', id: 'library-content' });
        _contentContainer.addEventListener('click', _onContentClick);
        wrapper.appendChild(_contentContainer);

        container.appendChild(wrapper);

        _updateActionButtons();

        setTimeout(function() { _updateTabPill(_tabIndex(_activeTab), false); }, 0);

        log('Library', 'Library screen rendered');
    }

    // =========================================
    //  Tab pill (horizontal sliding highlight)
    // =========================================

    function _updateTabPill(index, animate) {
        var pill = document.getElementById('library-tab-pill');
        var items = document.querySelectorAll('.library-tab');
        if (!items[index] || !pill) return;

        var firstLeft = items[0].offsetLeft;
        var itemLeft = items[index].offsetLeft - firstLeft;
        var itemWidth = items[index].offsetWidth;
        if (itemWidth === 0) {
            setTimeout(function() { _updateTabPill(index, animate); }, 16);
            return;
        }
        pill.style.left = firstLeft + 'px';
        pill.style.width = itemWidth + 'px';
        pill.style.transition = animate ? 'transform 0.2s ease' : 'none';
        pill.style.transform = 'translateX(' + itemLeft + 'px)';
    }

    function _setTabPillState(state) {
        var pill = document.getElementById('library-tab-pill');
        if (!pill) return;
        pill.classList.remove('focused', 'selected');
        pill.classList.add(state);
    }

    function _markTabSelected(index) {
        var items = document.querySelectorAll('.library-tab');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('selected', i === index);
        }
    }

    function _onTabItemClicked(tabKey) {
        FocusManager.setActiveZone('library-tabs', _tabIndex(tabKey), true);
    }

    // =========================================
    //  Favourites filter + Shuffle action buttons
    // =========================================

    function _favLabel() {
        if (_favFilter === 'fav') return 'Favourites';
        if (_favFilter === 'nofav') return 'Non-favourites';
        return 'All';
    }

    function _updateActionButtons() {
        var favBtn = document.getElementById('library-fav-filter');
        var shuffleBtn = document.getElementById('library-shuffle');

        if (favBtn) {
            var showFilter = _tabHasFilter(_activeTab) && !_genreMode;
            favBtn.style.display = showFilter ? '' : 'none';
            favBtn.textContent = '';
            favBtn.appendChild(createStarSvg(_favFilter === 'fav'));
            favBtn.appendChild(el('span', { className: 'library-action-label' }, _favLabel()));
            favBtn.classList.toggle('is-active', _favFilter !== 'all');
            favBtn.classList.toggle('is-nofav', _favFilter === 'nofav');
        }
        if (shuffleBtn) {
            var showShuffle = _tabHasShuffle(_activeTab) && !_genreMode;
            shuffleBtn.style.display = showShuffle ? '' : 'none';
            shuffleBtn.textContent = '';
            var sIcon = createSvg(SVG_PATHS.shuffle);
            sIcon.style.width = '24px';
            sIcon.style.height = '24px';
            sIcon.style.fill = 'currentColor';
            shuffleBtn.appendChild(sIcon);
            shuffleBtn.appendChild(el('span', { className: 'library-action-label' }, 'Shuffle ' + _tabLabel(_activeTab)));
        }
    }

    function _cycleFavFilter() {
        _favFilter = _favFilter === 'all' ? 'fav' : (_favFilter === 'fav' ? 'nofav' : 'all');
        _updateActionButtons();
        // Re-register the actions zone (button count is unchanged but the
        // selector cache should refresh) and reload the current tab.
        FocusManager.invalidateZone && FocusManager.invalidateZone('library-actions');
        _loadTabContent();
    }

    function _onShuffleClicked() {
        var api = App.getApi();
        if (!api) return;
        // Albums tab shuffles whole albums: the album *order* is randomised but
        // each album's tracks stay in sequence and play album-after-album.
        if (_activeTab === 'albums') { _shuffleAlbumsWhole(api); return; }
        _collectShuffleTracks(api).then(function(tracks) {
            if (tracks && tracks.length) {
                Player.shuffleQueue(tracks);
                App.showToast('Shuffling ' + tracks.length + ' tracks');
            } else {
                App.showToast('Nothing to shuffle');
            }
        }).catch(function(err) {
            log('Library', 'Shuffle failed: ' + (err && err.message));
        });
    }

    // Albums tab: shuffle the *album order* (respecting the favourites filter),
    // then play each album's tracks in sequence — one whole album after another.
    function _shuffleAlbumsWhole(api) {
        var albums = _filterByFav(_lastAlbums, 'album').slice();
        if (!albums.length) { App.showToast('Nothing to shuffle'); return; }
        // Fisher–Yates on the album list.
        for (var i = albums.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = albums[i]; albums[i] = albums[j]; albums[j] = tmp;
        }
        albums = albums.slice(0, SHUFFLE_FETCH_CAP);
        // Fetch songs in shuffled-album order; Promise.all preserves array order,
        // so in-album track order is kept and albums stay contiguous.
        Promise.all(albums.map(function(a) {
            return api.getAlbum(a.id).then(function(full) { return (full && full.song) || []; })
                .catch(function() { return []; });
        })).then(function(arrs) {
            var tracks = _flatten(arrs);
            if (!tracks.length) { App.showToast('Nothing to shuffle'); return; }
            // Play the album-ordered queue with shuffle mode OFF, otherwise
            // playAlbum would re-scramble the individual songs.
            var pstate = Player.getState && Player.getState();
            if (pstate && pstate.shuffle) Player.toggleShuffle();
            Player.playAlbum(tracks, 0);
            App.showToast('Shuffling ' + albums.length + ' albums');
        }).catch(function(err) {
            log('Library', 'Album shuffle failed: ' + (err && err.message));
        });
    }

    // Build a track pool from the current tab's (favourites-filtered) items,
    // bounded by SHUFFLE_FETCH_CAP secondary fetches.
    function _collectShuffleTracks(api) {
        // Albums are handled separately (album-level shuffle) in _shuffleAlbumsWhole.
        if (_activeTab === 'songs') {
            return Promise.resolve(_filterByFav(_currentSongs || [], 'song'));
        }
        if (_activeTab === 'playlists') {
            var pls = _lastPlaylists.slice(0, SHUFFLE_FETCH_CAP);
            return Promise.all(pls.map(function(p) {
                return api.getPlaylist(p.id).then(function(full) { return (full && full.entry) || []; })
                    .catch(function() { return []; });
            })).then(_flatten);
        }
        if (_activeTab === 'artists') {
            var artists = _filterByFav(_lastArtists, 'artist').slice(0, SHUFFLE_FETCH_CAP);
            // For each artist take their first album's songs (bounded).
            return Promise.all(artists.map(function(ar) {
                return api.getArtist(ar.id).then(function(full) {
                    var alb = (full && full.album && full.album[0]) || null;
                    if (!alb) return [];
                    return api.getAlbum(alb.id).then(function(fa) { return (fa && fa.song) || []; })
                        .catch(function() { return []; });
                }).catch(function() { return []; });
            })).then(_flatten);
        }
        return Promise.resolve([]);
    }

    function _flatten(arrs) {
        var out = [];
        for (var i = 0; i < arrs.length; i++) {
            for (var j = 0; j < arrs[i].length; j++) out.push(arrs[i][j]);
        }
        return out;
    }

    // =========================================
    //  Favourites filtering
    // =========================================

    function _isStarred(item, kind) {
        if (typeof StarredCache === 'undefined') return false;
        if (kind === 'album') return StarredCache.isAlbumStarred(item.id);
        if (kind === 'artist') return StarredCache.isArtistStarred(item.id);
        return StarredCache.isSongStarred(item.id);
    }

    function _filterByFav(list, kind) {
        if (!list) return [];
        if (_favFilter === 'all') return list.slice();
        var wantStarred = _favFilter === 'fav';
        return list.filter(function(item) { return _isStarred(item, kind) === wantStarred; });
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        if (params && params.tab) _activeTab = params.tab;
        if (params && params.genre) {
            _genreMode = true;
            _currentGenre = params.genre;
            _updateActionButtons();
            var api = App.getApi();
            if (api) _loadGenreSongs(api, params.genre);
            _registerTabsZone();
            _registerActionsZone();
            return;
        }
        _genreMode = false;
        _currentGenre = null;
        _updateActionButtons();
        _loadTabContent();
        _registerTabsZone();
        _registerActionsZone();
    }

    // =========================================
    //  Focus zones — tabs + actions
    // =========================================

    function _registerTabsZone() {
        FocusManager.registerZone('library-tabs', {
            selector: '.library-tab',
            columns: LIBRARY_TABS.length,
            defaultIndex: _tabIndex(_activeTab),
            onFocus: function(idx) {
                var newTab = LIBRARY_TABS[idx] ? LIBRARY_TABS[idx].key : _activeTab;
                _setTabPillState('focused');
                _updateTabPill(idx, true);
                _markTabSelected(idx);
                if (newTab !== _activeTab) {
                    _genreMode = false;
                    _currentGenre = null;
                    _switchTabAnimated(newTab);
                }
            },
            onActivate: function() { _enterLibraryContent(); },
            onKey: function(direction) {
                var idx = _tabIndex(_activeTab);
                if (direction === 'up') {
                    _setTabPillState('selected');
                    FocusManager.setActiveZone('topnav', undefined, true);
                    return true;
                }
                if (direction === 'down') {
                    _enterLibraryContent();
                    return true;
                }
                if (direction === 'right' && idx === LIBRARY_TABS.length - 1) {
                    if (FocusManager.hasZone('library-actions')) {
                        _setTabPillState('selected');
                        FocusManager.setActiveZone('library-actions', 0, true);
                        return true;
                    }
                }
                return false; // left/right within the strip → default move (triggers onFocus)
            },
            neighbors: {}
        });
    }

    function _registerActionsZone() {
        // Number of visible action buttons depends on the tab.
        FocusManager.registerZone('library-actions', {
            selector: '.library-action',
            getElements: function() {
                var all = document.querySelectorAll('#library-actions .library-action');
                var vis = [];
                for (var i = 0; i < all.length; i++) {
                    if (all[i].style.display !== 'none') vis.push(all[i]);
                }
                return vis;
            },
            columns: 2,
            onActivate: function(idx, element) { if (element) element.click(); },
            onKey: function(direction) {
                if (direction === 'up') {
                    FocusManager.setActiveZone('topnav', undefined, true);
                    return true;
                }
                if (direction === 'down') {
                    _enterLibraryContent();
                    return true;
                }
                return false;
            },
            neighbors: { left: 'library-tabs' }
        });
    }

    function _enterLibraryContent() {
        _setTabPillState('selected');
        var targetZone = FocusManager.hasZone('library-grid') ? 'library-grid' : null;
        if (targetZone) FocusManager.setActiveZone(targetZone, 0, true);
    }

    // =========================================
    //  Tab switching (content cross-fade)
    // =========================================

    function _switchTabAnimated(tabKey) {
        if (!_contentContainer) { _switchTabInstant(tabKey); return; }
        var container = _contentContainer;
        container.style.transition = 'opacity 0.15s ease';
        container.style.opacity = '0';
        setTimeout(function() {
            _switchTabInstant(tabKey);
            void container.offsetHeight;
            container.style.transition = 'opacity 0.15s ease';
            container.style.opacity = '1';
        }, 160);
    }

    function _switchTabInstant(tabKey) {
        _teardownTransient();
        _activeTab = tabKey;
        _markTabSelected(_tabIndex(tabKey));
        _updateActionButtons();
        FocusManager.unregisterZone('library-grid');
        _loadTabContent();
    }

    function _switchTab(tabKey) { _switchTabInstant(tabKey); }

    function _teardownTransient() {
        _currentSongs = null;
        _albumLoader = null;
        if (_artistsVirtualGrid) { _artistsVirtualGrid.destroy(); _artistsVirtualGrid = null; }
        if (_songsVirtualGrid) { _songsVirtualGrid.destroy(); _songsVirtualGrid = null; }
        if (_artistsChunkRaf !== null) { cancelAnimationFrame(_artistsChunkRaf); _artistsChunkRaf = null; }
        _artistsAll = null;
        _artistsRenderedCount = 0;
        _artistsChunkedZoneRegistered = false;
    }

    // =========================================
    //  Loading State
    // =========================================

    function _showLoading() {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        var loading = el('div', { className: 'library-loading' });
        if (_activeTab === 'songs') {
            for (var i = 0; i < 10; i++) loading.appendChild(el('div', { className: 'skeleton skeleton-song-row' }));
        } else {
            var cols = (_activeTab === 'genres' || _activeTab === 'playlists') ? 4 : 6;
            var grid = el('div', { className: 'library-grid' });
            grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
            for (var j = 0; j < cols * 2; j++) grid.appendChild(el('div', { className: 'skeleton skeleton-grid-card' }));
            loading.appendChild(grid);
        }
        _contentContainer.appendChild(loading);
    }

    // =========================================
    //  Tab Content Loaders
    // =========================================

    function _loadTabContent() {
        _showLoading();
        var api = App.getApi();
        if (!api) { _renderEmpty('Not connected to server'); return; }

        switch (_activeTab) {
            case 'albums':    _loadAlbums(api); break;
            case 'artists':   _loadArtists(api); break;
            case 'songs':     _loadSongs(api); break;
            case 'genres':    _loadGenres(api); break;
            case 'playlists': _loadPlaylists(api); break;
        }
    }

    // --- Albums Tab ---

    function _loadAlbums(api) {
        var expected = _activeTab;
        _lastAlbums = [];

        // Favourites-only short-circuits to the starred album list (no paging).
        if (_favFilter === 'fav') {
            var favAlbums = (typeof StarredCache !== 'undefined' && StarredCache.getAlbums)
                ? StarredCache.getAlbums() : [];
            _lastAlbums = favAlbums.slice();
            if (!_contentContainer) return;
            _contentContainer.textContent = '';
            if (!favAlbums.length) { _renderEmpty('No favourite albums', true); return; }
            var fgrid = el('div', { className: 'library-grid library-albums-grid', id: 'library-grid' });
            _contentContainer.appendChild(fgrid);
            _appendAlbumsToGrid(fgrid, favAlbums, api);
            _registerGridZone(_getGridColumnCount(fgrid) || 6);
            return;
        }

        var libraryIds = AuthManager.getSelectedLibraries();
        var multi = libraryIds && libraryIds.length >= 2;
        var seenIds = multi ? {} : null;
        var apiOffset = 0;
        var apiExhausted = false;

        function fetchPage(count, loaderOffset) {
            if (!multi) return api.getAlbumList2('alphabeticalByName', count, loaderOffset, libraryIds);
            var collected = [];
            function step() {
                if (apiExhausted || collected.length >= count) return Promise.resolve(collected.slice(0, count));
                return api.getAlbumList2('alphabeticalByName', count, apiOffset, libraryIds).then(function(albums) {
                    apiOffset += count;
                    if (!albums.length) { apiExhausted = true; return collected; }
                    if (albums.length < count) apiExhausted = true;
                    for (var i = 0; i < albums.length; i++) {
                        var a = albums[i], id = a && a.id;
                        if (id === undefined || id === null) { collected.push(a); continue; }
                        if (seenIds[id]) continue;
                        seenIds[id] = true;
                        collected.push(a);
                    }
                    return step();
                });
            }
            return step();
        }

        _albumLoader = new SonanceUtils.PaginatedLoader(fetchPage, 50);
        _albumLoader.loadNext(function(albums, hasMore) {
            if (_activeTab !== expected) return;
            if (!_contentContainer) return;
            albums = _filterByFav(albums, 'album'); // nofav at page level
            _contentContainer.textContent = '';
            if (albums.length === 0 && !hasMore) { _renderEmpty('No albums found'); return; }
            var grid = el('div', { className: 'library-grid library-albums-grid', id: 'library-grid' });
            _contentContainer.appendChild(grid);
            _lastAlbums = _lastAlbums.concat(albums);
            _appendAlbumsToGrid(grid, albums, api);
            _updateLoadingIndicator(hasMore);
            _registerAlbumsGridZone(_getGridColumnCount(grid) || 8, api);
        });
    }

    function _appendAlbumsToGrid(grid, albums, api) {
        albums.forEach(function(album) {
            var card = el('div', {
                className: 'album-grid-card focusable',
                'data-album-id': album.id,
                'data-album-title': album.name || album.title || ''
            });
            card.appendChild(SonanceComponents.renderAlbumArt(album, 0, api));
            var info = el('div', { className: 'album-grid-info' });
            info.appendChild(el('div', { className: 'album-grid-title' }, album.name || 'Unknown'));
            var meta = album._metaString;
            if (typeof meta !== 'string' || !meta) {
                meta = album.artist || 'Unknown Artist';
                if (album.year) meta += ' · ' + album.year;
            }
            info.appendChild(el('div', { className: 'album-grid-meta' }, meta));
            card.appendChild(info);
            grid.appendChild(card);
        });
    }

    function _updateLoadingIndicator(hasMore) {
        var existing = document.getElementById('library-loading-more');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        if (hasMore && _contentContainer) {
            _contentContainer.appendChild(el('div', { className: 'library-loading-more', id: 'library-loading-more' }, 'Loading...'));
        }
    }

    function _registerAlbumsGridZone(cols, api) {
        FocusManager.registerZone('library-grid', {
            selector: '#library-grid .focusable',
            columns: cols,
            onActivate: function(idx, element) {
                if (App.saveCurrentFocus) App.saveCurrentFocus();
                element.click();
            },
            onFocus: function(idx, element) {
                _scrollToFocused(_getScrollContainer(), element);
                if (_albumLoader && _albumLoader.hasMore && !_albumLoader.loading) {
                    var elements = document.querySelectorAll('#library-grid .focusable');
                    if (elements.length - idx <= 5) {
                        _albumLoader.loadNext(function(albums, hasMore) {
                            if (_activeTab !== 'albums') return;
                            albums = _filterByFav(albums, 'album');
                            var grid = document.getElementById('library-grid');
                            if (grid) {
                                _lastAlbums = _lastAlbums.concat(albums);
                                _appendAlbumsToGrid(grid, albums, api);
                            }
                            _updateLoadingIndicator(hasMore);
                            _registerAlbumsGridZone(grid ? (_getGridColumnCount(grid) || cols) : cols, api);
                        });
                    }
                }
            },
            neighbors: { up: 'library-tabs' }
        });
        App.hideColourHints();
    }

    // --- Artists Tab ---

    function _loadArtists(api) {
        var expected = _activeTab;
        if (_favFilter === 'fav') {
            var favArtists = (typeof StarredCache !== 'undefined' && StarredCache.getArtists)
                ? StarredCache.getArtists() : [];
            _renderArtists(favArtists, api, true);
            return;
        }
        var libraryIds = AuthManager.getSelectedLibraries();
        api.getArtists(libraryIds).then(function(artists) {
            if (_activeTab !== expected) return;
            _renderArtists(_filterByFav(artists || [], 'artist'), api, false);
        }).catch(function(err) {
            if (_activeTab !== expected) return;
            _renderEmpty('Unable to load artists');
        });
    }

    function _renderArtistCard(artist, api) {
        var card = el('div', { className: 'artist-grid-card focusable', 'data-artist-id': artist.id });
        card.appendChild(SonanceComponents.renderArtistAvatar(artist, 140, api));
        card.appendChild(el('div', { className: 'artist-grid-name' }, artist.name || 'Unknown'));
        var albumCount = artist.albumCount || 0;
        card.appendChild(el('div', { className: 'artist-grid-count' }, albumCount + ' album' + (albumCount !== 1 ? 's' : '')));
        return card;
    }

    function _renderArtists(artists, api, isFav) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        _lastArtists = artists.slice();
        if (artists.length === 0) {
            _renderEmpty(isFav ? 'No favourite artists' : 'No artists found', isFav);
            return;
        }
        _artistsAll = artists;
        _artistsRenderedCount = 0;
        if (artists.length > ARTISTS_VIRTUAL_THRESHOLD) _renderArtistsVirtual(artists, api);
        else _renderArtistsChunked(artists, api);
    }

    function _renderArtistsChunked(artists, api) {
        var grid = el('div', { className: 'library-grid library-artists-grid', id: 'library-grid' });
        _contentContainer.appendChild(grid);
        _artistsChunkedZoneRegistered = false;
        function appendChunk() {
            _artistsChunkRaf = null;
            if (_activeTab !== 'artists' || !_artistsAll || !grid.parentNode) return;
            var stop = Math.min(artists.length, _artistsRenderedCount + ARTISTS_CHUNK_SIZE);
            for (var i = _artistsRenderedCount; i < stop; i++) grid.appendChild(_renderArtistCard(artists[i], api));
            _artistsRenderedCount = stop;
            if (_artistsRenderedCount < artists.length) {
                _artistsChunkRaf = requestAnimationFrame(appendChunk);
            } else if (!_artistsChunkedZoneRegistered) {
                _registerGridZone(_getGridColumnCount(grid) || 6);
                _artistsChunkedZoneRegistered = true;
            }
        }
        if (_artistsChunkRaf !== null) cancelAnimationFrame(_artistsChunkRaf);
        _artistsChunkRaf = requestAnimationFrame(appendChunk);
    }

    function _renderArtistsVirtual(artists, api) {
        var mount = el('div', { className: 'library-artists-virtual-mount', id: 'library-grid' });
        _contentContainer.appendChild(mount);
        var scrollContainer = _getScrollContainer();
        if (!scrollContainer) { _renderArtistsChunked(artists, api); return; }
        _artistsVirtualGrid = new SonanceUtils.VirtualGrid({
            scrollContainer: scrollContainer,
            mountContainer: mount,
            items: artists,
            renderItem: function(artist) { return _renderArtistCard(artist, api); },
            itemHeight: ARTIST_ITEM_HEIGHT,
            itemMinWidth: ARTIST_ITEM_MIN_WIDTH,
            gridClassName: 'library-grid library-artists-grid',
            bufferRows: 2,
            onRangeRender: function() {
                if (FocusManager.getActiveZone && FocusManager.getActiveZone() === 'library-grid') {
                    var focused = FocusManager.getCurrentFocused();
                    if (!focused || !focused.parentNode) {
                        setTimeout(function() {
                            if (FocusManager.getActiveZone() === 'library-grid') FocusManager.setActiveZone('library-grid', undefined, true);
                        }, 0);
                    }
                }
            }
        });
        _artistsVirtualGrid.init();
        _registerVirtualZone(_artistsVirtualGrid, _getGridColumnCount);
    }

    // Generic virtual-zone registration shared by artists + songs.
    function _registerVirtualZone(vgrid, _unused) {
        var cols = vgrid.getColumns();
        FocusManager.registerZone('library-grid', {
            selector: '#library-grid .focusable',
            columns: cols,
            virtual: {
                getCount: function() { return vgrid ? vgrid.getCount() : 0; },
                getItemAt: function(idx) { return vgrid ? vgrid.ensureIndexVisible(idx) : null; }
            },
            onActivate: function(idx, element) {
                if (App.saveCurrentFocus) App.saveCurrentFocus();
                if (element) element.click();
            },
            onFocus: function() {},
            neighbors: { up: 'library-tabs' }
        });
        App.hideColourHints();
    }

    // --- Songs Tab (virtualized) ---

    function _loadSongs(api) {
        var expected = _activeTab;
        if (_favFilter === 'fav') {
            var favSongs = (typeof StarredCache !== 'undefined' && StarredCache.getSongs)
                ? StarredCache.getSongs() : [];
            _renderSongs(favSongs, api, true);
            return;
        }
        var libraryIds = AuthManager.getSelectedLibraries();
        api.getRandomSongs(100, libraryIds).then(function(songs) {
            if (_activeTab !== expected) return;
            _renderSongs(_filterByFav(songs || [], 'song'), api, false);
        }).catch(function(err) {
            if (_activeTab !== expected) return;
            _renderEmpty('Unable to load songs');
        });
    }

    function _renderSongRow(song, index) {
        var row = el('div', { className: 'song-row focusable', 'data-song-id': song.id, 'data-song-index': String(index) });
        row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));
        var info = el('div', { className: 'song-row-info' });
        info.appendChild(el('div', { className: 'song-row-title' }, song.title || 'Unknown'));
        var meta = song.artist || 'Unknown Artist';
        if (song.album) meta += ' · ' + song.album;
        info.appendChild(el('div', { className: 'song-row-meta' }, meta));
        row.appendChild(info);
        row.appendChild(el('div', { className: 'song-row-duration' }, (song._formattedDuration || formatDuration(song.duration))));
        return row;
    }

    function _renderSongs(songs, api, isFav) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        _currentSongs = songs;
        if (songs.length === 0) {
            _currentSongs = null;
            _renderEmpty(isFav ? 'No favourite songs' : 'No songs found', isFav);
            return;
        }

        if (songs.length > SONGS_VIRTUAL_THRESHOLD) {
            var mount = el('div', { className: 'library-songs-virtual-mount', id: 'library-grid' });
            _contentContainer.appendChild(mount);
            var scrollContainer = _getScrollContainer();
            if (scrollContainer) {
                _songsVirtualGrid = new SonanceUtils.VirtualGrid({
                    scrollContainer: scrollContainer,
                    mountContainer: mount,
                    items: songs,
                    renderItem: function(song, index) { return _renderSongRow(song, index); },
                    itemHeight: SONG_ITEM_HEIGHT,
                    itemMinWidth: 0, // force single column
                    gridClassName: 'library-song-grid',
                    bufferRows: 4,
                    onRangeRender: function() {
                        if (FocusManager.getActiveZone() === 'library-grid') {
                            var f = FocusManager.getCurrentFocused();
                            if (!f || !f.parentNode) {
                                setTimeout(function() {
                                    if (FocusManager.getActiveZone() === 'library-grid') FocusManager.setActiveZone('library-grid', undefined, true);
                                }, 0);
                            }
                        }
                    }
                });
                _songsVirtualGrid.init();
                _registerSongsVirtualZone();
                return;
            }
        }

        // Small list: plain render
        var list = el('div', { className: 'library-song-list', id: 'library-grid' });
        songs.forEach(function(song, index) { list.appendChild(_renderSongRow(song, index)); });
        _contentContainer.appendChild(list);
        _registerGridZone(1);
    }

    function _registerSongsVirtualZone() {
        var vgrid = _songsVirtualGrid;
        var zoneConfig = {
            selector: '#library-grid .focusable',
            columns: 1,
            virtual: {
                getCount: function() { return vgrid ? vgrid.getCount() : 0; },
                getItemAt: function(idx) { return vgrid ? vgrid.ensureIndexVisible(idx) : null; }
            },
            onActivate: function(idx, element) { if (element) element.click(); },
            onFocus: function() {},
            neighbors: { up: 'library-tabs' }
        };
        _attachSongColourButtons(zoneConfig);
        FocusManager.registerZone('library-grid', zoneConfig);
    }

    // --- Genres Tab ---

    function _loadGenres(api) {
        var expected = _activeTab;
        api.getGenres().then(function(genres) {
            if (_activeTab !== expected) return;
            _renderGenres(genres || []);
        }).catch(function() {
            if (_activeTab !== expected) return;
            _renderEmpty('Unable to load genres');
        });
    }

    var GENRE_GRADIENTS = [
        'linear-gradient(135deg, #7c3aed, #4f46e5)',
        'linear-gradient(135deg, #0891b2, #0e7490)',
        'linear-gradient(135deg, #e44d8a, #be185d)',
        'linear-gradient(135deg, #ea580c, #c2410c)',
        'linear-gradient(135deg, #16a34a, #15803d)',
        'linear-gradient(135deg, #ca8a04, #a16207)',
        'linear-gradient(135deg, #2563eb, #1d4ed8)',
        'linear-gradient(135deg, #dc2626, #b91c1c)',
        'linear-gradient(135deg, #7c3aed, #be185d)',
        'linear-gradient(135deg, #0891b2, #16a34a)',
        'linear-gradient(135deg, #ea580c, #ca8a04)',
        'linear-gradient(135deg, #2563eb, #7c3aed)'
    ];

    function _renderGenres(genres) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        if (genres.length === 0) { _renderEmpty('No genres found'); return; }
        var grid = el('div', { className: 'library-grid library-genres-grid', id: 'library-grid' });
        genres.forEach(function(genre, index) {
            var name = genre.value || genre.name || 'Unknown';
            var card = el('div', { className: 'genre-card focusable', 'data-genre': name });
            card.style.background = GENRE_GRADIENTS[index % GENRE_GRADIENTS.length];
            card.appendChild(el('div', { className: 'genre-card-name' }, name));
            var countParts = [];
            if (genre.albumCount) countParts.push(genre.albumCount + ' albums');
            if (genre.songCount) countParts.push(genre.songCount + ' songs');
            if (countParts.length) card.appendChild(el('div', { className: 'genre-card-count' }, countParts.join(' · ')));
            grid.appendChild(card);
        });
        _contentContainer.appendChild(grid);
        _registerGridZone(4);
    }

    // --- Playlists Tab ---

    function _loadPlaylists(api) {
        var expected = _activeTab;
        api.getPlaylists().then(function(playlists) {
            if (_activeTab !== expected) return;
            _renderPlaylistsGrid(playlists || []);
        }).catch(function() {
            if (_activeTab !== expected) return;
            _renderEmpty('Unable to load playlists');
        });
    }

    function _renderPlaylistsGrid(playlists) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        _lastPlaylists = playlists.slice();
        if (playlists.length === 0) { _renderEmpty('No playlists yet'); return; }
        var grid = el('div', { className: 'library-grid library-playlists-grid', id: 'library-grid' });
        playlists.forEach(function(pl) {
            var colors = SonanceComponents.hashColor(pl.name || '');
            var card = el('div', { className: 'playlist-card library-playlist-card focusable', 'data-playlist-id': pl.id });
            card.style.background = 'linear-gradient(135deg, ' + colors.base + ' 0%, var(--bg-card) 100%)';
            card.appendChild(el('div', { className: 'playlist-card-name' }, pl.name || 'Untitled'));
            card.appendChild(el('div', { className: 'playlist-card-count' }, (pl.songCount || 0) + ' tracks'));
            grid.appendChild(card);
        });
        _contentContainer.appendChild(grid);
        _registerGridZone(4);
    }

    // =========================================
    //  Genre Song Browsing
    // =========================================

    function _loadGenreSongs(api, genreName) {
        if (!_contentContainer) return;
        FocusManager.unregisterZone('library-grid');
        _contentContainer.textContent = '';
        _updateActionButtons();
        var header = el('div', { className: 'genre-songs-header' });
        header.appendChild(el('div', { className: 'genre-songs-title' }, genreName));
        _contentContainer.appendChild(header);
        var loadingWrap = el('div', { id: 'library-grid' });
        for (var i = 0; i < 10; i++) loadingWrap.appendChild(el('div', { className: 'skeleton skeleton-song-row' }));
        _contentContainer.appendChild(loadingWrap);
        var libraryIds = AuthManager.getSelectedLibraries();
        api.getSongsByGenre(genreName, 50, 0, libraryIds).then(function(songs) {
            if (!_genreMode || _currentGenre !== genreName) return;
            _renderGenreSongs(songs || [], api, genreName);
        }).catch(function() {
            if (!_genreMode || _currentGenre !== genreName) return;
            var gridEl = document.getElementById('library-grid');
            if (gridEl) { gridEl.textContent = ''; gridEl.appendChild(el('div', { className: 'home-empty' }, 'Unable to load songs for ' + genreName)); }
        });
    }

    function handleBack() {
        if (!_genreMode) return false;
        _genreMode = false;
        _currentGenre = null;
        _activeTab = 'genres';
        _updateActionButtons();
        if (App.zoomContent) {
            App.zoomContent(_contentContainer, function() { _switchTab('genres'); }, 'out');
        } else {
            _switchTab('genres');
        }
        var restored = (App.tryRestoreFocus) ? App.tryRestoreFocus() : false;
        if (!restored) FocusManager.setActiveZone('library-tabs', _tabIndex('genres'), true);
        return true;
    }

    function _renderGenreSongs(songs, api, genreName) {
        var gridEl = document.getElementById('library-grid');
        if (gridEl && gridEl.parentNode) gridEl.parentNode.removeChild(gridEl);
        if (!_contentContainer) return;
        _currentSongs = songs;
        if (songs.length === 0) {
            _contentContainer.appendChild(el('div', { className: 'home-empty library-empty' }, 'No songs found in ' + genreName));
            return;
        }
        var list = el('div', { className: 'library-song-list', id: 'library-grid' });
        songs.forEach(function(song, index) {
            var rowAttrs = { className: 'song-row focusable', 'data-song-id': song.id, 'data-song-index': String(index) };
            if (song.albumId) { rowAttrs['data-album-id'] = song.albumId; rowAttrs['data-album-title'] = song.album || ''; }
            var row = el('div', rowAttrs);
            row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));
            var info = el('div', { className: 'song-row-info' });
            info.appendChild(el('div', { className: 'song-row-title' }, song.title || 'Unknown'));
            var meta = song.artist || 'Unknown Artist';
            if (song.album) meta += ' · ' + song.album;
            info.appendChild(el('div', { className: 'song-row-meta' }, meta));
            row.appendChild(info);
            row.appendChild(el('div', { className: 'song-row-duration' }, (song._formattedDuration || formatDuration(song.duration))));
            list.appendChild(row);
        });
        _contentContainer.appendChild(list);
        _registerGridZone(1);
        FocusManager.setActiveZone('library-grid', 0, true);
    }

    // =========================================
    //  Grid Column Count Helper
    // =========================================

    function _getGridColumnCount(gridEl) {
        if (!gridEl || !gridEl.children || gridEl.children.length === 0) return 0;
        var style = window.getComputedStyle(gridEl);
        var cols = style.getPropertyValue('grid-template-columns');
        if (cols) return cols.split(/\s+/).length;
        return 0;
    }

    // =========================================
    //  Focus Zone Registration (non-paginated grids + song lists)
    // =========================================

    function _attachSongColourButtons(zoneConfig) {
        if (_currentSongs && _currentSongs.length > 0) {
            zoneConfig.onColourButton = function(colour, idx) {
                var track = _currentSongs[idx];
                if (!track) return;
                if (colour === 'yellow') { Player.addToQueue(track); App.showToast('Added to queue'); }
                else if (colour === 'blue') { Player.addToQueueNext(track); App.showToast('Playing next'); }
            };
            App.showColourHints([
                { colour: 'yellow', label: 'Add to queue' },
                { colour: 'blue', label: 'Play next' }
            ]);
        } else {
            App.hideColourHints();
        }
    }

    function _registerGridZone(cols) {
        var zoneConfig = {
            selector: '#library-grid .focusable',
            columns: cols,
            onActivate: function(idx, element) {
                if (App.saveCurrentFocus) App.saveCurrentFocus();
                element.click();
            },
            onFocus: function(idx, element) { _scrollToFocused(_getScrollContainer(), element); },
            neighbors: { up: 'library-tabs' }
        };
        if (cols === 1) _attachSongColourButtons(zoneConfig);
        else App.hideColourHints();
        FocusManager.registerZone('library-grid', zoneConfig);
    }

    // =========================================
    //  Empty State (centered icon + message)
    // =========================================

    function _renderEmpty(message, isFavEmpty) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        var empty = el('div', { className: 'library-empty-state' });
        var icon = createStarSvg(!!isFavEmpty);
        icon.classList.add('library-empty-icon');
        empty.appendChild(icon);
        empty.appendChild(el('div', { className: 'library-empty-msg' }, message));
        _contentContainer.appendChild(empty);
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _container = null;
        _contentContainer = null;
        _genreMode = false;
        _currentGenre = null;
        _currentSongs = null;
        _albumLoader = null;
        _teardownTransient();
    }

    function getActiveTab() { return _activeTab; }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate,
        handleBack: handleBack,
        getActiveTab: getActiveTab
    };
})();
