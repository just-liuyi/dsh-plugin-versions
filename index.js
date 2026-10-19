/**
 * dsh-plugin-versions — Host half.
 *
 * 给「插件」页的「版本」页签提供三个能力：
 *   1. 列出本 profile 已安装的 bundle（版本、来源 spec、是否可卸载）
 *   2. 列出某个包在 registry 上的所有已发布版本（含发布时间、是否 latest、是否已弃用）
 *   3. 切换版本（先 remove 再 install，失败自动回滚）与卸载
 *
 * 全部操作都走宿主 `pluginManager` 服务，和官方插件管理器同一条代码路径；
 * 本插件不直接改 package.json / cordis.patch.yml。
 *
 * 浏览器半边通过 POST /plugin-versions/api/<method> 调用本文件的 routes。
 */

const API_PATH = '/plugin-versions/api';
const API_BASE = API_PATH + '/';
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 只接受环回地址；页面与宿主同源，正常请求一定带 127.0.0.1/localhost/[::1]。 */
function hostnameOf(hostHeader) {
  const value = String(hostHeader || '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(1, end) : value;
  }
  return value.split(':')[0];
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'body-too-large', '请求体超过 1 MiB 上限'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'invalid-json', '请求体不是合法 JSON'));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

function requireName(value) {
  const name = String(value || '').trim();
  if (!NAME_RE.test(name)) throw new HttpError(400, 'invalid-name', `不是合法的包名：${name || '(空)'}`);
  return name;
}

function requireVersion(value) {
  const version = String(value || '').trim();
  if (!VERSION_RE.test(version)) throw new HttpError(400, 'invalid-version', `不是合法的版本号：${version || '(空)'}`);
  return version;
}

/** SemVer 降序；预发布版本低于同号正式版。 */
function compareVersions(a, b) {
  const split = (value) => {
    const [core, pre = ''] = String(value).split('+')[0].split('-');
    return { core: core.split('.').map((n) => Number(n) || 0), pre };
  };
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.core[i] || 0) - (right.core[i] || 0);
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre, 'en', { numeric: true });
}

async function registryBase(manager) {
  try {
    const registries = await manager.registries();
    const first = registries && (registries.registry || registries.resolved);
    if (typeof first === 'string' && first.trim()) return first.trim().replace(/\/+$/, '');
  } catch {
    /* 读不到 registry 配置时退回官方源 */
  }
  return DEFAULT_REGISTRY;
}

async function fetchPackument(manager, name) {
  const base = await registryBase(manager);
  const url = `${base}/${name.replace('/', '%2F')}`;
  let response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new HttpError(502, 'registry-unreachable', `无法访问 registry：${url}`, { reason: String(error && error.message || error) });
  }
  if (response.status === 404) {
    throw new HttpError(404, 'package-not-found', `registry 上没有这个包：${name}`, { registry: base });
  }
  if (!response.ok) {
    throw new HttpError(502, 'registry-error', `registry 返回 ${response.status}`, { registry: base, url });
  }
  return { doc: await response.json(), registry: base };
}

/** 只处理「本 profile 已安装且可管理」的 bundle，路由本身不能变成任意包安装器。 */
async function findInstalledBundle(manager, name) {
  const bundles = await manager.listBundles();
  const bundle = (bundles || []).find((item) => item.name === name);
  if (!bundle) throw new HttpError(404, 'unknown-plugin', `profile 里没有这个 bundle：${name}`);
  if (!bundle.installed) throw new HttpError(400, 'not-installed', `${name} 不是本 profile 安装的依赖`);
  return bundle;
}

export const inject = ['webServer'];

export function apply(ctx) {
  const webServer = ctx.webServer;

  const manager = () => {
    const service = ctx.get('pluginManager');
    if (!service) throw new HttpError(503, 'manager-unavailable', '宿主没有提供 pluginManager 服务');
    return service;
  };

  const routes = {
    /** 已安装 bundle 清单 + 运行时版本。 */
    async list() {
      const pm = manager();
      const bundles = await pm.listBundles();
      let runtime = null;
      for (const item of bundles || []) {
        if (item.name === '@deepseek-ai/dsh-base' && item.version) runtime = item.version;
      }
      const installed = (bundles || [])
        .filter((item) => item.installed)
        .map((item) => ({
          name: item.name,
          version: item.version || null,
          source: item.source || null,
          enabled: Boolean(item.enabled),
          removable: Boolean(item.removable),
          official: Boolean(item.official),
          availability: item.availability,
          problem: item.error ? { code: item.error.code, diagnostic: item.error.diagnostic || null } : null,
        }));
      return { runtime, installed };
    },

    /** 某个包在 registry 上的全部版本。 */
    async versions(payload) {
      const name = requireName(payload.name);
      const { doc, registry } = await fetchPackument(manager(), name);
      const time = doc.time || {};
      const versions = Object.keys(doc.versions || {}).map((version) => {
        const manifest = doc.versions[version] || {};
        return {
          version,
          date: time[version] || null,
          deprecated: manifest.deprecated || null,
          latest: version === (doc['dist-tags'] && doc['dist-tags'].latest),
        };
      });
      versions.sort((a, b) => compareVersions(b.version, a.version));
      return { name, registry, versions };
    },

    /**
     * 切换版本。
     *
     * 宿主的 installBundle 在 HMR profile 里对「已安装的包」直接返回
     * already-installed（0.2.1-alpha.2 起的行为），所以必须先 removeBundle。
     * 为了让「装失败就一个插件都没了」不发生，这里记录旧版本并在失败时回滚。
     */
    async switch(payload) {
      const name = requireName(payload.name);
      const version = requireVersion(payload.version);
      const pm = manager();
      const bundle = await findInstalledBundle(pm, name);
      if (!bundle.removable) {
        throw new HttpError(400, 'not-removable', `${name} 由安装包提供或受保护，不能切换版本`);
      }
      const previousVersion = bundle.version || null;
      if (previousVersion === version && bundle.source) {
        return { name, previousVersion, requestedVersion: version, applied: 'noop', note: '已经是这个版本' };
      }

      const removed = await pm.removeBundle(name);
      if (removed && removed.application === 'failed') {
        return {
          name, previousVersion, requestedVersion: version, applied: 'failed',
          stage: 'remove', removed,
          error: removed.error || { code: 'remove-failed', diagnostic: '卸载旧版本失败' },
        };
      }

      let installed;
      try {
        installed = await pm.installBundle(`${name}@${version}`, { saveExact: true, enabled: true });
      } catch (error) {
        installed = {
          changed: false, application: 'failed', stage: 'install', target: `${name}@${version}`,
          error: { code: 'operation-error', diagnostic: String((error && error.message) || error) },
        };
      }

      if (installed && installed.application !== 'failed') {
        return { name, previousVersion, requestedVersion: version, applied: installed.application, installed };
      }

      // 回滚：先把半装状态清掉，再装回旧版本。
      let rollback = null;
      try {
        await pm.removeBundle(name);
      } catch {
        /* 可能根本没装上，忽略 */
      }
      if (previousVersion) {
        try {
          rollback = await pm.installBundle(`${name}@${previousVersion}`, { saveExact: true, enabled: true });
        } catch (error) {
          rollback = { application: 'failed', error: { code: 'operation-error', diagnostic: String((error && error.message) || error) } };
        }
      }
      return {
        name, previousVersion, requestedVersion: version, applied: 'failed', stage: 'install',
        installed, rollback,
        rolledBack: Boolean(rollback && rollback.application !== 'failed'),
      };
    },

    /** 卸载一个 profile 安装的 bundle。 */
    async remove(payload) {
      const name = requireName(payload.name);
      const pm = manager();
      const bundle = await findInstalledBundle(pm, name);
      if (!bundle.removable) {
        throw new HttpError(400, 'not-removable', `${name} 由安装包提供或受保护，不能卸载`);
      }
      const result = await pm.removeBundle(name);
      return { name, removed: result };
    },
  };

  const handler = async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '仅支持 POST' } });
      }
      if (String(req.headers['x-requested-with'] || '').trim().toLowerCase() !== 'xmlhttprequest') {
        return sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: '缺少 x-requested-with 请求头' } });
      }
      if (String(req.headers['sec-fetch-site'] || '').trim().toLowerCase() === 'cross-site') {
        return sendJson(res, 403, { ok: false, error: { code: 'cross-site', message: '拒绝跨站请求' } });
      }
      if (!LOOPBACK_HOSTS.has(hostnameOf(req.headers.host))) {
        return sendJson(res, 403, {
          ok: false,
          error: { code: 'untrusted-host', message: '本插件的接口只接受环回地址访问（当前版本不支持 --trusted-host 远程访问）' },
        });
      }
      const url = new URL(req.url || '/', 'http://localhost');
      if (!url.pathname.startsWith(API_BASE)) {
        return sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '未知路径' } });
      }
      const method = url.pathname.slice(API_BASE.length);
      const route = routes[method];
      if (!route) {
        return sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `未知方法：${method}` } });
      }
      const payload = await readJsonBody(req);
      const data = await route(payload);
      return sendJson(res, 200, { ok: true, data });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : 'internal-error';
      const message = String((error && error.message) || error);
      return sendJson(res, status, { ok: false, error: { code, message, details: error && error.details } });
    }
  };

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: API_PATH, handler }),
    'dsh-plugin-versions: version API route',
  );
}
