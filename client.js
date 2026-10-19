/**
 * dsh-plugin-versions — Client half.
 *
 * 在「插件」页的 Installed 之后注册一个「版本」页签：
 *   - 列出本 profile 已安装的 bundle
 *   - 展开某个 bundle 时列出它在 registry 上的所有已发布版本
 *   - 支持切换版本（失败自动回滚）与卸载
 *
 * 所有宿主操作都走 POST /plugin-versions/api/<method>（见 index.js）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-versions',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const API = '/plugin-versions/api/';
    const ZH = String((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase().startsWith('zh');

    const STRINGS = {
      tab: { zh: '版本', en: 'Versions' },
      title: { zh: '已安装插件版本', en: 'Installed plugin versions' },
      hint: {
        zh: '切换版本走宿主 pluginManager：先卸载旧版本、再安装目标版本，失败会自动装回原版本。操作后通常需要刷新页面。',
        en: 'Version switches go through the host pluginManager: remove, then install, with automatic rollback on failure. Refresh the page afterwards.',
      },
      refresh: { zh: '刷新', en: 'Refresh' },
      loading: { zh: '加载中…', en: 'Loading…' },
      empty: { zh: '这个 profile 还没有安装任何插件。', en: 'This profile has no installed plugins yet.' },
      current: { zh: '当前', en: 'current' },
      latest: { zh: '最新', en: 'latest' },
      deprecated: { zh: '已弃用', en: 'deprecated' },
      switch: { zh: '切换', en: 'Switch' },
      switching: { zh: '切换中…', en: 'Switching…' },
      uninstall: { zh: '卸载', en: 'Uninstall' },
      uninstalling: { zh: '卸载中…', en: 'Removing…' },
      versions: { zh: '版本…', en: 'Versions…' },
      hide: { zh: '收起', en: 'Hide' },
      protected: { zh: '受保护', en: 'protected' },
      official: { zh: '官方', en: 'official' },
      noVersions: { zh: 'registry 上没有可用版本。', en: 'No published versions found.' },
      runtime: { zh: '运行时', en: 'runtime' },
      registry: { zh: '源', en: 'registry' },
      confirmSwitch: {
        zh: '把 {name} 从 {from} 切换到 {to}？\n\n会先卸载当前版本再安装目标版本；安装失败会自动回滚。',
        en: 'Switch {name} from {from} to {to}?\n\nThe current version is removed first and restored if the install fails.',
      },
      confirmRemove: {
        zh: '卸载 {name} {version}？\n\n插件的配置数据会保留，但它的功能会立即消失。',
        en: 'Uninstall {name} {version}?\n\nIts configuration is kept, but the feature disappears immediately.',
      },
      applied: { zh: '已生效', en: 'applied' },
      restart: { zh: '需要重启 DSH 才能完全生效', en: 'restart DSH to finish' },
      rolledBack: { zh: '安装失败，已回滚到 {version}', en: 'Install failed; rolled back to {version}' },
      rollbackFailed: { zh: '安装失败，且回滚也失败——请在「插件」页手动重装 {version}', en: 'Install failed and rollback failed; reinstall {version} from the Plugins page' },
      removedOk: { zh: '已卸载 {name}', en: 'Removed {name}' },
      failed: { zh: '失败：', en: 'Failed: ' },
    };

    function t(key, vars) {
      const entry = STRINGS[key];
      let text = entry ? (ZH ? entry.zh : entry.en) : key;
      if (vars) {
        for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
      }
      return text;
    }

    async function call(method, body) {
      const response = await fetch(API + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify(body || {}),
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      if (!payload || !payload.ok) {
        const error = new Error((payload && payload.error && payload.error.message) || `HTTP ${response.status}`);
        error.code = payload && payload.error && payload.error.code;
        error.details = payload && payload.error && payload.error.details;
        throw error;
      }
      return payload.data;
    }

    function formatDate(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 2px 18px', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' },
      top: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      title: { fontWeight: 600, fontSize: '14px' },
      hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', lineHeight: 1.5, flex: '1 1 320px' },
      button: {
        background: 'var(--dsw-alias-button-ghost-active-fill)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '5px',
        padding: '3px 10px',
        cursor: 'pointer',
        fontSize: '12px',
      },
      card: {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderRadius: '7px',
        padding: '9px 11px',
      },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      name: { fontFamily: 'Consolas, monospace', fontSize: '12.5px', fontWeight: 600 },
      version: { color: 'var(--dsw-alias-label-secondary)', fontFamily: 'Consolas, monospace', fontSize: '12px' },
      tag: {
        fontSize: '10.5px',
        padding: '1px 6px',
        borderRadius: '4px',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      tagCurrent: { borderColor: 'var(--dsw-alias-state-business-primary)', color: 'var(--dsw-alias-state-business-primary)' },
      tagWarn: { borderColor: 'var(--dsw-alias-state-warning-primary)', color: 'var(--dsw-alias-state-warning-primary)' },
      spacer: { flex: '1 1 auto' },
      muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', padding: '6px 0' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', whiteSpace: 'pre-wrap' },
      ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: '12px', whiteSpace: 'pre-wrap' },
      list: { marginTop: '8px', maxHeight: '320px', overflowY: 'auto', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      vrow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 2px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      mono: { fontFamily: 'Consolas, monospace', fontSize: '12px', minWidth: '92px' },
      date: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', minWidth: '78px' },
    };

    function Tag(props) {
      return h('span', { style: Object.assign({}, S.tag, props.style || {}) }, props.children);
    }

    function VersionsTab() {
      const [state, setState] = React.useState({ loading: true, error: '', data: null });
      const [expanded, setExpanded] = React.useState(null);
      const [details, setDetails] = React.useState({});
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState(null);

      const load = React.useCallback(async () => {
        setState((prev) => Object.assign({}, prev, { loading: true, error: '' }));
        try {
          const data = await call('list');
          setState({ loading: false, error: '', data });
        } catch (error) {
          setState({ loading: false, error: String(error.message || error), data: null });
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      const openVersions = async (name) => {
        if (expanded === name) {
          setExpanded(null);
          return;
        }
        setExpanded(name);
        setNotice(null);
        if (details[name] && details[name].versions) return;
        setDetails((prev) => Object.assign({}, prev, { [name]: { loading: true } }));
        try {
          const data = await call('versions', { name });
          setDetails((prev) => Object.assign({}, prev, { [name]: { loading: false, data } }));
        } catch (error) {
          setDetails((prev) => Object.assign({}, prev, { [name]: { loading: false, error: String(error.message || error) } }));
        }
      };

      const doSwitch = async (name, from, version) => {
        if (!window.confirm(t('confirmSwitch', { name, from: from || '?', to: version }))) return;
        setBusy(`${name}@${version}`);
        setNotice(null);
        try {
          const result = await call('switch', { name, version });
          if (result.applied === 'failed') {
            const message = result.error && (result.error.diagnostic || result.error.code);
            if (result.rolledBack) {
              setNotice({ kind: 'error', text: `${t('failed')}${message || ''}\n${t('rolledBack', { version: result.previousVersion })}` });
            } else {
              setNotice({ kind: 'error', text: `${t('failed')}${message || ''}\n${t('rollbackFailed', { version: result.previousVersion || '?' })}` });
            }
          } else if (result.applied === 'noop') {
            setNotice({ kind: 'ok', text: t('applied') });
          } else {
            setNotice({ kind: 'ok', text: `${t('applied')}${result.applied === 'restart-required' ? ' — ' + t('restart') : ''}` });
          }
          setExpanded(name);
          await load();
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('failed')}${String(error.message || error)}` });
        } finally {
          setBusy('');
        }
      };

      const doRemove = async (bundle) => {
        if (!window.confirm(t('confirmRemove', { name: bundle.name, version: bundle.version || '?' }))) return;
        setBusy(`remove:${bundle.name}`);
        setNotice(null);
        try {
          await call('remove', { name: bundle.name });
          setNotice({ kind: 'ok', text: t('removedOk', { name: bundle.name }) });
          setExpanded(null);
          await load();
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('failed')}${String(error.message || error)}` });
        } finally {
          setBusy('');
        }
      };

      const installed = (state.data && state.data.installed) || [];
      const runtime = state.data && state.data.runtime;

      return h(
        'div',
        { style: S.wrap },
        h(
          'div',
          { style: S.top },
          h('div', { style: S.title }, t('title')),
          runtime ? h('div', { style: S.muted }, `${t('runtime')} ${runtime}`) : null,
          h('div', { style: S.spacer }),
          h('button', { style: S.button, onClick: load, disabled: state.loading || Boolean(busy) }, t('refresh')),
        ),
        h('div', { style: S.hint }, t('hint')),
        notice
          ? h('div', { style: notice.kind === 'error' ? S.error : S.ok }, notice.text)
          : null,
        state.error ? h('div', { style: S.error }, state.error) : null,
        state.loading && !installed.length ? h('div', { style: S.muted }, t('loading')) : null,
        !state.loading && !state.error && !installed.length ? h('div', { style: S.muted }, t('empty')) : null,
        installed.map((bundle) => {
          const isOpen = expanded === bundle.name;
          const detail = details[bundle.name];
          const switching = busy.startsWith(bundle.name + '@');
          const removing = busy === `remove:${bundle.name}`;
          return h(
            'div',
            { key: bundle.name, style: S.card },
            h(
              'div',
              { style: S.row },
              h('span', { style: S.name }, bundle.name),
              h('span', { style: S.version }, bundle.version || '—'),
              bundle.official ? h(Tag, null, t('official')) : null,
              !bundle.removable ? h(Tag, { style: S.tagWarn }, t('protected')) : null,
              h('span', { style: S.spacer }),
              h(
                'button',
                { style: S.button, onClick: () => openVersions(bundle.name), disabled: Boolean(busy) },
                isOpen ? t('hide') : t('versions'),
              ),
              bundle.removable
                ? h(
                    'button',
                    { style: S.button, onClick: () => doRemove(bundle), disabled: Boolean(busy) },
                    removing ? t('uninstalling') : t('uninstall'),
                  )
                : null,
            ),
            bundle.source ? h('div', { style: S.muted }, `${t('registry')} ${bundle.source}`) : null,
            isOpen
              ? h(
                  'div',
                  { style: S.list },
                  detail && detail.loading ? h('div', { style: S.muted }, t('loading')) : null,
                  detail && detail.error ? h('div', { style: S.error }, detail.error) : null,
                  detail && detail.data
                    ? detail.data.versions.length
                      ? detail.data.versions.map((item) =>
                          h(
                            'div',
                            { key: item.version, style: S.vrow },
                            h('span', { style: S.mono }, item.version),
                            h('span', { style: S.date }, formatDate(item.date)),
                            item.version === bundle.version
                              ? h(Tag, { style: S.tagCurrent }, t('current'))
                              : null,
                            item.latest ? h(Tag, null, t('latest')) : null,
                            item.deprecated ? h(Tag, { style: S.tagWarn }, t('deprecated')) : null,
                            h('span', { style: S.spacer }),
                            item.version === bundle.version
                              ? null
                              : h(
                                  'button',
                                  {
                                    style: S.button,
                                    disabled: Boolean(busy),
                                    onClick: () => doSwitch(bundle.name, bundle.version, item.version),
                                  },
                                  switching ? t('switching') : t('switch'),
                                ),
                          ),
                        )
                      : h('div', { style: S.muted }, t('noVersions'))
                    : null,
                )
              : null,
          );
        }),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.tab', () =>
          ctx.slots.register(
            { name: 'plugins.tab', id: 'versions', order: 10, label: () => t('tab') },
            VersionsTab,
          ),
        );
      },
    };
  },
});
