Soundbox is an attractive and easy-to-use Desklet designed to control your volume and media players. It was originally forked from the Cinnamon sound applet, but has grown and evolved over time.

To use this desklet run (must have git installed):

    cd ~/.local/share/cinnamon/desklets/
    git clone https://github.com/collinss/Cinnamon-Soundbox.git soundBox@scollins

or download and extract contents to ~/.local/share/cinnamon/desklets/soundBox@scollins/

To Do
-----
    Create applet and sidebar versions
    Raised mode DnD

Done
----
    Switch to Gio dbus for Cinnamon 2.3+
    Remove about dialog (provided by Cinnamon 2.3+)
    Split into multiple files to ease transion into applet and sidebar extension.
    Switch icon for microphone volume
    Changes for Cinnamon 2.5+ (Backwards compatible with 2.4)
    Switch supported players to settings and make dynamic
    Move raise and close functionality to the title bar
    Add repeat and shuffle toggles
    Added new player status icons for the title bar (old ones were removed from Cinnamon default theme)
    Theme tweaks

Wish-list
---------
    Optional mixer

