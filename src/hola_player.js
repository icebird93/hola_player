'use strict';
var videojs = window.videojs = require('video.js');
require('./css/videojs.css'); // auto injected
var mime = require('./mime.js');
var util = require('./util.js');
var id3 = require('./id3.js');
var hlsjs_source_handler = require('@hola.org/hap.js/lib/hola_videojs_hls.js');
var flashls_source_handler = require('./flashls_source_handler.js');
var url = require('url');
var map = require('lodash/map');

(function(){
    hlsjs_source_handler.attach();
    flashls_source_handler();
    load_cdn_loader();
})();

var E = window.hola_player = module.exports = hola_player;
E.VERSION = '__VERSION__';
E.players = {};

function hola_player(opt, ready_cb){
    if (typeof opt=='function')
    {
        ready_cb = opt;
        opt = {};
    }
    opt = videojs.mergeOptions(opt); // clone
    var pl = opt.player && typeof opt.player!='string' && opt.player.length
        ? opt.player[0] : opt.player;
    var element = !pl ? document.querySelector('video, object, embed') :
        videojs.isEl(pl) ? pl : document.querySelector(pl);
    if (!element)
        return null;
    if (element.hola_player)
        return element.hola_player;
    if (opt = set_defaults(element, opt))
        return new Player(element, opt, ready_cb);
}

function set_defaults(element, opt){
    opt.autoplay = opt.auto_play || opt.autoplay; // allow both
    opt.base_url = opt.base_url||'//cdn.jsdelivr.net/hola_player/__VERSION__';
    if (opt.video_url)
    {
        opt.sources = [{
            src: opt.video_url,
            type: opt.video_type||mime.guess_link_type(opt.video_url),
        }];
    }
    else if (opt.sources && !opt.sources.length)
        opt.sources = undefined;
    if (['VIDEO', 'DIV', 'OBJECT', 'EMBED'].indexOf(element.tagName)<0)
        return;
    if (element.tagName=='VIDEO')
    {
        if (!opt.sources)
        {
            var sources = element.querySelectorAll('source');
            if (!sources.length)
                return;
            opt.sources =
                Array.prototype.map.call(sources, videojs.getAttributes);
        }
        opt = videojs.mergeOptions(videojs.getAttributes(element), opt);
    }
    return opt.sources && opt;
}

function load_deps(deps){
    deps = deps||{};
    require('@hola.org/videojs-osmf');
    require('@hola.org/videojs-contrib-media-sources');
    if (deps['videojs-settings'])
        require('@hola.org/videojs-settings');
    if (deps['videojs-hola-skin'])
    {
        require('@hola.org/videojs-hola-skin');
        require('./css/videojs-hola-skin.css');
    }
    if (deps['videojs-thumbnails'])
    {
        require('@hola.org/videojs-thumbnails');
        require('./css/videojs-thumbnails.css');
    }
    if (deps['videojs-contrib-ads'])
    {
        require('@hola.org/videojs-contrib-ads');
        require('./css/videojs-contrib-ads.css');
    }
    if (deps['videojs-ima'])
    {
        require('@hola.org/videojs-ima');
        require('./css/videojs-ima.css');
    }
    if (deps['videojs-contrib-dash'])
    {
        window.dashjs = {
            MediaPlayer: require('dashjs/dist/dash.mediaplayer.debug.js'),
        };
        require('videojs-contrib-dash');
    }
    if (deps.dvr)
    {
        require('./dvr.js');
        require('./css/dvr.css');
    }
}

function Player(element, opt, ready_cb){
    this.ready_cb = ready_cb;
    this.opt = opt;
    this.element = this.init_element(element);
    this.vjs = this.init_vjs();
    E.players[this.id = this.vjs.id()] = this;
}

Player.prototype.init_element = function(element){
    var opt = this.opt;
    if (element.tagName=='VIDEO')
    {
        element.autoplay = false;
        element.controls = false;
        // with Hola player wrapper there is no autoSetup mode
        // XXX: maybe we should merge data-setup conf with vjs_opt
        element.removeAttribute('data-setup');
        // XXX bahaa: find a better solution
        reset_native_hls(element, opt.sources);
    }
    else
    {
        // special case when using a div container or flash object - create
        // video tag instead
        var style = window.getComputedStyle(element);
        var attrs = {
            id: util.unique_id('hola_player'),
            class: 'video-js',
            preload: opt.preload||'auto',
            width: opt.width||parseFloat(style.width),
            height: opt.height||parseFloat(style.height),
        };
        if (opt.poster)
            attrs.poster = opt.poster;
        var videoel = videojs.createEl('video', {}, attrs);
        videojs.appendContent(videoel, opt.sources.map(function(source){
            return videojs.createEl('source', {}, source);
        }));
        videoel.style.position = style.position=='static' ?
            'relative' : style.position;
        videoel.style.left = style.left;
        videoel.style.top = style.top;
        // $(videoel).insertAfter(element);
        element.parentNode.insertBefore(videoel, element.nextSibling);
        element.style.display = 'none';
        element.hola_player = this;
        element = videoel;
    }
    if (!element.id)
        element.id = util.unique_id('hola_player');
    element.hola_player = this;
    return element;
};

Player.prototype.init_vjs = function(){
    var opt = this.opt, cb = this.ready_cb, hola_player = this;
    var vjs_opt = this.get_vjs_opt();
    load_deps({
        'videojs-settings': !!vjs_opt.plugins.settings,
        'videojs-hola-skin': !!vjs_opt.plugins.hola_skin,
        'videojs-thumbnails': !!opt.thumbnails,
        'videojs-contrib-ads': !!opt.ads,
        'videojs-ima': !!opt.ads,
        'videojs-contrib-dash': opt.sources.some(function(s){
            return mime.is_dash_link(s.src) || mime.is_dash_type(s.type);
        }),
        dvr: opt.dvr,
    });
    return videojs(this.element, vjs_opt, function(){
        var player = this;
        if (player.tech_ && opt.controls)
            player.controls(true);
        if (opt.thumbnails)
            player.thumbnails(opt.thumbnails);
        hola_player.init_ads(player);
        player.on('pause', function(e){
            if (player.scrubbing()) // XXX bahaa: do we need this?
                e.stopImmediatePropagation();
        }).on('save_logs', function(e){
            // XXX bahaa: TODO
        }).on('problem_report', function(e){
            // XXX bahaa: TODO
        }).on('cdn_graph_overlay', on_cdn_graph_overlay);
        if (cb)
            try { cb(player); } catch(e){ console.error(e.stack||e); }
        if (opt.autoplay &&
            !videojs.browser.IS_ANDROID && !videojs.browser.IS_IOS)
        {
            player.play();
            player.autoplay(true);
        }
    }).on('error', function (){
        var player = this;
        var error = player.error;
        if (!error || error.code!=error.MEDIA_ERR_SRC_NOT_SUPPORTED)
            return;
        var only_flash = opt.sources.every(function(s){
            return mime.is_hds_link(s.src) || mime.is_flv_link(s.src);
        });
        var flash = videojs.getTech('Flash');
        var modal = player.getChild('errorDisplay');
        if (modal && only_flash && (!flash || !flash.isSupported()))
            modal.fillWith('Flash plugin is required to play this media');
    });
};

function on_cdn_graph_overlay(){
    var hola_cdn = window.hola_cdn;
    var bws = hola_cdn && hola_cdn._get_bws();
    if (window.cdn_graph || !bws || hola_cdn._get_mode()!='cdn')
        return;
    try {
        var ldr = hola_cdn.get_wrapper().loader;
        var gopt = {
            graph: 'newgraph_progress_mode_highlight_tips',
            player_obj: bws.player,
            video: bws.player.vjs
        };
        var url = '//player.h-cdn.com'+hola_cdn.require.zdot('cdngraph_js');
        ldr.util.load_script(url, function(){
            window.cdn_graph.init(gopt, bws, ldr); });
    } catch(err){ console.error(err.stack||err); }
}

Player.prototype.get_settings_opt = function(){
    var opt = this.opt, s = opt.settings;
    if (s===false)
        return;
    s = videojs.mergeOptions({graph: opt.graph, volume: opt.volume}, s);
    if (s.quality!==false)
        s.quality = {sources: opt.sources};
    return s;
};

Player.prototype.get_vjs_opt = function(){
    var opt = this.opt;
    return videojs.mergeOptions({
        sources: opt.sources,
        // XXX arik: unite swf to one
        osmf: {swf: opt.osmf_swf||opt.base_url+'/videojs-osmf.swf'},
        flash: {
            swf: opt.swf||opt.base_url+'/videojs.swf',
            accelerated: opt.accelerated,
        },
        html5: {
            hlsjsConfig: {
                debug: false,
                fragLoadingLoopThreshold: 1000,
                manifestLoadingTimeOut: 20*1000,
                manifestLoadingMaxRetry: 4,
                levelLoadingTimeOut: 20*1000,
                levelLoadingMaxRetry: 4,
                xhrSetup: opt.withCredentials && function(xhr){
                    xhr.withCredentials = true;
                },
            },
        },
        inactivityTimeout: opt.inactivity_timeout===undefined ?
            2000 : opt.inactivity_timeout,
        poster: opt.poster,
        loop: opt.loop,
        muted: opt.muted,
        preload: opt.preload,
        techOrder:
            (opt.tech=='flash' ? ['flash', 'html5'] : ['html5', 'flash'])
            .concat('osmf'),
        tooltips: true,
        plugins: {
            settings: this.get_settings_opt(),
            dvr: opt.dvr,
            hola_skin: opt.skin ? false : {
                css: false,
                no_play_transform: opt.no_play_transform,
                show_controls_before_start: opt.show_controls_before_start,
                show_time_for_live: opt.show_time_for_live,
            },
        },
    }, opt.videojs_options);
};

Player.prototype.init_ads = function(player){
    var init = function(){
        player.ima.initializeAdDisplayContainer();
        if (!opt.ads.manual)
            player.ima.requestAds();
    };
    var opt = this.opt;
    if (!opt.ads)
        return;
    if (opt.ads.id3)
        opt.ads.manual = true;
    if (!opt.ads.adTagUrl && !opt.ads.adsResponse && !opt.ads.manual)
        return console.error('missing Ad Tag');
    if (!window.google) // missing external <script> or blocked by AdBlocker
        return console.error('missing IMA HTML5 SDK');
    if (!player.ads || !player.ima) // shouldn't happen as they're bundled
        return console.error('missing ad modules');
    player.ima(videojs.mergeOptions({
        id: player.id(),
        contribAdsSettings: {
            prerollTimeout: 1000,
            postrollTimeout: 1000,
            disablePlayContentBehindAd: true,
        },
    }, opt.ads));
    if (videojs.browser.IS_ANDROID || videojs.browser.IS_IOS)
        player.one('touchend', init);
    else
        init();
    // avoid it eating clicks while ad isn't playing
    if (player.ima.adContainerDiv)
        player.ima.adContainerDiv.style.display = 'none';
    if (opt.ads.id3)
        init_ads_id3(player);
};

function init_ads_id3(player){
    var cues = [], played_cues = {};
    player.trigger('adsready');
    player.trigger('nopreroll');
    player.on('timeupdate', function(){
        var cur = player.currentTime();
        cues.forEach(function(cue){
            if (played_cues[cue.time] || cur<cue.time || cur-cue.time>0.5)
                return;
            player.ima.playAd(cue.ad);
            played_cues[cue.time] = true;
        });
    });
    player.tech_.on('parsedmetadata', function(e, data){
        var sample = data && data.samples && data.samples[0];
        var tags = id3.parse_id3(sample.data||sample.unit);
        var ad = tags.TXXX && tags.TXXX.adID;
        if (ad && cues.indexOf(sample.dts)<0)
        {
            cues.push({ad: ad, time: sample.dts});
            player.trigger('ads-cuepoints', map(cues, 'time'));
        }
    });
}

function reset_native_hls(el, sources){
    var is_hls = function(s){
        return mime.is_hls_link(s.src) || mime.is_hls_type(s.type); };
    // not using el.currentSrc because it might not be selected yet.
    if (!el.canPlayType('application/x-mpegurl') || !sources.some(is_hls))
        return;
    // if source is hls and browser supports hls natively reset video element
    // so videojs will select our hls source handler instead of native.
    el.src = '';
    el.load();
}

function load_cdn_loader(){
    var script = util.current_script();
    if (!script)
        return;
    var customer = url.parse(script.src, true, true).query.customer;
    if (!customer)
        return;
    if (document.querySelector('script[src*="//player.h-cdn.com/loader"]'))
    {
        console.warn('Hola loader.js is included with Hola Player. '
            +'There is no need to load it separately');
        return;
    }
    console.log('Adding CDN loader...');
    util.load_script('//player.h-cdn.com/loader.js?customer='+customer,
        undefined, {async: true, crossOrigin: 'anonymous'});
}
