import { createLocation } from './LocationUtils.js';
import {
  addLeadingSlash,
  stripTrailingSlash,
  hasBasename,
  stripBasename,
  createPath,
} from './PathUtils.js';
import createTransitionManager from './createTransitionManager.js';
import {
  canUseDOM,
  getConfirmation,
  supportsHistory,
  supportsPopStateOnHashChange,
  isExtraneousPopstateEvent,
} from './DOMUtils.js';
import invariant from './invariant.js';
import warning from './warning.js';

const PopStateEvent = 'popstate';
const HashChangeEvent = 'hashchange';

function getHistoryState() {
  try {
    return window.history.state || {};
  } catch (e) {
    // IE 11 sometimes throws when accessing window.history.state
    // See https://github.com/ReactTraining/history/pull/289
    return {};
  }
}

/**
 * Creates a history object that uses the HTML5 history API including
 * pushState, replaceState, and the popstate event.
 */
function createBrowserHistory(props = {}) {
  invariant(canUseDOM, 'Browser history needs a DOM');

  const globalHistory = window.history;
  const canUseHistory = supportsHistory();
  const needsHashChangeListener = !supportsPopStateOnHashChange();

  const {
    forceRefresh = false,
    getUserConfirmation = getConfirmation,
    keyLength = 6,
  } = props;
  // 添加头部/，移除尾部/
  const basename = props.basename
    ? stripTrailingSlash(addLeadingSlash(props.basename))
    : '';

  // 生成location
  function getDOMLocation(historyState) {
    const { key, state } = historyState || {};
    const { pathname, search, hash } = window.location;

    let path = pathname + search + hash;

    warning(
      !basename || hasBasename(path, basename),
      'You are attempting to use a basename on a page whose URL path does not begin ' +
        'with the basename. Expected path "' +
        path +
        '" to begin with "' +
        basename +
        '".'
    );

    // 如果提供了 basename, 那么 path 部分需要移除 basename 部分
    if (basename) path = stripBasename(path, basename);

    // location对象含有
    // pathname, search, hash, state, key等属性
    return createLocation(path, state, key);
  }

  function createKey() {
    return Math.random().toString(36).substr(2, keyLength);
  }

  const transitionManager = createTransitionManager();

  // 更新history state
  function setState(nextState) {
    Object.assign(history, nextState);
    history.length = globalHistory.length;
    // 通知订阅者
    transitionManager.notifyListeners(history.location, history.action);
  }

  // history PopStateEvent 事件回调
  function handlePopState(event) {
    // Ignore extraneous popstate events in WebKit.
    if (isExtraneousPopstateEvent(event)) return;
    handlePop(getDOMLocation(event.state));
  }

  // hash值变化
  function handleHashChange() {
    // hash场景，没有event.state事件对象，因此使用window.history.state主动获取
    handlePop(getDOMLocation(getHistoryState()));
  }

  let forceNextPop = false;

  // 回调函数处理核心
  // 出栈
  function handlePop(location) {
    if (forceNextPop) {
      forceNextPop = false;
      setState();
    } else {
      const action = 'POP';

      transitionManager.confirmTransitionTo(
        location,
        action,
        getUserConfirmation,
        (ok) => {
          if (ok) {
            setState({ action, location });
          } else {
            revertPop(location);
          }
        }
      );
    }
  }

  // 重置操作
  function revertPop(fromLocation) {
    const toLocation = history.location;

    // TODO: We could probably make this more reliable by
    // keeping a list of keys we've seen in sessionStorage.
    // Instead, we just default to 0 for keys we don't know.

    let toIndex = allKeys.indexOf(toLocation.key);

    if (toIndex === -1) toIndex = 0;

    let fromIndex = allKeys.indexOf(fromLocation.key);

    if (fromIndex === -1) fromIndex = 0;

    const delta = toIndex - fromIndex;

    if (delta) {
      forceNextPop = true;
      go(delta);
    }
  }

  const initialLocation = getDOMLocation(getHistoryState());
  let allKeys = [initialLocation.key];

  // Public interface

  function createHref(location) {
    return basename + createPath(location);
  }

  // 入栈
  function push(path, state) {
    warning(
      !(
        typeof path === 'object' &&
        path.state !== undefined &&
        state !== undefined
      ),
      'You should avoid providing a 2nd state argument to push when the 1st ' +
        'argument is a location-like object that already has state; it is ignored'
    );

    const action = 'PUSH';
    // 需要createKey()生成唯一的KEY
    const location = createLocation(path, state, createKey(), history.location);

    transitionManager.confirmTransitionTo(
      location,
      action,
      getUserConfirmation,
      (ok) => {
        if (!ok) return;

        const href = createHref(location);
        const { key, state } = location;

        // 能使用history api
        // 不能使用history api采用强制刷新兜底
        if (canUseHistory) {
          globalHistory.pushState({ key, state }, null, href);

          // 强制刷新
          if (forceRefresh) {
            /** 跳转，新增历史访问记录 */
            window.location.href = href;
          } else {
            const prevIndex = allKeys.indexOf(history.location.key);
            const nextKeys = allKeys.slice(0, prevIndex + 1);

            nextKeys.push(location.key);
            allKeys = nextKeys;

            // 调用 pushState 不会触发 state change 事件
            setState({ action, location });
          }
        } else {
          warning(
            state === undefined,
            'Browser history cannot push state in browsers that do not support HTML5 history'
          );

          window.location.href = href;
        }
      }
    );
  }

  // 替换
  function replace(path, state) {
    warning(
      !(
        typeof path === 'object' &&
        path.state !== undefined &&
        state !== undefined
      ),
      'You should avoid providing a 2nd state argument to replace when the 1st ' +
        'argument is a location-like object that already has state; it is ignored'
    );

    const action = 'REPLACE';
    const location = createLocation(path, state, createKey(), history.location);

    transitionManager.confirmTransitionTo(
      location,
      action,
      getUserConfirmation,
      (ok) => {
        if (!ok) return;

        const href = createHref(location);
        const { key, state } = location;

        if (canUseHistory) {
          globalHistory.replaceState({ key, state }, null, href);

          if (forceRefresh) {
            window.location.replace(href);
          } else {
            const prevIndex = allKeys.indexOf(history.location.key);

            if (prevIndex !== -1) allKeys[prevIndex] = location.key;

            setState({ action, location });
          }
        } else {
          warning(
            state === undefined,
            'Browser history cannot replace state in browsers that do not support HTML5 history'
          );

          window.location.replace(href);
        }
      }
    );
  }

  function go(n) {
    globalHistory.go(n);
  }

  function goBack() {
    go(-1);
  }

  function goForward() {
    go(1);
  }

  let listenerCount = 0;

  function checkDOMListeners(delta) {
    listenerCount += delta;

    if (listenerCount === 1 && delta === 1) {
      window.addEventListener(PopStateEvent, handlePopState);

      if (needsHashChangeListener)
        window.addEventListener(HashChangeEvent, handleHashChange);
    } else if (listenerCount === 0) {
      window.removeEventListener(PopStateEvent, handlePopState);

      if (needsHashChangeListener)
        window.removeEventListener(HashChangeEvent, handleHashChange);
    }
  }

  let isBlocked = false;

  function block(prompt = false) {
    const unblock = transitionManager.setPrompt(prompt);

    if (!isBlocked) {
      checkDOMListeners(1);
      isBlocked = true;
    }

    return () => {
      if (isBlocked) {
        isBlocked = false;
        checkDOMListeners(-1);
      }

      return unblock();
    };
  }

  function listen(listener) {
    // 添加监听者
    // 这里的listen供react-router-dom中的Router组件使用
    // Router组件监听浏览器路由变化，并将变化的数据通过React.Context方式传递
    // 至子组件，组件通过match本身定义的path和listen传入的location
    // 只要规则匹配，则渲染相应的组件
    const unlisten = transitionManager.appendListener(listener);
    checkDOMListeners(1);

    return () => {
      checkDOMListeners(-1);
      unlisten();
    };
  }

  const history = {
    length: globalHistory.length,
    action: 'POP',
    location: initialLocation,
    createHref,
    push,
    replace,
    go,
    goBack,
    goForward,
    block,
    listen,
  };

  return history;
}

export default createBrowserHistory;
