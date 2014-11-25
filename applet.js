const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;

const Applet = imports.ui.applet;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;

const Lang = imports.lang;

imports.searchPath.push( imports.ui.appletManager.appletMeta["soundBox@scollins"].path );
const Soundbox = imports.soundbox;

const SETTINGS_KEYS = ["hideSystray", "theme", "showInput", "showApps", "raiseKey", "centerRaised", "compact", "showArt", "artSize", "exceedNormVolume"];


let settings, actionManager;


function SettingsInterface(uuid, deskletId) {
    this._init(uuid, deskletId);
}

SettingsInterface.prototype = {
    _init: function(uuid, deskletId) {
        this.settings = new Settings.DeskletSettings(this, uuid, deskletId);
        for ( let i = 0; i < SETTINGS_KEYS.length; i++) {
            this.settings.bindProperty(Settings.BindingDirection.IN, SETTINGS_KEYS[i], SETTINGS_KEYS[i]);
        }
        
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "countUp", "countUp");
    }
}


function MyApplet(metadata, orientation, panel_height, instanceId) {
    this._init(metadata, orientation, panel_height, instanceId);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,
    
    _init: function(metadata, orientation, panel_height, instanceId) {
        try {
            
            this.metadata = metadata;
            this.orientation = orientation;
            Applet.TextIconApplet.prototype._init.call(this, this.orientation, panel_height);
            
            this.containers = {};
            
            settings = new SettingsInterface(metadata.uuid, instanceId);
            
            settings.settings.connect("changed::theme", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                this.mainBox.style_class = newVal + "-mainBox";
            }));
            settings.settings.connect("changed::compact", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                if ( newVal ) this.mainBox.pseudo_class = "compact";
                else this.mainBox.pseudo_class = "";
            }));
            settings.settings.connect("changed::raiseKey", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                this.bindKey();
            }));
            this.bindKey();
            settings.settings.connect("changed::hideSystray", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                if ( newVal ) Soundbox.registerSystrayIcons(this.metadata.uuid);
                else Soundbox.unregisterSystrayIcons(this.metadata.uuid);
            }))
            if ( settings.hideSystray ) Soundbox.registerSystrayIcons();
            
            actionManager = new Soundbox.ActionManager();
            
            //generate content containers
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, this.orientation);
            this.menuManager.addMenu(this.menu);
            this.menu.actor.style_class = "";
            this.mainBox = this.menu.box;
            this.mainBox.style_class = settings.theme + "-mainBox";
            if ( settings.compact ) this.mainBox.add_style_pseudo_class("compact");
            
            let players = new PopupMenu.PopupSubMenuMenuItem(_("Players"));
            //players.actor.style_class = settings.theme + "-submenu-menuitem";
            //players.menu.actor.style_class = settings.theme + "-submenu-menu";
            this.menu.addMenuItem(players);
            this.containers.playersMenu = players.menu;
            
            this.containers.volumeContent = new St.BoxLayout({ vertical: true });
            this.menu.addActor(this.containers.volumeContent);
            
            this.containers.playerContent = new St.BoxLayout({ vertical: true, style_class: "soundbox-playerBox" });
            this.menu.addActor(this.containers.playerContent);
            
            this.containers.context = new PopupMenu.PopupMenuSection();
            this._applet_context_menu.addMenuItem(this.containers.context);
            
            this.sbInterface = new Soundbox.SoundboxLayout(this.containers, settings, actionManager);
            
            //set up panel
            this.setPanelIcon();
            //this.setPanelText();
            this.set_applet_tooltip(_("Soundbox"));
            
        } catch (e) {
            global.logError(e);
        }
    },
    
    on_applet_clicked: function(event) {
        this.menu.toggle();
    },
    
    on_applet_removed_from_panel: function() {
        if ( this.keyId ) Main.keybindingManager.removeHotKey(this.keyId);
    },
    
    openMenu: function(){
        this.menu.open();
    },
    
    bindKey: function() {
        if ( this.keyId ) Main.keybindingManager.removeHotKey(this.keyId);
        if ( this.keyOpen == "" ) return;
        this.keyId = "soundbox-open";
        Main.keybindingManager.addHotKey(this.keyId, this.keyOpen, Lang.bind(this, this.openMenu));
    },
    
    setPanelIcon: function() {
        this.set_applet_icon_symbolic_name("audio-x-generic");
    //    if ( this.panelIcon == "" ||
    //       ( GLib.path_is_absolute(this.panelIcon) &&
    //         GLib.file_test(this.panelIcon, GLib.FileTest.EXISTS) ) ) {
    //        if ( this.panelIcon.search("-symbolic.svg") == -1 ) this.set_applet_icon_path(this.panelIcon);
    //        else this.set_applet_icon_symbolic_path(this.panelIcon);
    //    }
    //    else if ( Gtk.IconTheme.get_default().has_icon(this.panelIcon) ) {
    //        if ( this.panelIcon.search("-symbolic") != -1 ) this.set_applet_icon_symbolic_name(this.panelIcon);
    //        else this.set_applet_icon_name(this.panelIcon);
    //    }
    //    else this.set_applet_icon_name("soundbox");
    }
};


function main(metadata, orientation, panel_height, instanceId) {
    let myApplet = new MyApplet(metadata, orientation, panel_height, instanceId);
    return myApplet;
}
