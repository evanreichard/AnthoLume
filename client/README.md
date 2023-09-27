# Book Manager - SyncNinja KOReader Plugin

This is BookManagers KOReader Plugin called `syncninja.koplugin`. Features include:

- Syncing read activity
- Uploading documents
- Configurable sync settings

## Installation

Copy the `syncninja.koplugin` directory to the `plugins` directory for your KOReader installation. Restart KOReader and SyncNinja will be accessible via the Tools menu.

## Configuration

You must configure the BookManager server and credentials in SyncNinja. Afterwhich you'll have the ability to configure the sync cadence as well as whether you'd like the plugin to sync your activity, document metadata, and/or documents themselves.

## KOSync Compatibility

BookManager implements API's compatible with the KOSync plugin. This means that you can utilize this server for KOSync (and it's recommended!). SyncNinja provides an easy way to merge configurations between both KOSync and itself in the menu.

The KOSync compatible API endpoint is located at: `http(s)://<SERVER>/api/ko`. You can either use the previous mentioned merge feature to automatically configure KOSync once SyncNinja is configured, or you can manually set KOSync's server to the above.
