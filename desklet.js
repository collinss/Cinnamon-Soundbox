const Desklet = imports.ui.desklet;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;

const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gvc = imports.gi.Gvc;
const St = imports.gi.St;

const Params = imports.misc.params;
const Util = imports.misc.util;

const DBus = imports.dbus;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const UUID = "soundBox@scollins";
const SLIDER_SCROLL_STEP = 0.05;
const ICON_SIZE = 28;

const PropIFace = {
    name: 'org.freedesktop.DBus.Properties',
    signals: [{ name: 'PropertiesChanged',
                inSignature: 'a{sv}'}]
};

const MediaServer2IFace = {
    name: 'org.mpris.MediaPlayer2',
    methods: [{ name: 'Raise',
                inSignature: '',
                outSignature: '' },
              { name: 'Quit',
                inSignature: '',
                outSignature: '' }],
    properties: [{ name: 'CanRaise',
                   signature: 'b',
                   access: 'read'},
                 { name: 'CanQuit',
                   signature: 'b',
                   access: 'read'}],
};

const MediaServer2PlayerIFace = {
    name: 'org.mpris.MediaPlayer2.Player',
    methods: [{ name: 'PlayPause',
                inSignature: '',
                outSignature: '' },
              { name: 'Pause',
                inSignature: '',
                outSignature: '' },
              { name: 'Play',
                inSignature: '',
                outSignature: '' },
              { name: 'Stop',
                inSignature: '',
                outSignature: '' },
              { name: 'Next',
                inSignature: '',
                outSignature: '' },
              { name: 'Previous',
                inSignature: '',
                outSignature: '' },
              { name: 'SetPosition',
                inSignature: 'ox',
                outSignature: '' }],
    properties: [{ name: 'Metadata',
                   signature: 'a{sv}',
                   access: 'read'},
                 { name: 'Shuffle',
                   signature: 'b',
                   access: 'readwrite'},
                 { name: 'Rate',
                   signature: 'd',
                   access: 'readwrite'},
                 { name: 'LoopStatus',
                   signature: 'b',
                   access: 'readwrite'},
                 { name: 'Volume',
                   signature: 'd',
                   access: 'readwrite'},
                 { name: 'PlaybackStatus',
                   signature: 's',
                   access: 'read'},
                 { name: 'Position',
                   signature: 'x',
                   access: 'read'},
                 { name: 'CanGoNext',
                   signature: 'b',
                   access: 'read'},
                 { name: 'CanGoPrevious',
                   signature: 'b',
                   access: 'read'},
                 { name: 'CanPlay',
                   signature: 'b',
                   access: 'read'},
                 { name: 'CanPause',
                   signature: 'b',
                   access: 'read'},
                 { name: 'CanSeek',
                   signature: 'b',
                   access: 'read'}],
    signals: [{ name: 'Seeked',
                inSignature: 'x' }]
};


let supported_players = {
    "amarok":           { seek: true },
    "atunes":           { seek: false },
    "audacious":        { seek: true },
    "banshee":          { seek: true },
    "beatbox":          { seek: false },
    "bmp":              { seek: false },
    "clementine":       { seek: true },
    "deadbeef":         { seek: true },
    "exaile":           { seek: false },
    "gmusicbrowser":    { seek: true },
    "gnome-mplayer":    { seek: true },
    "googlemusicframe": { seek: false },
    "guayadeque":       { seek: false },
    "mpd":              { seek: false },
    "muine":            { seek: false },
    "musique":          { seek: false },
    "noise":            { seek: true },
    "nuvolaplayer":     { seek: false },
    "pithos":           { seek: false },
    "potamus":          { seek: false },
    "pragha":           { seek: true },
    "qmmp":             { seek: true },
    "quodlibet":        { seek: true },
    "rhythmbox":        { seek: true },
    "rhythmbox3":       { seek: true },
    "songbird":         { seek: false },
    "smplayer":         { seek: false },
    "spotify":          { seek: true, timeIssues: true },
    "tomahawk":         { seek: false },
    "totem":            { seek: false },
    "vlc":              { seek: true },
    "xbmc":             { seek: false },
    "xmms":             { seek: false },
    "xnoise":           { seek: true }
}

let inhibitor, settings;

let desklet_raised = false;


function TimeTracker() {
    this._init();
}

TimeTracker.prototype = {
    _init: function() {
        this.startCount = 0;
        this.totalCount = 0;
    },
    
    setTotal: function(total) {
        this.totalCount = total;
    },
    
    setCurrent: function(current) {
        this.startCount = current;
        if ( this.startTime ) this.startTime = new Date();
    },
    
    start: function() {
        if ( this.startTime ) return;
        this.startTime = new Date();
    },
    
    pause: function() {
        if ( !this.startTime ) return;
        this.startCount += (new Date() - this.startTime) / 1000;
        this.startTime = null;
    },
    
    stop: function() {
        this.startCount = 0;
        this.startTime = null;
    },
    
    getTimeString: function() {
        if ( isNaN(this.startCount) || isNaN(this.totalCount) ) return "";
        
        let elapsed, current;
        if ( this.startTime ) elapsed = Math.floor((new Date() - this.startTime) / 1000) + this.startCount;
        else elapsed = this.startCount;
        
        if ( settings.countUp ) current = elapsed;
        else current = this.totalCount - elapsed;
        
        return this.formatTime(Math.floor(current)) + " / " + this.formatTime(this.totalCount);
    },
    
    formatTime: function(seconds) {
        let numHours = Math.floor(seconds/3600);
        let numMins = Math.floor((seconds - (numHours * 3600)) / 60);
        let numSecs = seconds - (numHours * 3600) - (numMins * 60);
        if ( numSecs < 10 ) numSecs = "0" + numSecs.toString();
        if ( numMins < 10 && numHours > 0 ) numMins = "0" + numMins.toString();
        if ( numHours > 0 ) numHours = numHours.toString() + ":";
        else numHours = "";
        return numHours + numMins.toString() + ":" + numSecs.toString();
    },
    
    getPercent: function() {
        let elapsed;
        if ( this.startTime ) elapsed = (new Date() - this.startTime) / 1000 + this.startCount;
        else elapsed = this.startCount;
        let percent = elapsed / this.totalCount;
        if ( isNaN(percent) || percent < 0 ) percent = 0;
        else if ( percent > 1 ) percent = 1;
        
        return percent;
    },
    
    getCurrent: function() {
        let elapsed;
        if ( this.startTime ) elapsed = Math.floor((new Date() - this.startTime) / 1000) + this.startCount;
        else elapsed = this.startCount;
        return elapsed;
    }
}


function Inhibitor(dragObject) {
    this._init(dragObject);
}

Inhibitor.prototype = {
    _init: function(dragObject) {
        this.drag = dragObject;
        
        this.registeredInhibitors = [];
    },
    
    add: function(name) {
        this.registeredInhibitors.push(name);
        this._updateInhibit();
    },
    
    remove: function(name) {
        try {
        for ( let i = (this.registeredInhibitors.length - 1); i >= 0; i-- ) {
            if ( this.registeredInhibitors[i] == name ) this.registeredInhibitors.splice(i, 1);
        }
        this._updateInhibit();
        } catch(e) {
            global.logError(e);
        }
    },
    
    _updateInhibit: function() {
        if ( this.registeredInhibitors.length == 0 ) this.drag.inhibit = false;
        else this.drag.inhibit = true;
    }
}


function SettingsInterface(uuid, deskletId) {
    this._init(uuid, deskletId);
}

SettingsInterface.prototype = {
    _init: function(uuid, deskletId) {
        
        this.settings = new Settings.DeskletSettings(this, uuid, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "theme", "theme", this.queRebuild);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showApps", "showApps", function() { this.emit("app-show-hide"); });
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "countUp", "countUp", function() { this.emit("countup-changed"); });
        this.settings.bindProperty(Settings.BindingDirection.IN, "raiseKey", "raiseKey", function() { this.emit("keybinding-changed"); });
        this.settings.bindProperty(Settings.BindingDirection.IN, "compact", "compact", this.queRebuild);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showArt", "showArt", function() { this.emit("art-show-hide"); });
        this.settings.bindProperty(Settings.BindingDirection.IN, "artSize", "artSize", function() { this.emit("redraw-art"); });
        this.settings.bindProperty(Settings.BindingDirection.IN, "exceedNormVolume", "exceedNormVolume", function() { this.emit("volume-settings-changed"); });
        
    },
    
    queRebuild: function() {
        this.emit("que-rebuild");
    }
}
Signals.addSignalMethods(SettingsInterface.prototype);


function Prop(owner) {
    this._init(owner);
}

Prop.prototype = {
    _init: function(owner) {
        DBus.session.proxifyObject(this, owner, "/org/mpris/MediaPlayer2", this);
    }
}
DBus.proxifyPrototype(Prop.prototype, PropIFace)


function MediaServer2(owner) {
    this._init(owner);
}

MediaServer2.prototype = {
    _init: function(owner) {
        DBus.session.proxifyObject(this, owner, "/org/mpris/MediaPlayer2", this);
    },
    
    getRaise: function(callback) {
        this.GetRemote("CanRaise", Lang.bind(this, function(raise, ex) {
            if ( !ex ) callback(this, raise);
        }));
    },
    
    getQuit: function(callback) {
        this.GetRemote("CanQuit", Lang.bind(this, function(quit, ex) {
            if ( !ex ) callback(this, quit);
        }));
    }
}
DBus.proxifyPrototype(MediaServer2.prototype, MediaServer2IFace)


function MediaServer2Player(owner) {
    this._init(owner);
}

MediaServer2Player.prototype = {
    _init: function(owner) {
        this._owner = owner;
        DBus.session.proxifyObject(this, owner, "/org/mpris/MediaPlayer2", this);
    },
    
    getMetadata: function(callback) {
        this.GetRemote("Metadata", Lang.bind(this, function(metadata, ex) {
            if ( !ex ) callback(this, metadata);
        }));
    },
    
    getPlaybackStatus: function(callback) {
        this.GetRemote("PlaybackStatus", Lang.bind(this, function(status, ex) {
            if ( !ex ) callback(this, status);
        }));
    },
    
    getRate: function(callback) {
        this.GetRemote("Rate", Lang.bind(this, function(rate, ex) {
            if ( !ex ) callback(this, rate);
        }));
    },
    
    getPosition: function(callback) {
        this.GetRemote("Position", Lang.bind(this, function(position, ex) {
            if ( !ex ) callback(this, position);
        }));
    },
    
    setPosition: function(value) {
        this.SetRemote("Position", value);
    },
    
    getShuffle: function(callback) {
        this.GetRemote("Shuffle", Lang.bind(this, function(shuffle, ex) {
            if ( !ex ) callback(this, shuffle);
        }));
    },
    
    setShuffle: function(value) {
        this.SetRemote("Shuffle", value);
    },
    
    getVolume: function(callback) {
        this.GetRemote("Volume", Lang.bind(this, function(volume, ex) {
            if ( !ex ) callback(this, volume);
        }));
    },
    
    setVolume: function(value) {
        this.SetRemote("Volume", parseFloat(value));
    },
    
    getRepeat: function(callback) {
        this.GetRemote("LoopStatus", Lang.bind(this, function(repeat, ex) {
            if ( !ex ) {
                if ( repeat == "None" ) repeat = false;
                else repeat = true;
                callback(this, repeat);
            }
        }));
    },
    
    setRepeat: function(value) {
        if ( value ) value = "Playlist";
        else value = "None";
        this.SetRemote("LoopStatus", value);
    },
    
    getCanSeek: function(callback) {
        this.GetRemote("CanSeek", Lang.bind(this, function(canSeek, err) {
            if ( !err ) callback(this, canSeek);
        }));
    }
}
DBus.proxifyPrototype(MediaServer2Player.prototype, MediaServer2PlayerIFace)


function RaisedBox() {
    this._init();
}

RaisedBox.prototype = {
    _init: function() {
        try {
            
            this.stageEventIds = [];
            this.playerMenuEvents = [];
            this.contextMenuEvents = [];
            
            this.actor = new St.Group({ visible: false, x: 0, y: 0 });
            Main.uiGroup.add_actor(this.actor);
            let constraint = new Clutter.BindConstraint({ source: global.stage,
                                                          coordinate: Clutter.BindCoordinate.POSITION | Clutter.BindCoordinate.SIZE });
            this.actor.add_constraint(constraint);
            
            this._backgroundBin = new St.Bin();
            this.actor.add_actor(this._backgroundBin);
            let monitor = Main.layoutManager.focusMonitor;
            this._backgroundBin.set_position(monitor.x, monitor.y);
            this._backgroundBin.set_size(monitor.width, monitor.height);
            
            let stack = new Cinnamon.Stack();
            this._backgroundBin.child = stack;
            
            this.eventBlocker = new Clutter.Group({ reactive: true });
            stack.add_actor(this.eventBlocker);
            
            this.groupContent = new St.Bin();
            stack.add_actor(this.groupContent);
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    add: function(desklet) {
        try {
            
            this.desklet = desklet;
            this.playerMenu = this.desklet.playerLauncher.menu;
            this.contextMenu = this.desklet._menu;
            
            this.groupContent.add_actor(this.desklet.actor);
            
            this.actor.show();
            global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
            global.focus_manager.add_group(this.actor);
            
            this.stageEventIds.push(global.stage.connect("captured-event", Lang.bind(this, this.onStageEvent)));
            this.stageEventIds.push(global.stage.connect("enter-event", Lang.bind(this, this.onStageEvent)));
            this.stageEventIds.push(global.stage.connect("leave-event", Lang.bind(this, this.onStageEvent)));
            this.playerMenuEvents.push(this.playerMenu.connect("activate", Lang.bind(this, function() {
                this.emit("closed");
            })));
            this.playerMenuEvents.push(this.playerMenu.connect("open-state-changed", Lang.bind(this, function(menu, open) {
                if ( !open ) {
                    global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
                }
            })));
            this.contextMenuEvents.push(this.contextMenu.connect("activate", Lang.bind(this, function() {
                this.emit("closed");
            })));
            this.contextMenuEvents.push(this.contextMenu.connect("open-state-changed", Lang.bind(this, function(menu, open) {
                if ( !open ) {
                    global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
                }
            })));
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    remove: function() {
        try {
            
            for ( let i = 0; i < this.stageEventIds.length; i++ ) global.stage.disconnect(this.stageEventIds[i]);
            for ( let i = 0; i < this.playerMenuEvents.length; i++ ) this.playerMenu.disconnect(this.playerMenuEvents[i]);
            for ( let i = 0; i < this.contextMenuEvents.length; i++ ) this.contextMenu.disconnect(this.contextMenuEvents[i]);
            
            if ( this.desklet ) this.groupContent.remove_actor(this.desklet.actor);
            
            this.actor.destroy();
            global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    onStageEvent: function(actor, event) {
        try {
            
            let type = event.type();
            if ( type == Clutter.EventType.KEY_PRESS || type == Clutter.EventType.KEY_RELEASE ) return true;
            
            let target = event.get_source();
            if ( target == this.desklet.actor || this.desklet.actor.contains(target) ||
                 target == this.playerMenu.actor || this.playerMenu.actor.contains(target) ||
                 target == this.contextMenu.actor || this.contextMenu.actor.contains(target) ) return false;
            if ( type == Clutter.EventType.BUTTON_RELEASE ) this.emit("closed");
            
        } catch(e) {
            global.logError(e);
        }
        
        return true;
    }
}
Signals.addSignalMethods(RaisedBox.prototype);


function ButtonMenu(content) {
    this._init(content);
}

ButtonMenu.prototype = {
    _init: function(content) {
        try {
            
            this.actor = new St.Button({ style_class: settings.theme+"-buttonMenu" });
            if ( settings.compact ) this.actor.add_style_pseudo_class("compact");
            this.actor.set_child(content);
            
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new PopupMenu.PopupMenu(this.actor, 0.5, St.Side.TOP, 0);
            this.menu.box.set_name(settings.theme+"-popup");
            this.menu.actor.set_name(settings.theme+"-popup-boxPointer");
            this.menuManager.addMenu(this.menu);
            Main.uiGroup.add_actor(this.menu.actor);
            this.menu.actor.hide();
            
            this.actor.connect("clicked", Lang.bind(this, this.activate));
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    activate: function() {
        this.menu.toggle();
    },
    
    addMenuItem: function(title, icon, callback) {
        let menuItem = new PopupMenu.PopupBaseMenuItem();
        menuItem.actor.set_name(settings.theme+"-popup-menuitem");
        if ( icon ) menuItem.addActor(icon);
        let label = new St.Label({ text: title });
        menuItem.addActor(label);
        menuItem.connect("activate", callback);
        this.menu.addMenuItem(menuItem);
    },
    
    removeAll: function() {
        this.menu.removeAll();
    },
}


function Slider(value) {
    this._init(value);
}

Slider.prototype = {
    _init: function(value) {
        try {
            
            if (isNaN(value)) throw TypeError("The slider value must be a number");
            this._value = Math.max(Math.min(value, 1), 0);
            
            this.actor = new St.DrawingArea({ style_class: settings.theme+"-slider", reactive: true });
            if ( settings.compact ) this.actor.add_style_pseudo_class("compact");
            this.actor.connect("repaint", Lang.bind(this, this._sliderRepaint));
            this.actor.connect("button-press-event", Lang.bind(this, this._startDragging));
            this.actor.connect("scroll-event", Lang.bind(this, this._onScrollEvent));
            this.actor.connect("enter_event", Lang.bind(this, function() {
                inhibitor.add("slider");
            }));
            this.actor.connect("leave_event", Lang.bind(this, function() {
                inhibitor.remove("slider");
            }));
            
            this._releaseId = this._motionId = 0;
            this._dragging = false;
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    setValue: function(value) {
        if (isNaN(value)) throw TypeError("The slider value must be a number");
        
        this._value = Math.max(Math.min(value, 1), 0);
        this.actor.queue_repaint();
    },
    
    _sliderRepaint: function(area) {
        let cr = area.get_context();
        let themeNode = area.get_theme_node();
        let [width, height] = area.get_surface_size();
        
        //handle properties
        let handleRadius = themeNode.get_length("-slider-handle-radius");
        let handleHeight = themeNode.get_length("-slider-handle-height");
        let handleWidth = themeNode.get_length("-slider-handle-width");
        let handleColor = themeNode.get_color("-slider-handle-color");
        let handleBorderColor = themeNode.get_color("-slider-handle-border-color");
        let handleBorderWidth = themeNode.get_length("-slider-handle-border-width");
        
        //inactive properties
        let sliderBorderWidth = themeNode.get_length("-slider-border-width");
        let sliderHeight = themeNode.get_length("-slider-height");
        let sliderBorderColor = themeNode.get_color("-slider-border-color");
        let sliderColor = themeNode.get_color("-slider-background-color");
        
        //active properties
        let sliderActiveBorderColor = themeNode.get_color("-slider-active-border-color");
        let sliderActiveColor = themeNode.get_color("-slider-active-background-color");
        let sliderActiveBorderWidth = themeNode.get_length("-slider-active-border-width");
        let sliderActiveHeight = themeNode.get_length("-slider-active-height");
        
        //general properties
        let sliderWidth, start;
        if ( handleRadius == 0 ) {
            sliderWidth = width - handleWidth;
            start = handleWidth / 2;
        }
        else {
            sliderWidth = width - 2 * handleRadius;
            start = handleRadius;
        }
        
        cr.setSourceRGBA (
            sliderActiveColor.red / 255,
            sliderActiveColor.green / 255,
            sliderActiveColor.blue / 255,
            sliderActiveColor.alpha / 255);
        cr.rectangle(start, (height - sliderActiveHeight) / 2, sliderWidth * this._value, sliderActiveHeight);
        cr.fillPreserve();
        cr.setSourceRGBA (
            sliderActiveBorderColor.red / 255,
            sliderActiveBorderColor.green / 255,
            sliderActiveBorderColor.blue / 255,
            sliderActiveBorderColor.alpha / 255);
        cr.setLineWidth(sliderActiveBorderWidth);
        cr.stroke();
        
        cr.setSourceRGBA (
            sliderColor.red / 255,
            sliderColor.green / 255,
            sliderColor.blue / 255,
            sliderColor.alpha / 255);
        cr.rectangle(start + sliderWidth * this._value, (height - sliderHeight) / 2, sliderWidth * (1 - this._value), sliderHeight);
        cr.fillPreserve();
        cr.setSourceRGBA (
            sliderBorderColor.red / 255,
            sliderBorderColor.green / 255,
            sliderBorderColor.blue / 255,
            sliderBorderColor.alpha / 255);
        cr.setLineWidth(sliderBorderWidth);
        cr.stroke();
        
        let handleY = height / 2;
        let handleX = handleRadius + (width - 2 * handleRadius) * this._value;
        
        cr.setSourceRGBA (
            handleColor.red / 255,
            handleColor.green / 255,
            handleColor.blue / 255,
            handleColor.alpha / 255);
        if ( handleRadius == 0 ) cr.rectangle(sliderWidth * this._value, (height - handleHeight) / 2, handleWidth, handleHeight);
        else cr.arc(handleX, handleY, handleRadius, 0, 2 * Math.PI);
        cr.fillPreserve();
        cr.setSourceRGBA (
            handleBorderColor.red / 255,
            handleBorderColor.green / 255,
            handleBorderColor.blue / 255,
            handleBorderColor.alpha / 255);
        cr.setLineWidth(handleBorderWidth);
        cr.stroke();
    },
    
    _startDragging: function(actor, event) {
        if (this._dragging) return;
        
        this._dragging = true;
        
        global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
        Clutter.grab_pointer(this.actor);
        this._releaseId = this.actor.connect("button-release-event", Lang.bind(this, this._endDragging));
        this._motionId = this.actor.connect("motion-event", Lang.bind(this, this._motionEvent));
        let absX, absY;
        [absX, absY] = event.get_coords();
        this._moveHandle(absX, absY);
    },

    _endDragging: function(actor, event) {
        if ( this._dragging ) {
            this.actor.disconnect(this._releaseId);
            this.actor.disconnect(this._motionId);
            
            Clutter.ungrab_pointer();
            if ( !desklet_raised ) global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
            this._dragging = false;
            
            if ( !this.actor.has_pointer ) inhibitor.remove("slider");
            
            this.emit("drag-end");
        }
        return true;
    },
    
    _onScrollEvent: function (actor, event) {
        let direction = event.get_scroll_direction();
        
        if (direction == Clutter.ScrollDirection.DOWN) {
            this._value = Math.max(0, this._value - SLIDER_SCROLL_STEP);
        }
        else if (direction == Clutter.ScrollDirection.UP) {
            this._value = Math.min(1, this._value + SLIDER_SCROLL_STEP);
        }
        
        this.actor.queue_repaint();
        this.emit("value-changed", this._value);
    },
    
    _motionEvent: function(actor, event) {
        let absX, absY;
        [absX, absY] = event.get_coords();
        this._moveHandle(absX, absY);
        return true;
    },
    
    _moveHandle: function(absX, absY) {
        let relX, relY, sliderX, sliderY;
        [sliderX, sliderY] = this.actor.get_transformed_position();
        relX = absX - sliderX;
        relY = absY - sliderY;
        
        let width = this.actor.width;
        let handleRadius = this.actor.get_theme_node().get_length("-slider-handle-radius");
        
        let newvalue;
        if ( relX < handleRadius ) newvalue = 0;
        else if ( relX > width - handleRadius ) newvalue = 1;
        else newvalue = (relX - handleRadius) / (width - 2 * handleRadius);
        this._value = newvalue;
        this.actor.queue_repaint();
        this.emit("value-changed", this._value);
    },
    
    get_value: function() {
        return this._value;
    },
    
    _onKeyPressEvent: function (actor, event) {
        let key = event.get_key_symbol();
        if ( key == Clutter.KEY_Right || key == Clutter.KEY_Left ) {
            let delta = key == Clutter.KEY_Right ? 0.1 : -0.1;
            this._value = Math.max(0, Math.min(this._value + delta, 1));
            this.actor.queue_repaint();
            this.emit("value-changed", this._value);
            this.emit("drag-end");
            return true;
        }
        return false;
    }
}
Signals.addSignalMethods(Slider.prototype);


function AppControl(app, maxVol) {
    this._init(app, maxVol);
}

AppControl.prototype = {
    _init: function(app, maxVol) {
        
        this.app = app;
        this.maxVol = maxVol;
        this.compactibleElements = [];
        
        this.muteId = app.connect("notify::is-muted", Lang.bind(this, this.updateMute));
        this.volumeId = app.connect("notify::volume", Lang.bind(this, this.updateVolume));
        
        this.actor = new St.BoxLayout({ vertical: true, style_class: settings.theme+"-appBox" });
        this.compactibleElements.push(this.actor);
        let divider = new Divider();
        this.actor.add_actor(divider.actor);
        
        let titleBin = new St.Bin({ style_class: settings.theme+"-appTitleBox" });
        this.actor.add_actor(titleBin);
        this.compactibleElements.push(titleBin);
        let titleBox = new St.BoxLayout({ vertical: false });
        titleBin.add_actor(titleBox);
        
        let iconBin = new St.Bin({ y_align: St.Align.MIDDLE });
        titleBox.add_actor(iconBin);
        let icon = new St.Icon({ icon_name: app.icon_name, icon_type: St.IconType.FULLCOLOR, style_class: settings.theme+"-appIcon" });
        iconBin.add_actor(icon);
        this.compactibleElements.push(icon);
        let labelBin = new St.Bin({ y_align: St.Align.MIDDLE });
        titleBox.add_actor(labelBin);
        let label = new St.Label({ text: app.get_name(), style_class: settings.theme+"-appTitle" });
        labelBin.add_actor(label);
        
        let volumeBin = new St.Bin({  });
        this.actor.add_actor(volumeBin);
        let volumeBox = new St.BoxLayout({ vertical: false });
        volumeBin.add_actor(volumeBox);
        
        let volumeButton = new St.Button({ style_class: settings.theme+"-volumeButton" });
        volumeBox.add_actor(volumeButton);
        this.volumeIcon = new St.Icon({ style_class: settings.theme+"-volumeIcon" });
        volumeButton.add_actor(this.volumeIcon);
        this.compactibleElements.push(volumeButton, this.volumeIcon);
        this.muteTooltip = new Tooltips.Tooltip(volumeButton);
        this.muteTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
        
        let sliderBin = new St.Bin();
        volumeBox.add_actor(sliderBin);
        this.volumeSlider = new Slider(1);
        sliderBin.add_actor(this.volumeSlider.actor);
        
        volumeButton.connect("clicked", Lang.bind(this, this.toggleMute));
        this.volumeSlider.connect("value-changed", Lang.bind(this, this.sliderChanged));
        
        if ( settings.compact ) {
            for ( let i = 0; i < this.compactibleElements.length; i++ ) this.compactibleElements[i].add_style_pseudo_class("compact");
        }
        
        this.updateMute();
        this.updateVolume();
        
    },
    
    updateVolume: function() {
        if ( !this.app.is_muted ) {
            this.volume = this.app.volume / this.maxVol;
            this.volumeSlider.setValue(this.volume);
            this.volumeIcon.icon_name = null;
            
            if ( this.volume <= 0 ) this.volumeIcon.icon_name = "audio-volume-muted";
            else {
                let n = Math.floor(3 * this.volume) + 1;
                if (n < 2) this.volumeIcon.icon_name = "audio-volume-low";
                else if (n >= 3) this.volumeIcon.icon_name = "audio-volume-high";
                else this.volumeIcon.icon_name = "audio-volume-medium";
            }
        }
        else {
            this.volumeSlider.setValue(0);
            this.volumeIcon.icon_name = "audio-volume-muted";
        }
    },
    
    updateMute: function () {
        let muted = this.app.is_muted;
        if ( muted ) {
            this.volumeSlider.setValue(0);
            this.volumeIcon.icon_name = "audio-volume-muted-symbolic";
            this.muteTooltip.set_text(_("Unmute"));
        }
        else {
            this.volume = this.app.volume / this.maxVol;
            this.volumeSlider.setValue(this.volume);
            this.volumeIcon.icon_name = null;
            this.muteTooltip.set_text(_("Mute"));
            
            if ( this.volume <= 0 ) this.volumeIcon.icon_name = "audio-volume-muted";
            else {
                let n = Math.floor(3 * this.volume) + 1;
                if ( n < 2 ) this.volumeIcon.icon_name = "audio-volume-low";
                else if ( n >= 3 ) this.volumeIcon.icon_name = "audio-volume-high";
                else this.volumeIcon.icon_name = "audio-volume-medium";
            }
        }
    },
    
    toggleMute: function() {
        if ( this.app.is_muted ) this.app.change_is_muted(false);
        else this.app.change_is_muted(true);
    },
    
    sliderChanged: function(slider, value) {
        let volume = value * this.maxVol;
        let prev_muted = this.app.is_muted;
        if ( volume < 1 ) {
            this.app.volume = 0;
            if ( !prev_muted ) this.app.change_is_muted(true);
        }
        else {
            this.app.volume = volume;
            if ( prev_muted ) this.app.change_is_muted(false);
        }
        this.app.push_volume();
    },
    
    destroy: function() {
        this.app.disconnect(this.muteId);
        this.app.disconnect(this.volumeId);
        this.actor.destroy();
    }
}


function Divider() {
    this._init();
}

Divider.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ vertical: true, style_class: settings.theme+"-divider-box" });
        let divider = new St.DrawingArea({ style_class: settings.theme+"-divider" });
        if ( settings.compact ) {
            this.actor.add_style_pseudo_class("compact");
            divider.add_style_pseudo_class("compact");
        }
        this.actor.add_actor(divider);
    }
}


function TrackInfo(label, icon, tooltip) {
    this._init(label, icon, tooltip);
}

TrackInfo.prototype = {
    _init: function(label, icon, tooltip) {
        this.hasTooltip = tooltip;
        this.actor = new St.Button({ x_align: St.Align.START });
        let box = new St.BoxLayout({ style_class: settings.theme+"-trackInfo" });
        this.actor.add_actor(box);
        this.icon = new St.Icon({ icon_name: icon.toString(), style_class: settings.theme+"-trackInfo-icon" });
        box.add_actor(this.icon);
        this.label = new St.Label({ text: label.toString(), style_class: settings.theme+"-trackInfo-text" });
        box.add_actor(this.label);
        if ( tooltip ) {
            this.tooltip = new Tooltips.Tooltip(this.actor, label.toString());
            this.tooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
        }
        
        if ( settings.compact ) {
            box.add_style_pseudo_class("compact");
            this.icon.add_style_pseudo_class("compact");
        }
    },
    
    setLabel: function(label) {
        this.label.text = label;
        if ( this.hasTooltip ) this.tooltip.set_text(label);
    },
    
    getLabel: function() {
        return this.label.text.toString();
    },
    
    hide: function() {
        this.actor.hide();
    },
    
    show: function() {
        this.actor.show();
    }
}


function ControlButton(icon, callback) {
    this._init(icon, callback);
}

ControlButton.prototype = {
    _init: function(icon, callback) {
        this.actor = new St.Bin({ style_class: settings.theme+"-soundButton-box" });
        this.button = new St.Button({ style_class: settings.theme+"-soundButton" });
        this.actor.add_actor(this.button);
        this.button.connect("clicked", callback);
        this.icon = new St.Icon({ icon_type: St.IconType.SYMBOLIC, icon_name: icon, style_class: settings.theme+"-soundButton-icon" });
        this.button.set_child(this.icon);
        
        if ( settings.compact ) {
            this.actor.add_style_pseudo_class("compact");
            this.button.add_style_pseudo_class("compact");
            this.icon.add_style_pseudo_class("compact");
        }
    },
    
    getActor: function() {
        return this.actor;
    },
    
    setIcon: function(icon) {
        this.icon.icon_name = icon;
    }
}


function PlayerBar(title, image) {
    this._init(title, image);
}

PlayerBar.prototype = {
    _init: function(title, image) {
        
        this.actor = new St.BoxLayout({ style_class: settings.theme+"-playerInfoBar", vertical: false });
        this.icon = new St.Bin({ style_class: settings.theme+"-playerIcon" });
        this.actor.add_actor(this.icon);
        this.setImage(image);
        this.title = new St.Label({ text: title, style_class: settings.theme+"-playerTitleText" });
        this.actor.add_actor(this.title);
    },
    
    setText: function(text) {
        this.title.text = text;
    },
    
    setImage: function(image) {
        let path = "/usr/share/cinnamon/theme/" + image + ".svg";
        let file = Gio.file_new_for_path(path);
        let icon_uri = file.get_uri();
        
        let iconImage = St.TextureCache.get_default().load_uri_async(icon_uri, 16, 16);
        this.icon.set_child(iconImage);
    }
}


function Player(parent, owner) {
    this._init(parent, owner);
}

Player.prototype = {
    _init: function(parent, owner) {
        try {
            this.actor = new St.Bin();
            
            this.parent = parent;
            this.showPosition = true;
            this.owner = owner;
            this._name = this.owner.split(".")[3];
            this._mediaServerPlayer = new MediaServer2Player(owner);
            this._mediaServer = new MediaServer2(owner);
            this._prop = new Prop(owner);
            this._timeTracker = new TimeTracker();
            
            this._prop.connect("PropertiesChanged", Lang.bind(this, function(sender, iface, value) {
                if ( value["PlaybackStatus"] ) this._setStatus(iface, value["PlaybackStatus"]);
                if ( value["Metadata"] ) this._setMetadata(iface, value["Metadata"]);
                if ( sender._dbusBusName == "org.mpris.MediaPlayer2.qmmp" ) {
                    if ( value["playbackStatus"] ) this._setStatus(iface, value["playbackStatus"]);
                    if ( value["metadata"] ) this._setMetadata(sender, value["metadata"]);
                } 
            }));
            settings.connect("countup-changed", Lang.bind(this, this._setTimeText));
            
            this._buildLayout();
            
        } catch (e) {
            global.logError(e);
        }
    },
    
    _buildLayout: function() {
        try {
            
            this.compactibleElements = [];
            
            this.actor.destroy_all_children();
            
            let mainBox = new St.BoxLayout({ vertical: true });
            this.actor.set_child(mainBox);
            
            //player bar
            this.playerTitle = new PlayerBar(this._getName(), "player-stopped");
            
            //track info
            let trackInfoContainer = new St.Bin({  });
            mainBox.add_actor(trackInfoContainer);
            let trackInfoBox = new St.BoxLayout({ vertical: true, style_class: settings.theme+"-trackInfoBox" });
            trackInfoContainer.set_child(trackInfoBox);
            this.compactibleElements.push(trackInfoBox);
            
            this._title = new TrackInfo(_("Unknown Title"), "audio-x-generic", true);
            trackInfoBox.add_actor(this._title.actor);
            this._album = new TrackInfo(_("Unknown Album"), "media-optical", true);
            trackInfoBox.add_actor(this._album.actor);
            this._artist = new TrackInfo(_("Unknown Artist"), "system-users", true);
            trackInfoBox.add_actor(this._artist.actor);
            
            //album image
            this.trackCoverFile = this.trackCoverFileTmp = false;
            this.trackCover = new St.Bin({ style_class: settings.theme+"-albumCover-box" });
            mainBox.add_actor(this.trackCover);
            let trackCoverIcon = new St.Icon({ icon_name: "media-optical-cd-audio", style_class: settings.theme+"-albumCover", icon_type: St.IconType.FULLCOLOR });
            this.trackCover.set_child(trackCoverIcon);
            this.compactibleElements.push(this.trackCover, trackCoverIcon);
            this.artHiddenDivider = new Divider();
            mainBox.add_actor(this.artHiddenDivider.actor);
            if ( settings.showArt ) this.artHiddenDivider.actor.hide();
            else this.trackCover.hide();
            settings.connect("art-show-hide", Lang.bind(this, function() {
                if ( settings.showArt ) {
                    this.trackCover.show();
                    this.artHiddenDivider.actor.hide();
                }
                else {
                    this.trackCover.hide();
                    this.artHiddenDivider.actor.show();
                }
            }))
            settings.connect("redraw-art", Lang.bind(this, this._showCover))
            
            //seek controls
            this.seekControlsBin = new St.Bin({ style_class: settings.theme+"-timeBox" });
            this.compactibleElements.push(this.seekControlsBin);
            mainBox.add_actor(this.seekControlsBin);
            this.seekControlsBox = new St.BoxLayout({ vertical: true });
            this.seekControlsBin.set_child(this.seekControlsBox);
            
            let timeBin = new St.Bin({ x_align: St.Align.MIDDLE });
            this.seekControlsBox.add_actor(timeBin);
            this._time = new TrackInfo("0:00 / 0:00", "document-open-recent", false);
            timeBin.add_actor(this._time.actor);
            
            this._positionSlider = new Slider(0);
            this.seekControlsBox.add_actor(this._positionSlider.actor);
            
            this._time.actor.connect("clicked", Lang.bind(this, function() {
                settings.countUp = !settings.countUp;
                this._setTimeText();
            }));
            this._positionSlider.connect("value-changed", Lang.bind(this, this.seek));
            this._positionSlider.connect("drag-end", Lang.bind(this, this.seek));
            
            //control buttons
            this.trackControls = new St.Bin({ x_align: St.Align.MIDDLE });
            mainBox.add_actor(this.trackControls);
            this.controls = new St.BoxLayout({ style_class: settings.theme+"-buttonBox" });
            this.trackControls.set_child(this.controls);
            this.compactibleElements.push(this.controls);
            
            this._prevButton = new ControlButton("media-skip-backward", Lang.bind(this, function() {
                this._mediaServerPlayer.PreviousRemote();
                if ( supported_players[this._name].timeIssues ) this._timeTracker.setCurrent(0);
            }));
            this._prevButtonTooltip = new Tooltips.Tooltip(this._prevButton.button, _("Previous"));
            this._prevButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
            this.controls.add_actor(this._prevButton.getActor());
            
            this._playButton = new ControlButton("media-playback-start", Lang.bind(this, function() {
                this._mediaServerPlayer.PlayPauseRemote();
            }));
            this._playButtonTooltip = new Tooltips.Tooltip(this._playButton.button, _("Play"));
            this._playButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
            this.controls.add_actor(this._playButton.getActor());
            
            this._stopButton = new ControlButton("media-playback-stop", Lang.bind(this, function() {
                this._mediaServerPlayer.StopRemote();
            }));
            this._stopButtonTooltip = new Tooltips.Tooltip(this._stopButton.button, _("Stop"));
            this._stopButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
            this.controls.add_actor(this._stopButton.getActor());
            
            this._nextButton = new ControlButton("media-skip-forward", Lang.bind(this, function() {
                this._mediaServerPlayer.NextRemote();
                if ( supported_players[this._name].timeIssues ) this._timeTracker.setCurrent(0);
            }));
            this._nextButtonTooltip = new Tooltips.Tooltip(this._nextButton.button, _("Next"));
            this._nextButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
            this.controls.add_actor(this._nextButton.getActor());
            
            this._mediaServer.getRaise(Lang.bind(this, function(sender, raise) {
                if ( raise ) {
                    this._raiseButton = new ControlButton("go-up", Lang.bind(this, function() {
                        this.parent.lower();
                        this._mediaServer.RaiseRemote();
                    }));
                    this._raiseButtonTooltip = new Tooltips.Tooltip(this._raiseButton.button, _("Open Player"));
                    this._raiseButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
                    this.controls.add_actor(this._raiseButton.getActor());
                }
            }));
            
            this._mediaServer.getQuit(Lang.bind(this, function(sender, quit) {
                if ( quit ) {
                    this._quitButton = new ControlButton("window-close", Lang.bind(this, function() {
                        this.parent.lower();
                        this._mediaServer.QuitRemote();
                    }));
                    this.controls.add_actor(this._quitButton.getActor());
                    this._quitButtonTooltip = new Tooltips.Tooltip(this._quitButton.button, _("Quit Player"));
                    this._quitButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
                }
            }));
            
            if ( settings.compact ) {
                for ( let i = 0; i < this.compactibleElements.length; i++ ) this.compactibleElements[i].add_style_pseudo_class("compact");
            }
            
            if ( !supported_players[this._name].seek ) {
                this.seekControlsBin.hide();
                this.showPosition = false;
            }
            this._getStatus();
            this._trackId = {};
            this._getMetadata();
            this._getPosition();
            this._wantedSeekValue = 0;
            this._updatePositionSlider();
            
            this._mediaServerPlayer.connect("Seeked", Lang.bind(this, function(sender, value) {
                if ( value > 0 ) this._setPosition(value);
                else if ( this._wantedSeekValue > 0 ) this._setPosition(this._wantedSeekValue);
                else this._setPosition(value);
                
                this._wantedSeekValue = 0;
            }));
            
            Mainloop.timeout_add(1000, Lang.bind(this, this._getPosition));
            
        } catch (e) {
            global.logError(e);
        }
    },
    
    destroy: function() {
        this.actor.destroy();
        this.playerTitle.actor.destroy();
    },
    
    updateTheme: function() {
        if ( this._timeoutId != 0 ) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._buildLayout();
    },
    
    _getName: function() {
        return this._name.charAt(0).toUpperCase() + this._name.slice(1);
    },
    
    _setName: function(status) {
        this.playerTitle.setText(this._getName() + " - " + _(status));
    },
    
    seek: function(item) {
        this._wantedSeekValue = item._value * this._timeTracker.totalCount;
        this._timeTracker.setCurrent(this._wantedSeekValue);
        this._setTimeText();
        this._mediaServerPlayer.SetPositionRemote(this._trackObj, this._timeTracker.getCurrent() * 1000000);
    },
    
    _updatePositionSlider: function(position) {
        this._mediaServerPlayer.getCanSeek(Lang.bind(this, function(sender, canSeek) {
            this._canSeek = canSeek;
            if ( this._timeTracker.totalCount == 0 || position == false ) this._canSeek = false;
        }));
    },
    
    _setPosition: function(value) {
        if ( value == null && this._playerStatus != "Stopped" ) this._updatePositionSlider(false);
        else {
            this._timeTracker.setCurrent(value / 1000000);
            this._updateTimer();
        }
    },
    
    _getPosition: function() {
        this._mediaServerPlayer.getPosition(Lang.bind(this, function(sender, value) {
            this._setPosition(value);
        }));
    },
    
    _setMetadata: function(sender, metadata) {
        if ( metadata["mpris:length"] ) {
            this._timeTracker.setTotal(metadata["mpris:length"] / 1000000);
            if ( this._name == "quodlibet" ) this._timeTracker.setTotal(metadata["mpris:length"] / 1000);
            this._stopTimer();
            if ( this._playerStatus == "Playing" ) {
                this._runTimer();
                this._timeTracker.start();
            }
        }
        else {
            this._timeTracker.setTotal(0);
            this._stopTimer();
        }
        if ( metadata["xesam:artist"] ) this._artist.setLabel(metadata["xesam:artist"].toString());
        else this._artist.setLabel(_("Unknown Artist"));
        if ( metadata["xesam:album"] ) this._album.setLabel(metadata["xesam:album"].toString());
        else this._album.setLabel(_("Unknown Album"));
        if ( metadata["xesam:title"] ) this._title.setLabel(metadata["xesam:title"].toString());
        else this._title.setLabel(_("Unknown Title"));
        
        if ( metadata["mpris:trackid"] ) this._trackObj = metadata["mpris:trackid"];
        
        let change = false;
        if ( metadata["mpris:artUrl"] ) {
            if ( this.trackCoverFile != metadata["mpris:artUrl"].toString() ) {
                this.trackCoverFile = metadata["mpris:artUrl"].toString();
                change = true;
            }
        }
        else {
            if ( this.trackCoverFile != false ) {
                this.trackCoverFile = false;
                change = true;
            }
        }
        
        if ( change ) {
            if ( this.trackCoverFile ) {
                this.coverPath = "";
                if ( this.trackCoverFile.match(/^http/) ) {
                    this._hideCover();
                    let cover = Gio.file_new_for_uri(decodeURIComponent(this.trackCoverFile));
                    if ( !this.trackCoverFileTmp ) this.trackCoverFileTmp = Gio.file_new_tmp("XXXXXX.mediaplayer-cover")[0];
                    cover.read_async(null, null, Lang.bind(this, this._onReadCover));
                }
                else {
                    this.coverPath = decodeURIComponent(this.trackCoverFile);
                    this.coverPath = this.coverPath.replace("file://", "");
                    this._showCover();
                }
            }
            else this._showCover(false);
        }
    },
    
    _getMetadata: function() {
        this._mediaServerPlayer.getMetadata(Lang.bind(this, this._setMetadata));
    },
    
    _setStatus: function(sender, status) {
        this._updatePositionSlider();
        this._playerStatus = status;
        if ( status == "Playing" ) {
            this._timeTracker.start();
            this._playButton.setIcon("media-playback-pause");
            this._runTimer();
        }
        else if ( status == "Paused" ) {
            this._playButton.setIcon("media-playback-start");
            this._pauseTimer();
        }
        else if ( status == "Stopped" ) {
            this._playButton.setIcon("media-playback-start");
            this._stopTimer();
        }
        
        this.playerTitle.setImage("player-" + status.toLowerCase());
        this._setName(status);
    },
    
    _getStatus: function() {
        this._mediaServerPlayer.getPlaybackStatus(Lang.bind(this, this._setStatus));
    },
    
    _updateRate: function() {
        this._mediaServerPlayer.getRate(Lang.bind(this, function(sender, rate) {
            this._rate = rate;
        }));
    },
    
    _updateTimer: function() {
        if ( this.showPosition && this._canSeek ) {
            this._setTimeText();
            this._positionSlider.setValue(this._timeTracker.getPercent());
        }
    },
    
    _setTimeText: function() {
        this._time.setLabel(this._timeTracker.getTimeString());
    },
    
    _runTimer: function() {
        if ( this._playerStatus == "Playing" ) {
            this._timeoutId = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._runTimer));
            this._updateTimer();
        }
    },
    
    _pauseTimer: function() {
        this._timeTracker.pause();
        if ( this._timeoutId != 0 ) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._updateTimer();
    },
    
    _stopTimer: function() {
        this._pauseTimer();
        this._timeTracker.stop();
        this._updateTimer();
    },
    
    _onReadCover: function(cover, result) {
        let inStream = cover.read_finish(result);
        let outStream = this.trackCoverFileTmp.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, null);
        outStream.splice_async(inStream, Gio.OutputStreamSpliceFlags.CLOSE_TARGET, 0, null, Lang.bind(this, this._onSavedCover));
    },
    
    _onSavedCover: function(outStream, result) {
        outStream.splice_finish(result, null);
        this.coverPath = this.trackCoverFileTmp.get_path();
        this._showCover(this.coverPath);
    },
    
    _hideCover: function() {
    },
    
    _showCover: function() {
        try {
        if ( ! this.coverPath || ! GLib.file_test(this.coverPath, GLib.FileTest.EXISTS) ) {
            this.trackCover.set_child(new St.Icon({ icon_name: "media-optical-cd-audio", style_class: settings.theme+"albumCover", icon_type: St.IconType.FULLCOLOR }));
        }
        else {
            let l = new Clutter.BinLayout();
            let b = new Clutter.Box();
            let c = new Clutter.Texture({ height: settings.artSize, keep_aspect_ratio: true, filter_quality: 2, filename: this.coverPath });
            b.set_layout_manager(l);
            b.set_width(settings.artSize);
            b.add_actor(c);
            this.trackCover.set_child(b);
        }
        } catch (e) {
            global.logError(e);
        }
    }
}


function myDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

myDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,
    
    _init: function(metadata, desklet_id) {
        try {
            
            Desklet.Desklet.prototype._init.call(this, metadata);
            inhibitor = new Inhibitor(this._draggable);
            
            settings = new SettingsInterface(metadata["uuid"], desklet_id);
            settings.connect("que-rebuild", Lang.bind(this, this.rebuild));
            settings.connect("keybinding-changed", Lang.bind(this, this.bindKey));
            settings.connect("volume-settings-changed", Lang.bind(this, this.updateVolume));
            this.bindKey();
            desklet_raised = false;
            
            this._menu.addSettingsAction(_("Sound Settings"), "sound");
            
            this.players = {};
            this.owners = [];
            this.apps = [];
            
            for ( let player in supported_players ) {
                DBus.session.watch_name("org.mpris.MediaPlayer2." + player, false,
                    Lang.bind(this, this._addPlayer),
                    Lang.bind(this, this._removePlayer)
                );
            }
            
            this.volumeControl = new Gvc.MixerControl({ name: "Cinnamon Volume Control" });
            this.volumeControl.connect("state-changed", Lang.bind(this, this._onControlStateChanged));
            this.volumeControl.connect("default-sink-changed", Lang.bind(this, this._readOutput));
            this.volumeControl.connect("card-added", Lang.bind(this, this._onControlStateChanged));
            this.volumeControl.connect("card-removed", Lang.bind(this, this._onControlStateChanged));
            this.volumeControl.connect("stream-added", Lang.bind(this, this._reloadApps));
            this.volumeControl.connect("stream-removed", Lang.bind(this, this._reloadApps));
            this.normVolume = this.volumeControl.get_vol_max_norm();
            this.maxVolume = this.volumeControl.get_vol_max_amplified();
            
            this.playerShown = null;
            this.volume = 0;
            this._output = null;
            this._outputVolumeId = 0;
            this._outputMutedId = 0;
            this.volumeControl.open();
            this._volumeControlShown = false;
            
            this._build_interface();
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    bindKey: function() {
        if ( this.keyId ) Main.keybindingManager.removeHotKey(this.keyId);
        
        this.keyId = "soundbox-raise";
        Main.keybindingManager.addHotKey(this.keyId, settings.raiseKey, Lang.bind(this, this.toggleRaise));
    },
    
    toggleRaise: function() {
        try {
            
            if ( desklet_raised ) this.lower();
            else this.raise();
            
            //throw "works";
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    raise: function() {
        if ( desklet_raised || this.changingRaiseState ) return;
        this.changingRaiseState = true;
        
        inhibitor.add("raisedBox");
        this.raisedBox = new RaisedBox();
        
        let position = this.actor.get_position();
        this.actor.get_parent().remove_actor(this.actor);
        this.raisedBox.add(this);
        
        this.raisedBox.connect("closed", Lang.bind(this, this.lower));
        
        desklet_raised = true;
        this.changingRaiseState = false;
    },
    
    lower: function() {
        if ( !desklet_raised || this.changingRaiseState ) return;
        this.changingRaiseState = true;
        
        this._menu.close();
        this.playerLauncher.menu.close();
        
        if ( this.raisedBox ) this.raisedBox.remove();
        Main.deskletContainer.addDesklet(this.actor);
        inhibitor.remove("raisedBox");
        
        desklet_raised = false;
        this.changingRaiseState = false;
    },
    
    _build_interface: function() {
        
        this.compactibleElements = [];
        
        if ( this.mainBox ) this.mainBox.destroy();
        
        this.mainBox = new St.BoxLayout({ style_class: settings.theme+"-mainBox", vertical: true });
        this.setContent(this.mainBox);
        this.compactibleElements.push(this.mainBox);
        
        let topBin = new St.Bin({ x_align: St.Align.MIDDLE });
        this.mainBox.add_actor(topBin);
        let topBox = new St.BoxLayout({ vertical: false });
        topBin.add_actor(topBox);
        
        this.playerLauncher = new ButtonMenu(new St.Label({ text: _("Launch Player"), style_class: settings.theme+"-buttonText" }));
        topBox.add_actor(this.playerLauncher.actor);
        
        let divider = new Divider();
        this.mainBox.add_actor(divider.actor);
        
        //volume controls
        let volumeBin = new St.Bin({ x_align: St.Align.MIDDLE });
        this.mainBox.add_actor(volumeBin);
        let volumeBox = new St.BoxLayout({ vertical: true, style_class: settings.theme+"-volumeBox" });
        volumeBin.add_actor(volumeBox);
        this.compactibleElements.push(volumeBox);
        
        //volume text
        let volumeTextBin = new St.Bin({ x_align: St.Align.MIDDLE });
        volumeBox.add_actor(volumeTextBin);
        let volumeTitleBox = new St.BoxLayout({ vertical: false, style_class: settings.theme+"-volumeTextBox" });
        volumeTextBin.add_actor(volumeTitleBox);
        
        let volumeLabel = new St.Label({ text: _("Volume: "), style_class: settings.theme+"-text" });
        volumeTitleBox.add_actor(volumeLabel);
        this.volumeValueText = new St.Label({ text: Math.floor(100*this.volume) + "%", style_class: settings.theme+"-text" });
        volumeTitleBox.add_actor(this.volumeValueText);
        
        //volume slider
        let volumeSliderBox = new St.BoxLayout({ vertical: false });
        volumeBox.add_actor(volumeSliderBox);
        let volumeButton = new St.Button({ style_class: settings.theme+"-volumeButton" });
        volumeSliderBox.add_actor(volumeButton);
        this.volumeIcon = new St.Icon({ icon_name: "audio-volume-high", style_class: settings.theme+"-volumeIcon" });
        volumeButton.set_child(this.volumeIcon);
        this.compactibleElements.push(volumeButton, this.volumeIcon);
        this.muteTooltip = new Tooltips.Tooltip(volumeButton);
        this.muteTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
        
        let volumeSliderBin = new St.Bin();
        volumeSliderBox.add_actor(volumeSliderBin);
        this.volumeSlider = new Slider(this.volume);
        volumeSliderBin.add_actor(this.volumeSlider.actor);
        
        volumeButton.connect("clicked", Lang.bind(this, this._toggleMute));
        this.volumeSlider.connect("value-changed", Lang.bind(this, this._sliderChanged));
        
        //application volume controls
        this.appBox = new St.BoxLayout({ vertical: true });
        this.mainBox.add_actor(this.appBox);
        if ( !settings.showApps ) this.appBox.hide();
        settings.connect("app-show-hide", Lang.bind(this, this._setAppHideState));
        
        this.playersContainer = new St.BoxLayout({ vertical: true, style_class: settings.theme+"-playerBox" });
        this.mainBox.add_actor(this.playersContainer);
        this.playersContainer.hide();
        
        let divider = new Divider();
        this.playersContainer.add_actor(divider.actor);
        
        //player title
        let titleBin = new St.Bin({ x_align: St.Align.MIDDLE, style_class: settings.theme+"-titleBar" });
        this.playersContainer.add_actor(titleBin);
        this.compactibleElements.push(titleBin);
        this.playerTitleBox = new St.BoxLayout({ vertical: false });
        titleBin.add_actor(this.playerTitleBox);
        
        this.playerBack = new St.Button({ style_class: settings.theme+"-playerSelectButton", child: new St.Icon({ icon_name: "media-playback-start-rtl", icon_size: 16 }) });
        this.playerTitleBox.add_actor(this.playerBack);
        this.playerBack.hide();
        
        this.playerTitle = new St.Bin({ style_class: settings.theme+"-titleBox" });
        this.playerTitleBox.add_actor(this.playerTitle);
        this.compactibleElements.push(this.playerTitle);
        this.playerTitle.set_alignment(St.Align.MIDDLE, St.Align.MIDDLE);
        
        this.playerForward = new St.Button({ style_class: settings.theme+"-playerSelectButton", child: new St.Icon({ icon_name: "media-playback-start", icon_size: 16 }) });
        this.playerTitleBox.add_actor(this.playerForward);
        this.playerForward.hide();
        
        this.playerBack.connect("clicked", Lang.bind(this, function() {
            for ( let i = 0; i < this.owners.length; i++ ) {
                if ( this.playerShown == this.owners[i] ) {
                    let current = i - 1;
                    if ( current == -1 ) current = this.owners.length - 1;
                    this._showPlayer(this.players[this.owners[current]]);
                    break;
                }
            }
        }));
        this.playerForward.connect("clicked", Lang.bind(this, function() {
            for ( let i = 0; i < this.owners.length; i++ ) {
                if ( this.playerShown == this.owners[i] ) {
                    let current = i + 1;
                    if ( current == this.owners.length ) current = 0;
                    this._showPlayer(this.players[this.owners[current]]);
                    break;
                }
            }
        }));
        
        //player info
        this.playersBox = new St.Bin();
        this.playersContainer.add_actor(this.playersBox);
        
        if ( settings.compact ) {
            for ( let i = 0; i < this.compactibleElements.length; i++ ) this.compactibleElements[i].add_style_pseudo_class("compact");
        }
        
        this.refresh_players();
    },
    
    rebuild: function() {
        try {
            
            this.playersBox.set_child(null);
            this.playerTitle.set_child(null);
            this._build_interface();
            this._mutedChanged();
            this.updateVolume();
            this._reloadApps();
            for ( let i = 0; i < this.owners.length; i++ ) {
                let owner = this.owners[i];
                this.players[owner].updateTheme(settings.theme);
            }
            
            this._showPlayer(this.players[this.playerShown]);
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    _setAppHideState: function() {
        if ( settings.showApps ) this.appBox.show();
        else this.appBox.hide();
    },
    
    _mutedChanged: function(object, param_spec) {
        let muted = this._output.is_muted;
        if ( muted ) {
            this.volumeSlider.setValue(0);
            this.volumeValueText.text = "0%";
            this.volumeIcon.icon_name = "audio-volume-muted-symbolic";
            this.muteTooltip.set_text(_("Unmute"));
        }
        else {
            this.volume = this._output.volume / this.normVolume;
            if ( settings.exceedNormVolume ) this.volumeSlider.setValue(this._output.volume/this.maxVolume);
            else this.volumeSlider.setValue(this.volume);
            this.volumeValueText.text = Math.floor(100 * this.volume) + "%";
            this.volumeIcon.icon_name = null;
            this.muteTooltip.set_text(_("Mute"));
            
            if ( this.volume <= 0 ) this.volumeIcon.icon_name = "audio-volume-muted";
            else {
                let n = Math.floor(3 * this.volume) + 1;
                if ( n < 2 ) this.volumeIcon.icon_name = "audio-volume-low";
                else if ( n >= 3 ) this.volumeIcon.icon_name = "audio-volume-high";
                else this.volumeIcon.icon_name = "audio-volume-medium";
            }
        }
    },
    
    updateVolume: function(object, param_spec) {
        if ( !this._output.is_muted ) {
            this.volume = this._output.volume / this.normVolume;
            
            this.volumeValueText.text = Math.floor(100 * this.volume) + "%";
            this.volumeIcon.icon_name = null;
            if ( settings.exceedNormVolume ) this.volumeSlider.setValue(this._output.volume/this.maxVolume);
            else this.volumeSlider.setValue(this.volume);
            
            if ( this.volume <= 0 ) this.volumeIcon.icon_name = "audio-volume-muted";
            else {
                let n = Math.floor(3 * this.volume) + 1;
                if (n < 2) this.volumeIcon.icon_name = "audio-volume-low";
                else if (n >= 3) this.volumeIcon.icon_name = "audio-volume-high";
                else this.volumeIcon.icon_name = "audio-volume-medium";
            }
        }
    },
    
    _onControlStateChanged: function() {
        if (this.volumeControl.get_state() == Gvc.MixerControlState.READY) this._readOutput();
    },
    
    _readOutput: function() {
        if ( this._outputVolumeId ) {
            this._output.disconnect(this._outputVolumeId);
            this._output.disconnect(this._outputMutedId);
            this._outputVolumeId = 0;
            this._outputMutedId = 0;
        }
        this._output = this.volumeControl.get_default_sink();
        if ( this._output ) {
            this._outputMutedId = this._output.connect("notify::is-muted", Lang.bind(this, this._mutedChanged));
            this._outputVolumeId = this._output.connect("notify::volume", Lang.bind(this, this.updateVolume));
            this._mutedChanged(null, null, "_output");
            this.updateVolume();
        }
        else {
            this.volumeSlider.setValue(0);
            this.volumeValueText.text = "0%";
            this.volumeIcon.icon_name = "audio-volume-muted-symbolic";
        }
    },
    
    refresh_players: function() {
        this.playerLauncher.removeAll();
        
        this._availablePlayers = new Array();
        let appsys = Cinnamon.AppSystem.get_default();
        let allApps = appsys.get_all();
        let listedDesktopFiles = new Array();
        for ( let y = 0; y < allApps.length; y++ ) {
            let app = allApps[y];
            let entry = app.get_tree_entry();
            let path = entry.get_desktop_file_path();
            for ( let player in supported_players ) {
                let desktopFile = player + ".desktop";
                if ( path.indexOf(desktopFile) != -1 && listedDesktopFiles.indexOf(desktopFile) == -1 ) {
                    this._availablePlayers.push(app);
                    listedDesktopFiles.push(desktopFile);
                }
            }
        }
        
        for ( let i = 0; i < this._availablePlayers.length; i++ ) {
            let playerApp = this._availablePlayers[i];
            this.playerLauncher.addMenuItem(playerApp.get_name(), playerApp.create_icon_texture(ICON_SIZE), Lang.bind(this, function() {
                playerApp.open_new_window(-1);
            }));
        }
    },
    
    _sliderChanged: function(slider, value) {
        let volume;
        if ( settings.exceedNormVolume ) volume = value * this.maxVolume;
        else volume = value * this.normVolume;
        let prev_muted = this._output.is_muted;
        if ( volume < 1 ) {
            this._output.volume = 0;
            if ( !prev_muted ) this._output.change_is_muted(true);
        }
        else {
            this._output.volume = volume;
            if ( prev_muted ) this._output.change_is_muted(false);
        }
        this._output.push_volume();
    },
    
    _toggleMute: function() {
        if ( this._output.is_muted ) this._output.change_is_muted(false);
        else this._output.change_is_muted(true);
    },
    
    _addPlayer: function(owner) {
        try {
            
            this.players[owner] = new Player(this, owner);
            this.owners.push(owner);
            if ( this.playerShown == null ) this._showPlayer(this.players[owner]);
            
            if ( this.owners.length > 1 ) {
                this.playerBack.show();
                this.playerForward.show();
            }
            
            this.refresh_players();
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    _removePlayer: function(owner) {
        try {
            
            this.players[owner].destroy();
            delete this.players[owner];
            
            for ( let i = 0; i < this.owners.length; i++ ) {
                if ( this.owners[i] == owner ) {
                    this.owners.splice(i, 1);
                    if ( this.playerShown == owner ) {
                        if ( this.owners.length < 1 ) {
                            this.playersContainer.hide();
                            this.playersBox.set_child(null);
                            this.playerShown = null;
                        }
                        else {
                            let current = i;
                            if ( current >= this.owners.length ) current = this.owners.length - 1;
                            this._showPlayer(this.players[this.owners[current]]);
                        }
                    }
                    break;
                }
            }
            
            if ( Object.keys(this.players).length < 2 ) {
                this.playerBack.hide();
                this.playerForward.hide();
            }
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    _showPlayer: function(player) {
        if ( player == null ) return;
        this.playerShown = player.owner;
        this.playersBox.set_child(player.actor);
        this.playerTitle.set_child(player.playerTitle.actor);
        this.playersContainer.show();
        if ( this.owners.length > 1 ) {
            this.playerBack.show();
            this.playerForward.show();
        }
    },
    
    _reloadApps: function () {
        
        for ( let i = 0; i < this.apps.length; i++ ) {
            this.apps[i].destroy();
        }
        this.apps = [];
        
        let streams = this.volumeControl.get_sink_inputs();
        for ( let i = 0; i < streams.length; i++ ) {
            let output = streams[i]
            if ( output.get_application_id() != "org.Cinnamon" ) {
                let app = new AppControl(output, this.normVolume);
                this.appBox.add_actor(app.actor);
                this.apps.push(app);
            }
        }
        
    }
}


function main(metadata, desklet_id) {
    let desklet = new myDesklet(metadata, desklet_id);
    return desklet;
}
