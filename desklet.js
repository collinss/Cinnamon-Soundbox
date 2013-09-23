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


let compatible_players = [
    "clementine",
    "mpd",
    "exaile",
    "banshee",
    "rhythmbox",
    "rhythmbox3",
    "pragha",
    "quodlibet",
    "guayadeque",
    "amarok",
    "googlemusicframe",
    "xbmc",
    "noise",
    "xnoise",
    "gmusicbrowser",
    "spotify",
    "audacious",
    "vlc",
    "beatbox",
    "songbird",
    "pithos",
    "gnome-mplayer",
    "nuvolaplayer",
    "qmmp"
];

let support_seek = [
    "clementine",
    "banshee",
    "rhythmbox",
    "rhythmbox3",
    "pragha",
    "quodlibet",
    "amarok",
    "noise",
    "xnoise",
    "gmusicbrowser",
    "spotify",
    "vlc",
    "beatbox",
    "gnome-mplayer",
    "qmmp"
];

let desklet_drag_object;


function ButtonMenu(content, theme) {
    this._init(content, theme);
}

ButtonMenu.prototype = {
    _init: function(content, theme) {
        try {
            
            this.theme = theme;
            this.actor = new St.Button({ style_class: theme+"-buttonMenu" });
            this.actor.set_child(content);
            
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new PopupMenu.PopupMenu(this.actor, 0.5, St.Side.TOP, 0);
            this.menu.box.set_name(theme+"-popup");
            this.menu.actor.set_name(theme+"-popup-boxPointer");
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
        menuItem.actor.set_name(this.theme+"-popup-menuitem");
        if ( icon ) menuItem.addActor(icon);
        let label = new St.Label({ text: title });
        menuItem.addActor(label);
        menuItem.connect("activate", callback);
        this.menu.addMenuItem(menuItem);
    },
    
    removeAll: function() {
        this.menu.removeAll();
    },
    
    set_style: function(style) {
        
    }
}


function Slider(value, theme) {
    this._init(value, theme);
}

Slider.prototype = {
    _init: function(value, theme) {
        try {
            
            if (isNaN(value)) throw TypeError("The slider value must be a number");
            this._value = Math.max(Math.min(value, 1), 0);
            
            this.actor = new St.DrawingArea({ style_class: theme+"-slider", reactive: true });
            this.actor.connect("repaint", Lang.bind(this, this._sliderRepaint));
            this.actor.connect("button-press-event", Lang.bind(this, this._startDragging));
            this.actor.connect("scroll-event", Lang.bind(this, this._onScrollEvent));
            this.actor.connect("enter_event", Lang.bind(this, function() {
                desklet_drag_object.inhibit = true;
            }));
            this.actor.connect("leave_event", Lang.bind(this, function() {
                desklet_drag_object.inhibit = false;
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
            global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
            this._dragging = false;
            
            if ( !this.actor.has_pointer ) desklet_drag_object.inhibit = false;
            
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
    
    get value() {
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


function AppControl(app, maxVol, theme) {
    this._init(app, maxVol, theme);
}

AppControl.prototype = {
    _init: function(app, maxVol, theme) {
        
        this.app = app;
        this.maxVol = maxVol;
        this.muteId = app.connect("notify::is-muted", Lang.bind(this, this.updateMute));
        this.volumeId = app.connect("notify::volume", Lang.bind(this, this.updateVolume));
        
        this.actor = new St.BoxLayout({ vertical: true, style_class: theme+"-appBox" });
        let divider = new Divider(theme);
        this.actor.add_actor(divider.actor);
        
        let titleBin = new St.Bin({ style_class: theme+"-appTitleBox" });
        this.actor.add_actor(titleBin);
        let titleBox = new St.BoxLayout({ vertical: false });
        titleBin.add_actor(titleBox);
        
        let iconBin = new St.Bin({ y_align: St.Align.MIDDLE });
        titleBox.add_actor(iconBin);
        let icon = new St.Icon({ icon_name: app.icon_name, icon_type: St.IconType.FULLCOLOR, style_class: theme+"-appIcon" });
        iconBin.add_actor(icon);
        let labelBin = new St.Bin({ y_align: St.Align.MIDDLE });
        titleBox.add_actor(labelBin);
        let label = new St.Label({ text: app.get_name(), style_class: theme+"-appTitle" });
        labelBin.add_actor(label);
        
        let volumeBin = new St.Bin({  });
        this.actor.add_actor(volumeBin);
        let volumeBox = new St.BoxLayout({ vertical: false });
        volumeBin.add_actor(volumeBox);
        
        let volumeButton = new St.Button({ style_class: theme+"-volumeButton" });
        volumeBox.add_actor(volumeButton);
        this.volumeIcon = new St.Icon({ style_class: theme+"-volumeIcon" });
        volumeButton.add_actor(this.volumeIcon);
        this.muteTooltip = new Tooltips.Tooltip(volumeButton);
        this.muteTooltip._tooltip.add_style_class_name(theme+"-tooltip");
        
        let sliderBin = new St.Bin();
        volumeBox.add_actor(sliderBin);
        this.volumeSlider = new Slider(1, theme);
        sliderBin.add_actor(this.volumeSlider.actor);
        
        volumeButton.connect("clicked", Lang.bind(this, this.toggleMute));
        this.volumeSlider.connect("value-changed", Lang.bind(this, this.sliderChanged));
        
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


function Divider(theme) {
    this._init(theme);
}

Divider.prototype = {
    _init: function(theme) {
        this.actor = new St.BoxLayout({ vertical: true, style_class: theme+"-divider-box" });
        this.actor.add_actor(new St.DrawingArea({ style_class: theme+"-divider" }));
    }
}


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


function TrackInfo(label, icon, theme, tooltip) {
    this._init(label, icon, theme, tooltip);
}

TrackInfo.prototype = {
    _init: function(label, icon, theme, tooltip) {
        this.hasTooltip = tooltip;
        this.actor = new St.Button({ x_align: St.Align.START });
        let box = new St.BoxLayout({ style_class: theme+"-trackInfo" });
        this.actor.add_actor(box);
        this.icon = new St.Icon({ icon_name: icon.toString(), style_class: theme+"-trackInfo-icon" });
        box.add_actor(this.icon);
        this.label = new St.Label({ text: label.toString(), style_class: theme+"-trackInfo-text" });
        box.add_actor(this.label);
        if ( tooltip ) {
            this.tooltip = new Tooltips.Tooltip(this.actor, label.toString());
            this.tooltip._tooltip.add_style_class_name(theme+"-tooltip");
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


function ControlButton(icon, theme, callback) {
    this._init(icon, theme, callback);
}

ControlButton.prototype = {
    _init: function(icon, theme, callback) {
        this.actor = new St.Bin({ style_class: theme+"-soundButton-box" });
        this.button = new St.Button({ style_class: theme+"-soundButton" });
        this.button.connect("clicked", callback);
        this.icon = new St.Icon({ icon_type: St.IconType.SYMBOLIC, icon_name: icon, style_class: theme+"-soundButton-icon" });
        this.button.set_child(this.icon);
        this.actor.add_actor(this.button);        
    },
    
    getActor: function() {
        return this.actor;
    },
    
    setIcon: function(icon) {
        this.icon.icon_name = icon;
    }
}


function PlayerBar(title, image, theme) {
    this._init(title, image, theme);
}

PlayerBar.prototype = {
    _init: function(title, image, theme) {
        
        this.actor = new St.BoxLayout({ style_class: theme+"-playerInfoBar", vertical: false });
        this.icon = new St.Bin({ style_class: theme+"-playerIcon" });
        this.actor.add_actor(this.icon);
        this.setImage(image);
        this.title = new St.Label({ text: title, style_class: theme+"-playerTitleText" });
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


function Player(system_status_button, owner, theme) {
    this._init(system_status_button, owner, theme);
}

Player.prototype = {
    _init: function(system_status_button, owner, theme) {
        try {
            this.actor = new St.Bin();
            
            this.countUp = true;
            this.showPosition = true;
            this.owner = owner;
            this._name = this.owner.split(".")[3];
            this._mediaServerPlayer = new MediaServer2Player(owner);
            this._mediaServer = new MediaServer2(owner);
            this._prop = new Prop(owner);
            
            this._prop.connect("PropertiesChanged", Lang.bind(this, function(sender, iface, value) {
                if ( value["PlaybackStatus"] ) this._setStatus(iface, value["PlaybackStatus"]);
                if ( value["Metadata"] ) this._setMetadata(iface, value["Metadata"]);
                if ( sender._dbusBusName == "org.mpris.MediaPlayer2.qmmp" ) {
                    if ( value["playbackStatus"] ) this._setStatus(iface, value["playbackStatus"]);
                    if ( value["metadata"] ) this._setMetadata(sender, value["metadata"]);
                } 
            }));
            
            this._buildLayout(theme);
            
        } catch (e) {
            global.logError(e);
        }
    },
    
    _buildLayout: function(theme) {
        try {
            
            this.theme = theme;
            this.actor.destroy_all_children();
            
            let mainBox = new St.BoxLayout({ vertical: true });
            this.actor.set_child(mainBox);
            
            //player bar
            this.playerTitle = new PlayerBar(this._getName(), "player-stopped", theme);
            
            //track info
            let trackInfoContainer = new St.Bin({  });
            mainBox.add_actor(trackInfoContainer);
            let trackInfoBox = new St.BoxLayout({ vertical: true, style_class: theme+"-trackInfoBox" });
            trackInfoContainer.set_child(trackInfoBox);
            
            this._title = new TrackInfo(_("Unknown Title"), "audio-x-generic", theme, true);
            trackInfoBox.add_actor(this._title.actor);
            this._album = new TrackInfo(_("Unknown Album"), "media-optical", theme, true);
            trackInfoBox.add_actor(this._album.actor);
            this._artist = new TrackInfo(_("Unknown Artist"), "system-users", theme, true);
            trackInfoBox.add_actor(this._artist.actor);
            
            //album image
            this._trackCoverFile = this._trackCoverFileTmp = false;
            this._trackCover = new St.Bin({ style_class: theme+"-albumCover-box" });
            this._trackCover.set_child(new St.Icon({ icon_name: "media-optical-cd-audio", style_class: theme+"-albumCover", icon_type: St.IconType.FULLCOLOR }));
            mainBox.add_actor(this._trackCover);
            
            //seek controls
            this._seekControls = new St.Bin({ style_class: theme+"-timeBox" });
            mainBox.add_actor(this._seekControls);
            this.seekControls = new St.BoxLayout({ vertical: true });
            this._seekControls.set_child(this.seekControls);
            
            let timeBin = new St.Button({ x_align: St.Align.MIDDLE });
            this.seekControls.add_actor(timeBin);
            this._time = new TrackInfo("0:00 / 0:00", "document-open-recent", theme, false);
            timeBin.add_actor(this._time.actor);
            
            this._positionSlider = new Slider(0, theme);
            this.seekControls.add_actor(this._positionSlider.actor);
            
            timeBin.connect("clicked", Lang.bind(this, function() {
                this.countUp = !this.countUp;
                this._setTimeText();
            }));
            this._positionSlider.connect("value-changed", Lang.bind(this, function(item) {
                this._currentTime = item._value * this._songLength;
                this._setTimeText();
                this._wantedSeekValue = Math.round(this._currentTime * 1000000);
                this._mediaServerPlayer.SetPositionRemote(this._trackObj, this._currentTime * 1000000);
            }));
            this._positionSlider.connect("drag-end", Lang.bind(this, function(item) {
                this._currentTime = item._value * this._songLength;
                this._setTimeText();
                this._wantedSeekValue = Math.round(this._currentTime * 1000000);
                this._mediaServerPlayer.SetPositionRemote(this._trackObj, this._currentTime * 1000000);
            }));
            
            //control buttons
            this._trackControls = new St.Bin({ style_class: theme+"-buttonBox", x_align: St.Align.MIDDLE });
            mainBox.add_actor(this._trackControls);
            this.controls = new St.BoxLayout();
            this._trackControls.set_child(this.controls);
            
            this._prevButton = new ControlButton("media-skip-backward", theme, Lang.bind(this, function() {
                this._mediaServerPlayer.PreviousRemote();
            }));
            this._prevButtonTooltip = new Tooltips.Tooltip(this._prevButton.button, _("Previous"));
            this._prevButtonTooltip._tooltip.add_style_class_name(this.theme+"-tooltip");
            this.controls.add_actor(this._prevButton.getActor());
            
            this._playButton = new ControlButton("media-playback-start", theme, Lang.bind(this, function() {
                this._mediaServerPlayer.PlayPauseRemote();
            }));
            this._playButtonTooltip = new Tooltips.Tooltip(this._playButton.button, _("Play"));
            this._playButtonTooltip._tooltip.add_style_class_name(this.theme+"-tooltip");
            this.controls.add_actor(this._playButton.getActor());
            
            this._stopButton = new ControlButton("media-playback-stop", theme, Lang.bind(this, function() {
                this._mediaServerPlayer.StopRemote();
            }));
            this._stopButtonTooltip = new Tooltips.Tooltip(this._stopButton.button, _("Stop"));
            this._stopButtonTooltip._tooltip.add_style_class_name(this.theme+"-tooltip");
            this.controls.add_actor(this._stopButton.getActor());
            
            this._nextButton = new ControlButton("media-skip-forward", theme, Lang.bind(this, function() {
                this._mediaServerPlayer.NextRemote();
            }));
            this._nextButtonTooltip = new Tooltips.Tooltip(this._nextButton.button, _("Next"));
            this._nextButtonTooltip._tooltip.add_style_class_name(this.theme+"-tooltip");
            this.controls.add_actor(this._nextButton.getActor());
            
            this._mediaServer.getRaise(Lang.bind(this, function(sender, raise) {
                if ( raise ) {
                    this._raiseButton = new ControlButton("go-up", theme, Lang.bind(this, function() {
                        this._mediaServer.RaiseRemote();// this._system_status_button.menu.actor.hide();
                    }));
                    this._raiseButtonTooltip = new Tooltips.Tooltip(this._raiseButton.button, _("Open Player"));
                    this._raiseButtonTooltip._tooltip.add_style_class_name(this.theme+"-tooltip");
                    this.controls.add_actor(this._raiseButton.getActor());
                }
            }));
            
            this._mediaServer.getQuit(Lang.bind(this, function(sender, quit) {
                if ( quit ) {
                    this._quitButton = new ControlButton("window-close", theme, Lang.bind(this, function() {
                        this._mediaServer.QuitRemote();
                    }));
                    this.controls.add_actor(this._quitButton.getActor());
                    this._quitButtonTooltip = new Tooltips.Tooltip(this._quitButton.button, _("Quit Player"));
                    this._quitButtonTooltip._tooltip.add_style_class_name(this.theme+"-tooltip");
                }
            }));
            
            if ( support_seek.indexOf(this._name) == -1 ) {
                this.seekControls.hide();
                this.showPosition = false;
            }
            this._getStatus();
            this._trackId = {};
            this._getMetadata();
            this._currentTime = 0;
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
    
    updateTheme: function(theme) {
        if ( this._timeoutId != 0 ) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._buildLayout(theme);
    },
    
    _getName: function() {
        return this._name.charAt(0).toUpperCase() + this._name.slice(1);
    },
    
    _setName: function(status) {
        this.playerTitle.setText(this._getName() + " - " + _(status));
    },
    
    _updatePositionSlider: function(position) {
        this._mediaServerPlayer.getCanSeek(Lang.bind(this, function(sender, canSeek) {
            this._canSeek = canSeek;
            if ( this._songLength == 0 || position == false ) this._canSeek = false;
        }));
    },
    
    _setPosition: function(value) {
        if ( value == null && this._playerStatus != "Stopped" ) this._updatePositionSlider(false);
        else {
            this._currentTime = value / 1000000;
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
            this._songLength = metadata["mpris:length"] / 1000000;
            if ( this._name == "quodlibet" ) this._songLength = metadata["mpris:length"] / 1000;
            this._stopTimer();
            if ( this._playerStatus == "Playing" ) this._runTimer();
        }
        else {
            this._songLength = 0;
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
            if ( this._trackCoverFile != metadata["mpris:artUrl"].toString() ) {
                this._trackCoverFile = metadata["mpris:artUrl"].toString();
                change = true;
            }
        }
        else {
            if ( this._trackCoverFile != false ) {
                this._trackCoverFile = false;
                change = true;
            }
        }
        
        if ( change ) {
            if ( this._trackCoverFile ) {
                let cover_path = "";
                if ( this._trackCoverFile.match(/^http/) ) {
                    this._hideCover();
                    let cover = Gio.file_new_for_uri(decodeURIComponent(this._trackCoverFile));
                    if ( !this._trackCoverFileTmp ) this._trackCoverFileTmp = Gio.file_new_tmp("XXXXXX.mediaplayer-cover")[0];
                    cover.read_async(null, null, Lang.bind(this, this._onReadCover));
                }
                else {
                    cover_path = decodeURIComponent(this._trackCoverFile);
                    cover_path = cover_path.replace("file://", "");
                    this._showCover(cover_path);
                }
            }
            else this._showCover(false);
        }
    },
    
    _getMetadata: function() {
        this._mediaServerPlayer.getMetadata(Lang.bind(this,
            this._setMetadata
        ));
    },
    
    _setStatus: function(sender, status) {
        this._updatePositionSlider();
        this._playerStatus = status;
        if ( status == "Playing" ) {
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
            if ( !isNaN(this._currentTime) && !isNaN(this._songLength) && this._currentTime > 0 ) this._positionSlider.setValue(this._currentTime / this._songLength);
            else this._positionSlider.setValue(0);
            this._setTimeText();
        }
    },
    
    _setTimeText: function() {
        let time;
        if ( this.countUp ) time = this._currentTime;
        else time = this._songLength - this._currentTime;
        this._time.setLabel(this._formatTime(time) + " / " + this._formatTime(this._songLength));
    },
    
    _runTimer: function() {
        if ( this._playerStatus == "Playing" ) {
            this._timeoutId = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._runTimer));
            this._currentTime += 1;
            this._updateTimer();
        }
    },
    
    _pauseTimer: function() {
        if ( this._timeoutId != 0 ) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._updateTimer();
    },
    
    _stopTimer: function() {
        this._currentTime = 0;
        this._pauseTimer();
        this._updateTimer();
    },
    
    _formatTime: function(s) {
        let ms = s * 1000;
        let msSecs = (1000);
        let msMins = (msSecs * 60);
        let msHours = (msMins * 60);
        let numHours = Math.floor(ms/msHours);
        let numMins = Math.floor((ms - (numHours * msHours)) / msMins);
        let numSecs = Math.floor((ms - (numHours * msHours) - (numMins * msMins))/ msSecs);
        if ( numSecs < 10 ) numSecs = "0" + numSecs.toString();
        if ( numMins < 10 && numHours > 0 ) numMins = "0" + numMins.toString();
        if ( numHours > 0 ) numHours = numHours.toString() + ":";
        else numHours = "";
        return numHours + numMins.toString() + ":" + numSecs.toString();
    },
    
    _onReadCover: function(cover, result) {
        let inStream = cover.read_finish(result);
        let outStream = this._trackCoverFileTmp.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, null);
        outStream.splice_async(inStream, Gio.OutputStreamSpliceFlags.CLOSE_TARGET, 0, null, Lang.bind(this, this._onSavedCover));
    },
    
    _onSavedCover: function(outStream, result) {
        outStream.splice_finish(result, null);
        let cover_path = this._trackCoverFileTmp.get_path();
        this._showCover(cover_path);
    },
    
    _hideCover: function() {
    },
    
    _showCover: function(cover_path) {
        try {
        if ( ! cover_path || ! GLib.file_test(cover_path, GLib.FileTest.EXISTS) ) {
            this._trackCover.set_child(new St.Icon({ icon_name: "media-optical-cd-audio", style_class: this.theme+"albumCover", icon_type: St.IconType.FULLCOLOR }));
        }
        else {
            let l = new Clutter.BinLayout();
            let b = new Clutter.Box();
            let c = new Clutter.Texture({ height: 200, keep_aspect_ratio: true, filter_quality: 2, filename: cover_path });
            b.set_layout_manager(l);
            b.set_width(200);
            b.add_actor(c);
            this._trackCover.set_child(b);
        }
        } catch (e) {
            global.logError(e);
        }
    },
    
    setIcon: function(icon) {
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
            desklet_drag_object = this._draggable;
            
            this.settings = new Settings.DeskletSettings(this, metadata["uuid"], desklet_id);
            this.settings.bindProperty(Settings.BindingDirection.IN, "theme", "theme", this._setTheme);
            this.settings.bindProperty(Settings.BindingDirection.IN, "showApps", "showApps", this._setAppHideState);
            this.settings.bindProperty(Settings.BindingDirection.IN, "exceedNormVolume", "exceedNormVolume", this.updateVolume);
            
            this._menu.addSettingsAction(_("Desklet Settings"), "desklets " + UUID);
            this._menu.addSettingsAction(_("Sound Settings"), "sound");
            
            this.players = {};
            this.owners = [];
            this.apps = [];
            for ( let p = 0; p < compatible_players.length; p++ ) {
                DBus.session.watch_name("org.mpris.MediaPlayer2." + compatible_players[p], false,
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
    
    _build_interface: function() {
        if ( this.mainBox ) this.mainBox.destroy();
        
        this.mainBox = new St.BoxLayout({ style_class: this.theme+"-mainBox", vertical: true });
        this.setContent(this.mainBox);
        
        let topBin = new St.Bin({ x_align: St.Align.MIDDLE });
        this.mainBox.add_actor(topBin);
        let topBox = new St.BoxLayout({ vertical: false });
        topBin.add_actor(topBox);
        
        this.playerLauncher = new ButtonMenu(new St.Label({ text: _("Launch Player"), style_class: this.theme+"-buttonText" }), this.theme);
        topBox.add_actor(this.playerLauncher.actor);
        
        let divider = new Divider(this.theme);
        this.mainBox.add_actor(divider.actor);
        
        //volume controls
        let volumeBin = new St.Bin({ x_align: St.Align.MIDDLE });
        this.mainBox.add_actor(volumeBin);
        let volumeBox = new St.BoxLayout({ vertical: true, style_class: this.theme+"-volumeBox" });
        volumeBin.add_actor(volumeBox);
        
        //volume text
        let volumeTextBin = new St.Bin({ x_align: St.Align.MIDDLE });
        volumeBox.add_actor(volumeTextBin);
        let volumeTitleBox = new St.BoxLayout({ vertical: false, style_class: this.theme+"-volumeTextBox" });
        volumeTextBin.add_actor(volumeTitleBox);
        
        let volumeLabel = new St.Label({ text: _("Volume: "), style_class: this.theme+"-text" });
        volumeTitleBox.add_actor(volumeLabel);
        this.volumeValueText = new St.Label({ text: Math.floor(100*this.volume) + "%", style_class: this.theme+"-text" });
        volumeTitleBox.add_actor(this.volumeValueText);
        
        //volume slider
        let volumeSliderBox = new St.BoxLayout({ vertical: false });
        volumeBox.add_actor(volumeSliderBox);
        this.volumeIcon = new St.Icon({ icon_name: "audio-volume-high", style_class: this.theme+"-volumeIcon" });
        let volumeButton = new St.Button({ style_class: this.theme+"-volumeButton" });
        volumeButton.set_child(this.volumeIcon);
        this.muteTooltip = new Tooltips.Tooltip(volumeButton);
        this.muteTooltip._tooltip.add_style_class_name(this.theme+"-tooltip");
        volumeSliderBox.add_actor(volumeButton);
        
        let volumeSliderBin = new St.Bin();
        volumeSliderBox.add_actor(volumeSliderBin);
        this.volumeSlider = new Slider(this.volume, this.theme);
        volumeSliderBin.add_actor(this.volumeSlider.actor);
        
        volumeButton.connect("clicked", Lang.bind(this, this._toggleMute));
        this.volumeSlider.connect("value-changed", Lang.bind(this, this._sliderChanged));
        
        //application volume controls
        this.appBox = new St.BoxLayout({ vertical: true });
        this.mainBox.add_actor(this.appBox);
        if ( !this.showApps ) this.appBox.hide();
        
        this.playersContainer = new St.BoxLayout({ vertical: true, style_class: this.theme+"-playerBox" });
        this.mainBox.add_actor(this.playersContainer);
        this.playersContainer.hide();
        
        let divider = new Divider(this.theme);
        this.playersContainer.add_actor(divider.actor);
        
        //player title
        let titleBin = new St.Bin({ x_align: St.Align.MIDDLE, style_class: this.theme+"-titleBar" });
        this.playersContainer.add_actor(titleBin);
        this.playerTitleBox = new St.BoxLayout({ vertical: false });
        titleBin.add_actor(this.playerTitleBox);
        
        this.playerBack = new St.Button({ style_class: this.theme+"-playerSelectButton", child: new St.Icon({ icon_name: "media-playback-start-rtl", icon_size: 16 }) });
        this.playerTitleBox.add_actor(this.playerBack);
        this.playerBack.hide();
        
        this.playerTitle = new St.Bin({ style_class: this.theme+"-titleBox" });
        this.playerTitleBox.add_actor(this.playerTitle);
        this.playerTitle.set_alignment(St.Align.MIDDLE, St.Align.MIDDLE)
        
        this.playerForward = new St.Button({ style_class: this.theme+"-playerSelectButton", child: new St.Icon({ icon_name: "media-playback-start", icon_size: 16 }) });
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
        
        this.refresh_players();
    },
    
    _setTheme: function() {
        this.playersBox.set_child(null);
        this.playerTitle.set_child(null);
        this._build_interface();
        this._mutedChanged();
        this.updateVolume();
        this._reloadApps();
        for ( let i = 0; i < this.owners.length; i++ ) {
            let owner = this.owners[i];
            this.players[owner].updateTheme(this.theme);
        }
        
        this._showPlayer(this.players[this.playerShown]);
        
    },
    
    _setAppHideState: function() {
        if ( this.showApps ) this.appBox.show();
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
            if ( this.exceedNormVolume ) this.volumeSlider.setValue(this._output.volume/this.maxVolume);
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
            if ( this.exceedNormVolume ) this.volumeSlider.setValue(this._output.volume/this.maxVolume);
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
            for ( let p = 0; p < compatible_players.length; p++ ) {
                let desktopFile = compatible_players[p] + ".desktop";
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
        if ( this.exceedNormVolume ) volume = value * this.maxVolume;
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
            
            this.players[owner] = new Player(this, owner, this.theme);
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
                let app = new AppControl(output, this.normVolume, this.theme);
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