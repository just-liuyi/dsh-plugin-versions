# dsh-plugin-versions

Version browser for **DeepSeek Harness** plugins. It adds an **Installed plugins** page under **Settings → Plugins** where you can see every published version of an installed plugin, switch to one, roll back, or uninstall it — all through the host's own `pluginManager` service.

English | [中文](./README.zh.md)

## Why

The official plugin manager intentionally has no version picker: third-party plugins are upgraded by uninstalling and reinstalling, and only official on-demand bundles get an explicit **Update** button. Pinning a known-good version, or returning to one after a regression, means editing `package.json` by hand.

This plugin adds exactly that missing surface, without replacing the market or the installer.

## Features

- Lists the bundles the current profile installs, with version, source spec, and whether the bundle is removable
- Expands a bundle into its full published version list from the registry (publish date, `latest`, deprecated flags)
- Switches version through `pluginManager.removeBundle` → `pluginManager.installBundle`, saving an exact dependency
- **Automatic rollback**: if the target version fails to install (peer gate, missing version, network), the previous version is installed back and the failure is reported
- Uninstalls a profile bundle from the same tab
- Works with the profile's configured registry (private registries included) and falls back to `registry.npmjs.org`

## Install

The npm package is not published yet, so install straight from this repository:

```bash
dsh plugin --profile <name> add github:DangDangDeng/dsh-plugin-versions
```

or with an explicit Git URL:

```bash
dsh plugin --profile <name> add git+https://github.com/DangDangDeng/dsh-plugin-versions.git
```

In DSH Desktop the `desktop` profile is managed by the application, so use **Plugins → Add plugin** and enter `github:DangDangDeng/dsh-plugin-versions` instead of the CLI. Restart or refresh the page afterwards. Add `#<tag>` or `#<commit>` to pin a revision.

Once published to npm, `dsh plugin add dsh-plugin-versions` will work as well.

## Use

1. Open **Settings → Plugins**.
2. Select the **Installed plugins** tab.
3. Expand a plugin to see its versions. The current one is tagged, and the newest is tagged `latest`.
4. **Switch** asks for confirmation, then removes and reinstalls the plugin at that version. A failure rolls back automatically.
5. **Uninstall** removes the bundle; its configuration is kept.

Refresh the page after a switch so the browser loads the other version's client half.

## How a switch works

```
pluginManager.listBundles()        find the installed bundle, remember its version
pluginManager.removeBundle(name)   unload + remove the dependency
pluginManager.installBundle(name@version, { saveExact: true, enabled: true })
   ├─ success → ChangeResult.application: applied | restart-required
   └─ failure → remove the half-installed package, install the previous version
```

`installBundle` refuses a package the profile already depends on (`already-installed`) in HMR profiles, which is why the removal is not optional. The host performs the same check before pnpm runs, so an incompatible peer range is reported without touching the profile.

## HTTP surface

The client half talks to the host half over one loopback-only route:

```
POST /plugin-versions/api/{list|versions|switch|remove}
```

Requests must carry `x-requested-with: XMLHttpRequest`, must not be `sec-fetch-site: cross-site`, and must arrive on a loopback `Host` (`127.0.0.1`, `localhost`, `::1`). Only bundles already installed in this profile can be switched or removed, so the route cannot be used as a general package installer.

## Limitations

- Loopback only: a page served with `--trusted-host` from another machine is refused.
- No automatic update check; this is a version browser, not an updater.
- Compatibility is not pre-checked per version — the host rejects an incompatible version and the switch rolls back.
- A switch needs `HMR` to apply live; without it the host reports `restart-required`.
- The page must be refreshed before the new version's client half runs.

## Development

Plain ESM, no build step:

```
index.js          host half: HTTP route + pluginManager calls
client.js         browser bundle: registers the Versions tab into plugins.tab
cordis.patch.yml  inserts the bundle row
locale/*.json     bundle title and description
```

Point the installer at this directory (`dsh plugin add <path>`, or **Add plugin** with an absolute path). The directory is linked, so edits take effect after a restart.

## License

MIT
