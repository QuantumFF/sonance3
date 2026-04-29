/* ============================================
   Sonance — Playlists Screen
   3-column grid of playlists + playlist detail
   ============================================ */

var PlaylistsScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _playlists = [];
    var _detailMode = false;
    var _currentPlaylist = null;
    var _currentPlaylistSongs = null; // Song data for colour button support

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(element) {
        var container = document.querySelector('.playlists-screen');
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

        var wrapper = el('div', { className: 'playlists-screen' });

        // Loading skeleton — 3-column grid
        var grid = el('div', { className: 'playlists-grid', id: 'playlists-grid' });
        for (var i = 0; i < 6; i++) {
            var skel = el('div', { className: 'skeleton' });
            skel.style.minHeight = '120px';
            skel.style.borderRadius = '14px';
            grid.appendChild(skel);
        }
        wrapper.appendChild(grid);

        container.appendChild(wrapper);
        log('Playlists', 'Playlists screen rendered (loading)');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _detailMode = false;
        _currentPlaylist = null;

        // If params contain a playlist ID, go directly to detail
        if (params && params.id) {
            _loadPlaylistDetail(params.id);
            return;
        }

        _loadPlaylists();
    }

    // =========================================
    //  Load Playlists Grid
    // =========================================

    // V3-2: `opts.zoom` triggers an in-screen zoom-out when coming back from
    // detail mode. Default (activate / fresh) skips animation.
    function _loadPlaylists(opts) {
        var zoom = opts && opts.zoom;
        var api = App.getApi();
        if (!api) return;

        api.getPlaylists().then(function(playlists) {
            _playlists = playlists || [];
            if (zoom && App.zoomContent) {
                App.zoomContent(_container, function() { _renderGrid(api); }, 'out');
            } else {
                _renderGrid(api);
            }
            _registerGridZones();
            log('Playlists', 'Loaded ' + _playlists.length + ' playlists');
        }).catch(function(err) {
            log('Playlists', 'Error loading playlists: ' + err.message);
            _renderEmpty('Unable to load playlists. Check your connection.');
        });
    }

    function _renderGrid(api) {
        if (!_container) return;
        _container.textContent = '';

        var wrapper = el('div', { className: 'playlists-screen' });

        if (_playlists.length === 0) {
            _container.appendChild(wrapper);
            _renderEmpty('No playlists found. Create playlists in your Navidrome server.');
            return;
        }

        var grid = el('div', { className: 'playlists-grid', id: 'playlists-grid' });

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

            grid.appendChild(card);
        });

        // V3.7-fix10: one delegated click handler for the playlists grid.
        grid.addEventListener('click', function(ev) {
            var c = ev.target.closest('.playlist-card');
            if (!c) return;
            var pid = c.getAttribute('data-playlist-id');
            if (!pid) return;
            _loadPlaylistDetail(pid, { zoom: true });
        });

        wrapper.appendChild(grid);
        _container.appendChild(wrapper);
    }

    function _renderEmpty(message) {
        if (!_container) return;
        _container.textContent = '';

        var empty = el('div', { className: 'playlists-empty' });
        var iconSvg = createSvg(SVG_PATHS.playlist);
        iconSvg.setAttribute('class', 'playlists-empty-icon');
        empty.appendChild(iconSvg);
        empty.appendChild(el('div', { className: 'playlists-empty-text' }, message));
        _container.appendChild(empty);

        FocusManager.registerZone('content', {
            selector: '#content-area .focusable',
            columns: 1,
            onActivate: function() {},
            neighbors: { left: 'topnav', down: 'nowplaying-bar' }
        });
    }

    // =========================================
    //  Playlist Detail
    // =========================================

    // V3-2: `opts.zoom` triggers an in-screen zoom-in when drilling from the
    // playlist grid. `activate`-time calls (entering the screen with a ?id
    // param from Home) leave zoom off because the page-level transition has
    // already animated the entry.
    function _loadPlaylistDetail(playlistId, opts) {
        var zoom = opts && opts.zoom;
        var api = App.getApi();
        if (!api) return;

        _detailMode = true;

        api.getPlaylist(playlistId).then(function(playlist) {
            if (!playlist) {
                _renderEmpty('Playlist not found.');
                return;
            }
            // V3.8: filter entries to the user's selected libraries. Tracks
            // missing the musicFolderId field are kept (defensive default —
            // never silently hide content for missing metadata).
            var libraryIds = AuthManager.getSelectedLibraries();
            if (libraryIds && libraryIds.length && playlist.entry && playlist.entry.length) {
                var allowed = {};
                for (var i = 0; i < libraryIds.length; i++) {
                    allowed[String(libraryIds[i])] = true;
                }
                playlist.entry = playlist.entry.filter(function(track) {
                    if (!track) return false;
                    if (track.musicFolderId === undefined || track.musicFolderId === null) {
                        return true;
                    }
                    return !!allowed[String(track.musicFolderId)];
                });
            }
            _currentPlaylist = playlist;
            if (zoom && App.zoomContent) {
                App.zoomContent(_container, function() { _renderDetail(playlist, api); }, 'in');
            } else {
                _renderDetail(playlist, api);
            }
            _registerDetailZones();
            log('Playlists', 'Loaded playlist: ' + (playlist.name || playlistId) +
                ' (' + ((playlist.entry && playlist.entry.length) || 0) + ' tracks)');
        }).catch(function(err) {
            log('Playlists', 'Error loading playlist: ' + err.message);
            _renderEmpty('Unable to load playlist.');
        });
    }

    function _renderDetail(playlist, api) {
        if (!_container) return;
        _container.textContent = '';
        _currentPlaylistSongs = playlist.entry || [];

        var wrapper = el('div', { className: 'playlists-screen' });

        // Header: playlist name + metadata (hardware Back returns to the grid)
        var header = el('div', { className: 'playlist-detail-header' });

        var infoWrap = el('div', { className: 'playlist-detail-info' });
        infoWrap.appendChild(el('div', { className: 'playlist-detail-name' },
            playlist.name || 'Untitled'));

        var songs = playlist.entry || [];
        infoWrap.appendChild(el('div', { className: 'playlist-detail-count' },
            songs.length + ' tracks'));
        header.appendChild(infoWrap);
        wrapper.appendChild(header);

        // Song list (reuses song-row styles from Library)
        var songList = el('div', { className: 'library-song-list', id: 'playlist-songs' });

        if (songs.length === 0) {
            songList.appendChild(el('div', { className: 'home-empty' }, 'This playlist is empty.'));
        } else {
            songs.forEach(function(song, index) {
                var row = el('div', {
                    className: 'song-row focusable',
                    'data-song-id': song.id,
                    'data-song-index': String(index)
                });

                row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));

                var info = el('div', { className: 'song-row-info' });
                info.appendChild(el('div', { className: 'song-row-title' }, song.title || 'Unknown'));
                var meta = (song.artist || 'Unknown');
                if (song.album) meta += ' \u00B7 ' + song.album;
                info.appendChild(el('div', { className: 'song-row-meta' }, meta));
                row.appendChild(info);

                row.appendChild(el('div', { className: 'song-row-duration' },
                    (song._formattedDuration || formatDuration(song.duration))));

                songList.appendChild(row);
            });
            // V3.7-fix10: delegated click for song rows.
            songList.addEventListener('click', function(ev) {
                var r = ev.target.closest('.song-row');
                if (!r) return;
                var idxStr = r.getAttribute('data-song-index');
                if (idxStr === null) return;
                var idx = parseInt(idxStr, 10);
                if (isNaN(idx) || !songs[idx]) return;
                Player.setQueue(songs, idx);
                log('Playlists', 'Play track ' + (idx + 1) + ': ' + songs[idx].title);
            });
        }

        wrapper.appendChild(songList);
        _container.appendChild(wrapper);
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerGridZones() {
        var cards = document.querySelectorAll('#playlists-grid .focusable');
        if (cards.length === 0) return;

        FocusManager.registerZone('content', {
            selector: '#playlists-grid .focusable',
            columns: 3,
            onActivate: function(idx, element) { element.click(); },
            onFocus: function(idx, element) { _scrollToFocused(element); },
            neighbors: {
                left: 'topnav',
                down: 'nowplaying-bar'
            }
        });

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'content',
                left: 'topnav'
            }
        });

        FocusManager.setActiveZone('content', 0);
    }

    function _registerDetailZones() {
        var songRows = document.querySelectorAll('#playlist-songs .focusable');
        var hasSongs = songRows.length > 0;

        if (hasSongs) {
            FocusManager.registerZone('content', {
                selector: '#playlist-songs .focusable',
                columns: 1,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                onColourButton: function(colour, idx) {
                    if (!_currentPlaylistSongs) return;
                    var track = _currentPlaylistSongs[idx];
                    if (!track) return;
                    if (colour === 'yellow') {
                        Player.addToQueue(track);
                        App.showToast('Added to queue');
                    } else if (colour === 'blue') {
                        Player.addToQueueNext(track);
                        App.showToast('Playing next');
                    }
                },
                neighbors: {
                    left: 'topnav',
                    up: 'topnav',
                    down: 'nowplaying-bar'
                }
            });

            App.showColourHints([
                { colour: 'yellow', label: 'Add to queue' },
                { colour: 'blue', label: 'Play next' }
            ]);
        }

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: hasSongs ? 'content' : 'topnav',
                left: 'topnav'
            }
        });

        if (hasSongs) {
            FocusManager.setActiveZone('content', 0);
        }
    }

    // Back handling for in-screen playlist detail mode — called by App.goBack
    // before its default flow. Returns true when handled.
    function handleBack() {
        if (!_detailMode) return false;
        _detailMode = false;
        _currentPlaylist = null;
        _loadPlaylists({ zoom: true });
        return true;
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _container = null;
        _detailMode = false;
        _currentPlaylist = null;
        _currentPlaylistSongs = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate,
        handleBack: handleBack
    };
})();
