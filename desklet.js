const Desklet = imports.ui.desklet;
const DeskletManager = imports.ui.deskletManager;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;

const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gvc = imports.gi.Gvc;
const Pango = imports.gi.Pango;
const St = imports.gi.St;

const Interfaces = imports.misc.interfaces;
const Params = imports.misc.params;
const Util = imports.misc.util;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const UUID = "soundBox@scollins";
const SLIDER_SCROLL_STEP = 0.05;
const ICON_SIZE = 28;

const MEDIA_PLAYER_2_PATH = "/org/mpris/MediaPlayer2";
const MEDIA_PLAYER_2_NAME = "org.mpris.MediaPlayer2";
const MEDIA_PLAYER_2_PLAYER_NAME = "org.mpris.MediaPlayer2.Player";


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


function TimeTracker(server, prop, playerName) {
    this._init(server, prop, playerName);
}

TimeTracker.prototype = {
    _init: function(server, prop, playerName) {
        this.playerName = playerName;
        this.startCount = 0;
        this.totalCount = 0;
        this.state = "stopped";
        this.server = server;
        this.prop = prop;
        this.serverSeekedId = this.server.connectSignal("Seeked", Lang.bind(this, function(sender, value) {
            this.fetching = true;
            this.fetchPosition();
        }));
        
        Mainloop.timeout_add(1000, Lang.bind(this, this.fetchPosition));
    },
    
    destroy: function() {
        this.server.disconnectSignal(this.serverSeekedId);
    },
    
    //sets the total song length
    setTotal: function(total) {
        this.totalCount = total;
    },
    
    //gets the total song length
    getTotal: function() {
        return Math.floor(this.totalCount);
    },
    
    //sets the current elapsed time (in seconds)
    setElapsed: function(current) {
        this.startCount = current;
        if ( this.state == "playing" ) this.startTime = new Date(); //this is necessary if the timer is counting
    },
    
    //returns the current elapsed time in seconds
    getElapsed: function() {
        if ( this.fetching ) return -1;
        else if ( this.startTime ) return Math.floor((new Date() - this.startTime) / 1000) + this.startCount;
        else return this.startCount;
    },
    
    //reads and handles the requested postion
    readPosition: function(value) {
        if ( value == null && this.state != "stopped" ) this.updateSeekable(false);
        else {
            this.setElapsed(value / 1000000);
        }
        this.fetching = false;
    },
    
    //requests the time position
    fetchPosition: function() {
        this.prop.GetRemote(MEDIA_PLAYER_2_PLAYER_NAME, 'Position', Lang.bind(this, function(position, error) {
            if ( !error ) {
                this.readPosition(position[0].get_int64());
            }
        }));        
    },
    
    start: function() {
        if ( this.state == "playing" ) return;
        this.startTime = new Date();
        this.state = "playing";
        this.emit("state-changed", this.state);
    },
    
    pause: function() {
        if ( !this.startTime ) return;
        this.startCount += (new Date() - this.startTime) / 1000;
        this.startTime = null;
        this.state = "paused";
        this.emit("state-changed", this.state);
    },
    
    stop: function() {
        this.startCount = 0;
        this.startTime = null;
        this.state = "stopped";
        this.emit("state-changed", this.state);
    },
    
    seek: function(seconds) {
        this.server.SetPositionRemote(this.trackId, seconds * 1000000);
    }
}
Signals.addSignalMethods(TimeTracker.prototype);


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
        this.settings.bindProperty(Settings.BindingDirection.IN, "hideSystray", "hideSystray", function() { this.emit("systray-show-hide"); });
        this.settings.bindProperty(Settings.BindingDirection.IN, "theme", "theme", this.queRebuild);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showInput", "showInput", this.queRebuild);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showApps", "showApps", function() { this.emit("app-show-hide"); });
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "countUp", "countUp", function() { this.emit("countup-changed"); });
        this.settings.bindProperty(Settings.BindingDirection.IN, "raiseKey", "raiseKey", function() { this.emit("keybinding-changed"); });
        this.settings.bindProperty(Settings.BindingDirection.IN, "centerRaised", "centerRaised");
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


function AboutDialog(metadata) {
    this._init(metadata);
}

AboutDialog.prototype = {
    __proto__: ModalDialog.ModalDialog.prototype,
    
    _init: function(metadata) {
        try {
            ModalDialog.ModalDialog.prototype._init.call(this, {  });
            
            let contentBox = new St.BoxLayout({ vertical: true, style_class: "about-content" });
            this.contentLayout.add_actor(contentBox);
            
            let topBox = new St.BoxLayout();
            contentBox.add_actor(topBox);
            
            //icon
            let icon;
            if ( metadata.icon ) icon = new St.Icon({ icon_name: metadata.icon, icon_size: 48, icon_type: St.IconType.FULLCOLOR, style_class: "about-icon" });
            else {
                let file = Gio.file_new_for_path(metadata.path + "/icon.png");
                if ( file.query_exists(null) ) {
                    let gicon = new Gio.FileIcon({ file: file });
                    icon = new St.Icon({ gicon: gicon, icon_size: 48, icon_type: St.IconType.FULLCOLOR, style_class: "about-icon" });
                }
                else {
                    icon = new St.Icon({ icon_name: "applets", icon_size: 48, icon_type: St.IconType.FULLCOLOR, style_class: "about-icon" });
                }
            }
            topBox.add_actor(icon);
            
            let topTextBox = new St.BoxLayout({ vertical: true });
            topBox.add_actor(topTextBox);
            
            /*title*/
            let titleBox = new St.BoxLayout();
            topTextBox.add_actor(titleBox);
            
            let title = new St.Label({ text: metadata.name, style_class: "about-title" });
            titleBox.add_actor(title);
            
            if ( metadata.version ) {
                let versionBin = new St.Bin({ x_align: St.Align.START, y_align: St.Align.END});
                titleBox.add_actor(versionBin);
                let version = new St.Label({ text: "v " + metadata.version, style_class: "about-version" });
                versionBin.add_actor(version);
            }
            
            //uuid
            let uuid = new St.Label({ text: metadata.uuid, style_class: "about-uuid" });
            topTextBox.add_actor(uuid);
            
            //description
            let desc = new St.Label({ text: metadata.description, style_class: "about-description" });
            let dText = desc.clutter_text;
            topTextBox.add_actor(desc);
            
            /*optional content*/
            let scrollBox = new St.ScrollView({ style_class: "about-scrollBox" });
            contentBox.add_actor(scrollBox);
            let infoBox = new St.BoxLayout({ vertical: true, style_class: "about-scrollBox-innerBox" });
            scrollBox.add_actor(infoBox);
            
            //comments
            if ( metadata.comments ) {
                let comments = new St.Label({ text: "Comments:\n\t" + metadata.comments });
                let cText = comments.clutter_text;
                cText.ellipsize = Pango.EllipsizeMode.NONE;
                cText.line_wrap = true;
                cText.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
                infoBox.add_actor(comments);
            }
            
            //website
            if ( metadata.website ) {
                let wsBox = new St.BoxLayout({ vertical: true });
                infoBox.add_actor(wsBox);
                
                let wLabel = new St.Label({ text: "Website:" });
                wsBox.add_actor(wLabel);
                
                let wsButton = new St.Button({ x_align: St.Align.START, style_class: "cinnamon-link", name: "about-website" });
                wsBox.add_actor(wsButton);
                let website = new St.Label({ text: metadata.website });
                let wtext = website.clutter_text;
                wtext.ellipsize = Pango.EllipsizeMode.NONE;
                wtext.line_wrap = true;
                wtext.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
                wsButton.add_actor(website);
                wsButton.connect("clicked", Lang.bind(this, this.launchSite, metadata.website));
            }
            
            //contributors
            if ( metadata.contributors ) {
                let list = metadata.contributors.split(",").join("\n\t");
                let contributors = new St.Label({ text: "Contributors:\n\t" + list });
                infoBox.add_actor(contributors);
            }
            
            //dialog close button
            this.setButtons([
                { label: "Close", key: "", focus: true, action: Lang.bind(this, this._onOk) }
            ]);
            
            this.open(global.get_current_time());
        } catch(e) {
            global.log(e);
        }
    },
    
    _onOk: function() {
        this.close(global.get_current_time());
    },
    
    launchSite: function(a, b, site) {
        Util.spawnCommandLine("xdg-open " + site);
        this.close(global.get_current_time());
    }
}


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
            
            if ( !settings.centerRaised ) {
                let allocation = Cinnamon.util_get_transformed_allocation(desklet.actor);
                let monitor = Main.layoutManager.findMonitorForActor(desklet.actor);
                let x = Math.floor((monitor.width - allocation.x1 - allocation.x2) / 2);
                let y = Math.floor((monitor.height - allocation.y1 - allocation.y2) / 2);
                
                this.actor.set_anchor_point(x,y);
            }
            
            Main.pushModal(this.actor);
            this.actor.show();
            
            this.stageEventIds.push(global.stage.connect("captured-event", Lang.bind(this, this.onStageEvent)));
            this.stageEventIds.push(global.stage.connect("enter-event", Lang.bind(this, this.onStageEvent)));
            this.stageEventIds.push(global.stage.connect("leave-event", Lang.bind(this, this.onStageEvent)));
            this.playerMenuEvents.push(this.playerMenu.connect("activate", Lang.bind(this, function() {
                this.emit("closed");
            })));
            this.contextMenuEvents.push(this.contextMenu.connect("activate", Lang.bind(this, function() {
                this.emit("closed");
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
            
            Main.popModal(this.actor);
            this.actor.destroy();
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    onStageEvent: function(actor, event) {
        try {
            
            let type = event.type();
            if ( type == Clutter.EventType.KEY_PRESS ) return true;
            if ( type == Clutter.EventType.KEY_RELEASE ) {
                if ( event.get_key_symbol() == Clutter.KEY_Escape ) this.emit("closed");
                return true;
            }
            
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
            
            let scrollBox = new St.ScrollView();
            this.menu.addActor(scrollBox);
            this.content = new PopupMenu.PopupMenuSection();
            scrollBox.add_actor(this.content.actor);
            this.menu._connectSubMenuSignals(this.content, this.content);
            
            this.menu.setMaxHeight = Lang.bind(this, function() {
                let monitor = Main.layoutManager.findMonitorForActor(this.actor);
                if ( monitor == Main.layoutManager.primaryMonitor && Main.panel2 !== null)
                    panelHeight = Main.panel2.actor.height;
                else panelHeight = 0;
                let startY = Cinnamon.util_get_transformed_allocation(this.actor).y2;
                let boxpointerHeight = this.menu.actor.get_theme_node().get_length('-boxpointer-gap');
                let maxHeight = Math.round(monitor.height - startY - panelHeight - boxpointerHeight);
                this.menu.actor.style = ('max-height: ' + maxHeight + 'px;');
            });
            
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
        this.content.addMenuItem(menuItem);
    },
    
    removeAll: function() {
        this.content.removeAll();
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
        try {
            if ( this._dragging ) return;
            if ( isNaN(value) ) throw TypeError("The slider value must be a number");
            
            this._value = Math.max(Math.min(value, 1), 0);
            this.actor.queue_repaint();
        } catch(e) {
            global.logError(e);
        }
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
            
            this.emit("drag-end", this._value);
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


function SystemVolumeDisplay(title, normVolume, maxVolume) {
    this._init(title, normVolume, maxVolume);
}

SystemVolumeDisplay.prototype = {
    _init: function(title, normVolume, maxVolume) {
        
        this.normVolume = normVolume;
        this.maxVolume = maxVolume;
        this.volume = 0;
        this.compactibleElements = [];
        
        this.actor = new St.Bin({ x_align: St.Align.MIDDLE });
        let volumeBox = new St.BoxLayout({ vertical: true, style_class: settings.theme+"-volumeBox" });
        this.actor.add_actor(volumeBox);
        this.compactibleElements.push(volumeBox);
        
        //volume text
        let volumeTextBin = new St.Bin({ x_align: St.Align.MIDDLE });
        volumeBox.add_actor(volumeTextBin);
        let volumeTitleBox = new St.BoxLayout({ vertical: false, style_class: settings.theme+"-volumeTextBox" });
        volumeTextBin.add_actor(volumeTitleBox);
        
        let volumeLabel = new St.Label({ text: title, style_class: settings.theme+"-text" });
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
        
        volumeButton.connect("clicked", Lang.bind(this, this.toggleMute));
        this.volumeSlider.connect("value-changed", Lang.bind(this, this.onSliderChanged));
        settings.connect("volume-settings-changed", Lang.bind(this, this.updateVolume));
        
        if ( settings.compact ) {
            for ( let i = 0; i < this.compactibleElements.length; i++ ) this.compactibleElements[i].add_style_pseudo_class("compact");
        }
    },
    
    setControl: function(control) {
        if ( this.control ) {
            this.control.disconnect(this.volumeEventId);
            this.control.disconnect(this.mutedEventId);
            this.volumeEventId = 0;
            this.mutedEventId = 0;
        }
        
        this.control = control;
        
        if ( control ) {
            this.volumeEventId = this.control.connect("notify::volume", Lang.bind(this, this.updateVolume));
            this.mutedEventId = this.control.connect("notify::is-muted", Lang.bind(this, this.updateMute));
            this.updateMute();
            this.updateVolume();
        }
        else {
            this.volumeSlider.setValue(0);
            this.volumeValueText.text = "0%";
            this.volumeIcon.icon_name = "audio-volume-muted-symbolic";
        }
    },
    
    updateVolume: function(object, param_spec) {
        if ( !this.control.is_muted ) {
            this.volume = this.control.volume / this.normVolume;
            
            this.volumeValueText.text = Math.round(100 * this.volume) + "%";
            this.volumeIcon.icon_name = null;
            if ( settings.exceedNormVolume ) this.volumeSlider.setValue(this.control.volume/this.maxVolume);
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
    
    updateMute: function(object, param_spec) {
        let muted = this.control.is_muted;
        if ( muted ) {
            this.volumeSlider.setValue(0);
            this.volumeValueText.text = "0%";
            this.volumeIcon.icon_name = "audio-volume-muted-symbolic";
            this.muteTooltip.set_text(_("Unmute"));
        }
        else {
            this.volume = this.control.volume / this.normVolume;
            if ( settings.exceedNormVolume ) this.volumeSlider.setValue(this.control.volume/this.maxVolume);
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
    
    onSliderChanged: function(slider, value) {
        let volume;
        if ( settings.exceedNormVolume ) volume = value * this.maxVolume;
        else volume = value * this.normVolume;
        let prev_muted = this.control.is_muted;
        if ( volume < 1 ) {
            this.control.volume = 0;
            if ( !prev_muted ) this.control.change_is_muted(true);
        }
        else {
            this.control.volume = volume;
            if ( prev_muted ) this.control.change_is_muted(false);
        }
        this.control.push_volume();
    },
    
    toggleMute: function() {
        if ( this.control.is_muted ) this.control.change_is_muted(false);
        else this.control.change_is_muted(true);
    }
}


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


function TimeControls(timeTracker) {
    this._init(timeTracker);
}

TimeControls.prototype = {
    _init: function(timeTracker) {
        this.timeTracker = timeTracker;
        
        this.actor = new St.Bin({ style_class: settings.theme+"-timeBox" });
        if ( settings.compact ) this.actor.add_style_pseudo_class("compact");
        this.seekControlsBox = new St.BoxLayout({ vertical: true });
        this.actor.set_child(this.seekControlsBox);
        
        let timeBin = new St.Bin({ x_align: St.Align.MIDDLE });
        this.seekControlsBox.add_actor(timeBin);
        this._time = new TrackInfo("0:00 / 0:00", "document-open-recent", false);
        timeBin.add_actor(this._time.actor);
        
        this._positionSlider = new Slider(0);
        this.seekControlsBox.add_actor(this._positionSlider.actor);
        
        //connect to events
        this.timeTracker.connect("state-changed", Lang.bind(this, this.onStateChanged));
        settings.connect("countup-changed", Lang.bind(this, this.setTimeLabel));
        this._time.actor.connect("clicked", Lang.bind(this, function() {
            settings.countUp = !settings.countUp;
            this.setTimeLabel();
        }));
        this._positionSlider.connect("value-changed", Lang.bind(this, this.onSliderDrag));
        this._positionSlider.connect("drag-end", Lang.bind(this, this.onDragEnd));
    },
    
    //sets the slider value to the current percent
    setSliderValue: function() {
        if ( this._positionSlider._dragging ) return;
        
        let percent = this.timeTracker.getElapsed() / this.timeTracker.getTotal();
        if ( isNaN(percent) ) percent = 0;
        this._positionSlider.setValue(percent);
    },
    
    //sets the digital clock label
    setTimeLabel: function(elapsed) {
        if ( isNaN(this.timeTracker.startCount) || isNaN(this.timeTracker.totalCount) ) return;
        
        if ( !elapsed ) elapsed = this.timeTracker.getElapsed();
        let total = this.timeTracker.getTotal();
        
        let current;
        if ( settings.countUp ) current = elapsed;
        else current = total - elapsed;
        
        let label = this.formatTime(Math.floor(current)) + " / " + this.formatTime(Math.floor(total));
        this._time.setLabel(label);
    },
    
    //formats the time in a human-readable format
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
    
    onSliderDrag: function(slider, value) {
        let seconds = value * this.timeTracker.getTotal();
        this.setTimeLabel(seconds);
    },
    
    onDragEnd: function(slider, value) {
        seconds = value * this.timeTracker.getTotal();
        this.timeTracker.seek(seconds);
    },
    
    onStateChanged: function(tracker, state) {
        if ( state == "playing" && !this.refreshId ) {
            this.refreshId = Mainloop.timeout_add(200, Lang.bind(this, this.refresh));
        }
        else if ( state != "playing" && this.refreshId ) {
            Mainloop.source_remove(this.refreshId);
            this.refreshId = 0;
        }
    },
    
    refresh: function() {
        try {
            if ( this.timeTracker.state != "playing" ) {
                this.refreshId = 0;
                return false;
            }
            if ( this._positionSlider._dragging ) return true;
            this.setTimeLabel();
            this.setSliderValue();
        } catch (e) {
            global.logError(e);
        }
        return true;
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
        this.label.text = label.toString();
        if ( this.hasTooltip ) this.tooltip.set_text(label.toString());
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
    },
    
    enable: function() {
        this.button.remove_style_pseudo_class('disabled');
        this.button.can_focus = true;
        this.button.reactive = true;
    },
    
    disable: function() {
        this.button.add_style_pseudo_class('disabled');
        this.button.can_focus = false;
        this.button.reactive = false;
    }
}


function PlayerBar(title, image) {
    this._init(title, image);
}

PlayerBar.prototype = {
    _init: function(title, image) {
        
        this.actor = new St.BoxLayout({ style_class: settings.theme+"-playerInfoBar", vertical: false });
        this.icon = new St.Icon({ icon_type: St.IconType.FULLCOLOR, style_class: settings.theme+"-playerIcon" });
        this.actor.add_actor(this.icon);
        this.setImage(image);
        this.title = new St.Label({ text: title, style_class: settings.theme+"-playerTitleText" });
        this.actor.add_actor(this.title);
    },
    
    setText: function(text) {
        this.title.text = text;
    },
    
    setImage: function(image) {
        if ( Gtk.IconTheme.get_default().has_icon(image) ) this.icon.icon_name = image;
        else {
            let file = Gio.file_new_for_path("/usr/share/cinnamon/theme/" + image + ".svg");
            let gicon = new Gio.FileIcon({ file: file });
            this.icon.gicon = gicon;
        }
        //let path = "/usr/share/cinnamon/theme/" + image + ".svg";
        //let file = Gio.file_new_for_path(path);
        //let icon_uri = file.get_uri();
        //
        //let iconImage = St.TextureCache.get_default().load_uri_async(icon_uri, 16, 16);
        //this.icon.set_child(iconImage);
    }
}


function Player(parent, owner, name) {
    this._init(parent, owner, name);
}

Player.prototype = {
    _init: function(parent, owner, name) {
        try {
            this.actor = new St.Bin();
            
            this.parent = parent;
            this.showPosition = true;
            this.owner = owner;
            this.busName = name;
            this.name = name.split(".")[3];
            
            //player bar
            this.playerTitle = new PlayerBar(this.getTitle(), "player-stopped");
            
            Interfaces.getDBusProxyWithOwnerAsync(MEDIA_PLAYER_2_NAME, this.busName, Lang.bind(this, function(proxy, error) {
                if ( error ) {
                    global.logError(error);
                }
                else {
                    this._mediaServer = proxy;
                    this._onGetDBus();
                }
            }));
            
            Interfaces.getDBusProxyWithOwnerAsync(MEDIA_PLAYER_2_PLAYER_NAME, this.busName, Lang.bind(this, function(proxy, error) {
                if ( error ) {
                    global.logError(error);
                }
                else {
                    this._mediaServerPlayer = proxy;
                    this._onGetDBus();
                }
            }));
            
            Interfaces.getDBusPropertiesAsync(this.busName, MEDIA_PLAYER_2_PATH, Lang.bind(this, function(proxy, error) {
                if ( error ) {
                    global.logError(error);
                }
                else {
                    this._prop = proxy;
                    this._onGetDBus();
                }
            }));
            
        } catch (e) {
            global.logError(e);
        }
    },
    
    _onGetDBus: function() {
        try {
            if (!this._prop || !this._mediaServerPlayer || !this._mediaServer) return;
            this._timeTracker = new TimeTracker(this._mediaServerPlayer, this._prop, this.name);
            this._buildLayout();
            
            this.setStatus(this._mediaServerPlayer.PlaybackStatus);
            this.setMetadata(this._mediaServerPlayer.Metadata);
            this.updateSeekable();
            
            this._propChangedId = this._prop.connectSignal("PropertiesChanged", Lang.bind(this, function(proxy, sender, [iface, props]) {
                if ( props.PlaybackStatus ) this.setStatus(props.PlaybackStatus.unpack());
                if ( props.Metadata ) this.setMetadata(props.Metadata.deep_unpack());
                if ( props.CanGoNext || props.CanGoPrevious ) this.updateControls();
            }));
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    _buildLayout: function() {
        try {
            this.compactibleElements = [];
            
            this.actor.destroy_all_children();
            
            let mainBox = new St.BoxLayout({ vertical: true });
            this.actor.set_child(mainBox);
            
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
            let trackCoverIcon = new St.Icon({ icon_size: settings.artSize, icon_name: "media-optical-cd-audio", style_class: settings.theme+"-albumCover", icon_type: St.IconType.FULLCOLOR });
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
            settings.connect("redraw-art", Lang.bind(this, this.showCoverArt))
            
            //time display controls
            this.timeControls = new TimeControls(this._timeTracker);
            mainBox.add_actor(this.timeControls.actor);
            
            //control buttons
            this.trackControls = new St.Bin({ x_align: St.Align.MIDDLE });
            mainBox.add_actor(this.trackControls);
            this.controls = new St.BoxLayout({ style_class: settings.theme+"-buttonBox" });
            this.trackControls.set_child(this.controls);
            this.compactibleElements.push(this.controls);
            
            this._prevButton = new ControlButton("media-skip-backward", Lang.bind(this, function() {
                this._mediaServerPlayer.PreviousRemote();
                if ( supported_players[this.name].timeIssues ) this._timeTracker.setElapsed(0);
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
                if ( supported_players[this.name].timeIssues ) this._timeTracker.setElapsed(0);
            }));
            this._nextButtonTooltip = new Tooltips.Tooltip(this._nextButton.button, _("Next"));
            this._nextButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
            this.controls.add_actor(this._nextButton.getActor());
            
            if (this._mediaServer.CanRaise) {
                this._raiseButton = new ControlButton("go-up", Lang.bind(this, function() {
                    this.parent.lower();
                    this._mediaServer.RaiseRemote();
                }));
                this._raiseButtonTooltip = new Tooltips.Tooltip(this._raiseButton.button, _("Open Player"));
                this._raiseButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
                this.controls.add_actor(this._raiseButton.getActor());
            }
            
            if (this._mediaServer.CanQuit) {
                this._quitButton = new ControlButton("window-close", Lang.bind(this, function() {
                    this.parent.lower();
                    this._mediaServer.QuitRemote();
                }));
                this.controls.add_actor(this._quitButton.getActor());
                this._quitButtonTooltip = new Tooltips.Tooltip(this._quitButton.button, _("Quit Player"));
                this._quitButtonTooltip._tooltip.add_style_class_name(settings.theme+"-tooltip");
            }
            
            if ( settings.compact ) {
                for ( let i = 0; i < this.compactibleElements.length; i++ ) this.compactibleElements[i].add_style_pseudo_class("compact");
            }
            
            if ( !supported_players[this.name].seek ) {
                this.timeControls.actor.hide();
            }
            
        } catch (e) {
            global.logError(e);
        }
    },
    
    destroy: function() {
        this.actor.destroy();
        this.playerTitle.actor.destroy();
        if ( this._timeTracker ) this._timeTracker.destroy();
        if ( this._propChangedId ) this._prop.disconnectSignal(this._propChangedId);
    },
    
    updateTheme: function() {
        if ( this._timeoutId != 0 ) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._buildLayout();
    },
    
    getTitle: function() {
        return this.name.charAt(0).toUpperCase() + this.name.slice(1);
    },
    
    setTitle: function(status) {
        this.playerTitle.setText(this.getTitle() + " - " + _(status));
    },
    
    updateSeekable: function(position) {
        this._canSeek = this.getCanSeek();
        if ( this._timeTracker.totalCount == 0 || position == false ) this._canSeek = false;
    },
    
    getCanSeek: function() {
        let can_seek = true;
        this._prop.GetRemote(MEDIA_PLAYER_2_PLAYER_NAME, "CanSeek", Lang.bind(this, function(position, error) {
            if ( !error ) {
                can_seek = position[0].get_boolean();
            }
        }));
        return can_seek;
    },
    
    _updateControls: function() {
        this._prop.GetRemote(MEDIA_PLAYER_2_PLAYER_NAME, "CanGoNext", Lang.bind(this, function(value, error) {
            let canGoNext = true;
            if ( !error ) canGoNext = value[0].unpack();
            if ( canGoNext ) this._nextButton.enable();
            else this._nextButton.disable();
        }));
        
        this._prop.GetRemote(MEDIA_PLAYER_2_PLAYER_NAME, "CanGoPrevious", Lang.bind(this, function(value, error) {
            let canGoPrevious = true;
            if ( !error ) canGoPrevious = value[0].unpack();
            if ( canGoPrevious ) this._prevButton.enable();
            else this._prevButton.disable();
        }));
    },
    
    setMetadata: function(metadata) {
        if ( !metadata ) return;
        
        if ( metadata["mpris:length"] ) {
            this._timeTracker.setTotal(metadata["mpris:length"].unpack() / 1000000);
            this._timeTracker.fetchPosition();
            if ( this._playerStatus == "Playing" ) {
                this._timeTracker.start();
            }
        }
        else {
            this._timeTracker.setTotal(0);
        }
        if ( metadata["xesam:artist"] ) this._artist.setLabel(metadata["xesam:artist"].deep_unpack());
        else this._artist.setLabel(_("Unknown Artist"));
        if ( metadata["xesam:album"] ) this._album.setLabel(metadata["xesam:album"].unpack());
        else this._album.setLabel(_("Unknown Album"));
        if ( metadata["xesam:title"] ) this._title.setLabel(metadata["xesam:title"].unpack());
        else this._title.setLabel(_("Unknown Title"));
        
        if ( metadata["mpris:trackid"] ) this._timeTracker.trackId = metadata["mpris:trackid"].unpack();
        
        let change = false;
        if ( metadata["mpris:artUrl"] ) {
            if ( this.trackCoverFile != metadata["mpris:artUrl"].unpack() ) {
                this.trackCoverFile = metadata["mpris:artUrl"].unpack();
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
                    let uri = this.trackCoverFile;
                    if ( this.name == "spotify" ) uri = uri.replace("thumb", "300");
                    let cover = Gio.file_new_for_uri(decodeURIComponent(uri));
                    if ( !this.trackCoverFileTmp ) this.trackCoverFileTmp = Gio.file_new_tmp("XXXXXX.mediaplayer-cover")[0];
                    cover.read_async(null, null, Lang.bind(this, this._onReadCover));
                }
                else {
                    this.coverPath = decodeURIComponent(this.trackCoverFile);
                    this.coverPath = this.coverPath.replace("file://", "");
                    this.showCoverArt();
                }
            }
            else this.showCoverArt();
        }
    },
    
    setStatus: function(status) {
        this.updateSeekable();
        this._playerStatus = status;
        if ( status == "Playing" ) {
            this._timeTracker.start();
            this._playButton.setIcon("media-playback-pause");
        }
        else if ( status == "Paused" ) {
            this._timeTracker.pause();
            this._playButton.setIcon("media-playback-start");
        }
        else if ( status == "Stopped" ) {
            this._timeTracker.stop();
            this._playButton.setIcon("media-playback-start");
        }
        
        this.playerTitle.setImage("player-" + status.toLowerCase());
        this.setTitle(status);
    },
    
    _onReadCover: function(cover, result) {
        let inStream = cover.read_finish(result);
        let outStream = this.trackCoverFileTmp.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, null);
        outStream.splice_async(inStream, Gio.OutputStreamSpliceFlags.CLOSE_TARGET, 0, null, Lang.bind(this, this._onSavedCover));
    },
    
    _onSavedCover: function(outStream, result) {
        outStream.splice_finish(result, null);
        this.coverPath = this.trackCoverFileTmp.get_path();
        this.showCoverArt(this.coverPath);
    },
    
    showCoverArt: function() {
        if ( ! this.coverPath || ! GLib.file_test(this.coverPath, GLib.FileTest.EXISTS) ) {
            this.trackCover.set_child(new St.Icon({ icon_size: settings.artSize, icon_name: "media-optical-cd-audio", style_class: settings.theme+"albumCover", icon_type: St.IconType.FULLCOLOR }));
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
    }
}


function myDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

myDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,
    
    _init: function(metadata, desklet_id) {
        try {
            
            this.metadata = metadata;
            Desklet.Desklet.prototype._init.call(this, metadata);
            inhibitor = new Inhibitor(this._draggable);
            
            settings = new SettingsInterface(metadata.uuid, desklet_id);
            settings.connect("que-rebuild", Lang.bind(this, this.rebuild));
            settings.connect("keybinding-changed", Lang.bind(this, this.bindKey));
            settings.connect("systray-show-hide", Lang.bind(this, function() {
                if ( settings.hideSystray ) this.registerSystrayIcons();
                else this.unregisterSystrayIcons();
            }))
            this.bindKey();
            if ( settings.hideSystray ) this.registerSystrayIcons();
            
            this.players = {};
            this.owners = [];
            this.apps = [];
            this.playerShown = null;
            this.output = null;
            this.outputVolumeId = 0;
            this.outputMutedId = 0;
            this._volumeControlShown = false;
            
            Interfaces.getDBusAsync(Lang.bind(this, function (proxy, error) {
                this._dbus = proxy;
                
                // player DBus name pattern
                let name_regex = /^org\.mpris\.MediaPlayer2\./;
                // load players
                this._dbus.ListNamesRemote(Lang.bind(this, function(names) {
                    for ( let n in names[0] ) {
                        let name = names[0][n];
                        if ( name_regex.test(name) ) {
                            this._dbus.GetNameOwnerRemote(name, Lang.bind(this, function(owner) {
                                this._addPlayer(name, owner);
                            }));
                        }
                    }
                }));
                
                // watch players
                this._ownerChangedId = this._dbus.connectSignal("NameOwnerChanged", Lang.bind(this, function(proxy, sender, [name, old_owner, new_owner]) {
                    if ( name_regex.test(name) ) {
                        if ( new_owner && !old_owner )
                            this._addPlayer(name, new_owner);
                        else if ( old_owner && !new_owner && this.players[old_owner] )
                            this._removePlayer(name, old_owner);
                        else
                            this._changePlayerOwner(name, old_owner, new_owner);
                    }
                }));
            }));
            
            this.volumeControl = new Gvc.MixerControl({ name: "Cinnamon Volume Control" });
            this.volumeControl.connect("state-changed", Lang.bind(this, this._onControlStateChanged));
            this.volumeControl.connect("default-sink-changed", Lang.bind(this, this.readOutput));
            this.volumeControl.connect("default-source-changed", Lang.bind(this, this.readInput));
            this.volumeControl.connect("card-added", Lang.bind(this, this._onControlStateChanged));
            this.volumeControl.connect("card-removed", Lang.bind(this, this._onControlStateChanged));
            this.volumeControl.connect("stream-added", Lang.bind(this, this._reloadApps));
            this.volumeControl.connect("stream-removed", Lang.bind(this, this._reloadApps));
            this.normVolume = this.volumeControl.get_vol_max_norm();
            this.maxVolume = this.volumeControl.get_vol_max_amplified();
            this.volumeControl.open();
            
            //context menu
            this._menu.addMenuItem(new PopupMenu.PopupMenuItem(_("Output Devices"), { reactive: false }));
            this.outputDevices = new PopupMenu.PopupMenuSection();
            this.outputDevices.actor.add_style_class_name("soundBox-contextMenuSection");
            this._menu.addMenuItem(this.outputDevices);
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            
            this._menu.addMenuItem(new PopupMenu.PopupMenuItem(_("Input Devices"), { reactive: false }));
            this.inputDevices = new PopupMenu.PopupMenuSection();
            this.inputDevices.actor.add_style_class_name("soundBox-contextMenuSection");
            this._menu.addMenuItem(this.inputDevices);
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            
            this._menu.addSettingsAction(_("Sound Settings"), "sound");
            this._menu.addAction(_("About..."), Lang.bind(this, this.openAbout));
            
            this._build_interface();
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    openAbout: function() {
        new AboutDialog(this.metadata);
    },
    
    on_desklet_removed: function() {
        this.unregisterSystrayIcons();
        this._dbus.disconnectSignal(this._ownerChangedId);
    },
    
    registerSystrayIcons: function() {
        if ( !Main.systrayManager ) {
            global.log("Soundbox: system tray icons were not hidden - this feature is not available in your version of Cinnamon");
            return;
        }
        for ( let i in supported_players ) {
            if ( supported_players[i].seek ) Main.systrayManager.registerRole(i, this.metadata.uuid);
        }
    },
    
    unregisterSystrayIcons: function() {
        if ( !Main.systrayManager ) return;
        Main.systrayManager.unregisterId(this.metadata.uuid);
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
        
        DeskletManager.mouseTrackEnabled = -1;
        DeskletManager.checkMouseTracking();
        
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
        
        //volume controls
        let divider = new Divider();
        this.mainBox.add_actor(divider.actor);
        
        this.outputVolumeDisplay = new SystemVolumeDisplay("Volume: ", this.normVolume, this.maxVolume);
        this.mainBox.add_actor(this.outputVolumeDisplay.actor);
        
        if ( settings.showInput ) {
            let divider = new Divider();
            this.mainBox.add_actor(divider.actor);
            
            this.inputVolumeDisplay = new SystemVolumeDisplay("Input Volume: ", this.normVolume, this.maxVolume);
            this.mainBox.add_actor(this.inputVolumeDisplay.actor);
        }
        
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
            this.readOutput();
            this.readInput();
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
    
    _onControlStateChanged: function() {
        if ( this.volumeControl.get_state() == Gvc.MixerControlState.READY ) {
            this.readOutput();
            this.readInput();
        }
    },
    
    readOutput: function() {
        this.output = this.volumeControl.get_default_sink();
        this.outputVolumeDisplay.setControl(this.output);
        
        //add output devices to context menu
        let sinks = this.volumeControl.get_sinks();
        this.outputDevices.removeAll();
        for ( let i = 0; i < sinks.length; i++ ) {
            let sink = sinks[i];
            let deviceItem = new PopupMenu.PopupMenuItem(sink.get_description());
            if ( sinks[i].get_id() == this.output.get_id() ) {
                deviceItem.setShowDot(true);
            }
            deviceItem.connect("activate", Lang.bind(this, function() {
                global.log("Default output set as " + sink.get_description());
                this.volumeControl.set_default_sink(sink);
            }));
            this.outputDevices.addMenuItem(deviceItem);
        }
    },
    
    readInput: function() {
        this.input = this.volumeControl.get_default_source();
        if ( settings.showInput ) this.inputVolumeDisplay.setControl(this.input);
        
        //add input devices to context menu
        let sources = this.volumeControl.get_sources();
        this.inputDevices.removeAll();
        for ( let i = 0; i < sources.length; i++ ) {
            let source = sources[i];
            let deviceItem = new PopupMenu.PopupMenuItem(source.get_description());
            if ( sources[i].get_id() == this.input.get_id() ) {
                deviceItem.setShowDot(true);
            }
            deviceItem.connect("activate", Lang.bind(this, function() {
                global.log("Default input set as " + source.get_description());
                this.volumeControl.set_default_source(source);
            }));
            this.inputDevices.addMenuItem(deviceItem);
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
    
    _addPlayer: function(name, owner) {
        try {
            
            this.players[owner] = new Player(this, owner, name);
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
    
    _removePlayer: function(name, owner) {
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
