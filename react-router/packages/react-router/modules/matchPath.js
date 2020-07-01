import pathToRegexp from "path-to-regexp";

const cache = {};
// 最大缓存量限制
const cacheLimit = 10000;
let cacheCount = 0;

// 编译路径、将路径转换成正则表达式
// 并缓存
function compilePath(path, options) {
  // 缓存分为两步
  // 1. 按配置项分类
  // 2. 找到分类下的缓存，存储路径正则及路径参数数组
  // 比如pathToRegexp('/:foo/:bar')
  // keys = [{ name: 'foo', prefix: '/', ... }, { name: 'bar', prefix: '/', ... }]
  // @See https://github.com/pillarjs/path-to-regexp
  const cacheKey = `${options.end}${options.strict}${options.sensitive}`;
  const pathCache = cache[cacheKey] || (cache[cacheKey] = {});

  if (pathCache[path]) return pathCache[path];

  const keys = [];
  const regexp = pathToRegexp(path, keys, options);
  const result = { regexp, keys };

  if (cacheCount < cacheLimit) {
    pathCache[path] = result;
    cacheCount++;
  }

  return result;
}

/**
 * Public API for matching a URL pathname to a path.
 */
function matchPath(pathname, options = {}) {
  if (typeof options === "string" || Array.isArray(options)) {
    options = { path: options };
  }

  const { path, exact = false, strict = false, sensitive = false } = options;

  // 为什么使用数组形式？
  const paths = [].concat(path);

  return paths.reduce((matched, path) => {
    if (!path && path !== "") return null;
    if (matched) return matched;

    const { regexp, keys } = compilePath(path, {
      end: exact,
      strict,
      sensitive
    });
    const match = regexp.exec(pathname);

    if (!match) return null;

    const [url, ...values] = match;
    const isExact = pathname === url;

    if (exact && !isExact) return null;

    return {
      path, // the path used to match
      url: path === "/" && url === "" ? "/" : url, // the matched portion of the URL
      isExact, // whether or not we matched exactly
      params: keys.reduce((memo, key, index) => {
        memo[key.name] = values[index];
        return memo;
      }, {})
    };
  }, null);
}

export default matchPath;
