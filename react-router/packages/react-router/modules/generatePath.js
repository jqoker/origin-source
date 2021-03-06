import pathToRegexp from "path-to-regexp";

const cache = {};
const cacheLimit = 10000;
let cacheCount = 0;

/** 将 path 转换为 regexp */
function compilePath(path) {
  if (cache[path]) return cache[path];

  const generator = pathToRegexp.compile(path);

  if (cacheCount < cacheLimit) {
    cache[path] = generator;
    cacheCount++;
  }

  return generator;
}

/**
 * Public API for generating a URL pathname from a path and parameters.
 */
// 创建path
function generatePath(path = "/", params = {}) {
  return path === "/" ? path : compilePath(path)(params, { pretty: true });
}

export default generatePath;
