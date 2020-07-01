// 默认比较函数，简单检查引用是否相等
function defaultEqualityCheck(a, b) {
  return a === b
}

// 函数参数浅比较是否相等
// equalityCheck比较函数
// prev，next分别为需要比较的函数参数
function areArgumentsShallowlyEqual(equalityCheck, prev, next) {
  if (prev === null || next === null || prev.length !== next.length) {
    return false
  }

  // Do this in a for loop (and not a `forEach` or an `every`) so we can determine equality as fast as possible.
  const length = prev.length
  for (let i = 0; i < length; i++) {
    if (!equalityCheck(prev[i], next[i])) {
      return false
    }
  }

  return true
}

// 默认记忆函数，用于缓存.此处函数提供默认实现
// 此处体现闭包的用处之一，缓存数据
export function defaultMemoize(func, equalityCheck = defaultEqualityCheck) {
  // 上次参数
  let lastArgs = null
  // 上次结果
  let lastResult = null
  // we reference arguments instead of spreading them for performance reasons

  // 注意这里的arguments使用，在reselect库中
  // arguments指的是react-redux库中的mapStateToProps函数入参
  // 并且所有selector入参均和mapStateToProps入参一致
  return function () {
    // 此次参数和上一次参数比较是否相等
    if (!areArgumentsShallowlyEqual(equalityCheck, lastArgs, arguments)) {
      // apply arguments instead of spreading for performance.
      // 参数不相等则重新运行func计算结果
      lastResult = func.apply(null, arguments)
    }

    // 更新lastArgs
    lastArgs = arguments

    // 返回结果
    return lastResult
  }
}

// 获取依赖项
// 函数签名createSelector(funcs, transformFunc)
// 支持两种入参格式：[func1, func2, func3, ...] or func1,func2,func3, ...
function getDependencies(funcs) {
  // 参数为数组
  const dependencies = Array.isArray(funcs[0]) ? funcs[0] : funcs

  // 参数检查，必须均为函数
  if (!dependencies.every(dep => typeof dep === 'function')) {
    const dependencyTypes = dependencies.map(
      dep => typeof dep
    ).join(', ')
    throw new Error(
      'Selector creators expect all input-selectors to be functions, ' +
      `instead received the following types: [${dependencyTypes}]`
    )
  }

  return dependencies
}

export function createSelectorCreator(memoize, ...memoizeOptions) {
  return (...funcs) => {
    // 统计计算次数
    let recomputations = 0
    // 取出转换函数，最后一个函数为转换函数输出
    const resultFunc = funcs.pop()

    // 获取其他依赖项，依赖项必须为函数形式
    const dependencies = getDependencies(funcs)

    const memoizedResultFunc = memoize(
      // 转换函数
      function () {
        recomputations++
        // apply arguments instead of spreading for performance.
        return resultFunc.apply(null, arguments)
      },
      // 配置项，比如相等判断函数，记忆函数等
      ...memoizeOptions
    )

    // If a selector is called with the exact same arguments we don't need to traverse our dependencies again.
    const selector = memoize(function () {

      // 执行每个dep函数，拿到执行结果
      const params = []
      const length = dependencies.length

      for (let i = 0; i < length; i++) {
        // apply arguments instead of spreading and mutate a local list of params for performance.
        // 这里的arguments为selector执行时的入参
        // 指下面的state, props参数
        /**
          * const mapStateToProps = (state, props) => ({
             total: totalSelector(state, props)
           })
         */
        // 通过state, props计算每个dep的值
        params.push(dependencies[i].apply(null, arguments))
      }

      // params为使用state, props计算得出的结果

      // apply arguments instead of spreading for performance.
      // 将执行结果传递给memoizedResultFunc函数
      return memoizedResultFunc.apply(null, params)
    })

    /**
     * for instance
      const abSelector = (state, props) => state.a * props.b
      const cSelector = (_, props) => props.c
      const dSelector = (state) => state.d
      const totalSelector = createSelector(
        /** deps */
        abSelector,
        cSelector,
        dSelector,

        /** resultFunc */
        (ab, c, d) => ({
          total: ab + c + d
        })
      )

      const mapStateToProps = (state, props) => ({
        total: totalSelector(state, props)
      })
    */

    // memoizedResultFunc, selector一起构成两层缓存机制(两次使用memoize函数)
    // memoizedResultFunc这一层针对的是上面示例中的ab, c, d这等参数
    // selector这一层针对的是上面示例中的state, props这类参数

    selector.resultFunc = resultFunc
    selector.dependencies = dependencies
    selector.recomputations = () => recomputations
    selector.resetRecomputations = () => recomputations = 0
    return selector
  }
}

export const createSelector = createSelectorCreator(defaultMemoize)

export function createStructuredSelector(selectors, selectorCreator = createSelector) {
  if (typeof selectors !== 'object') {
    throw new Error(
      'createStructuredSelector expects first argument to be an object ' +
      `where each property is a selector, instead received a ${typeof selectors}`
    )
  }
  const objectKeys = Object.keys(selectors)
  return selectorCreator(
    objectKeys.map(key => selectors[key]),
    (...values) => {
      // 汇合
      return values.reduce((composition, value, index) => {
        composition[objectKeys[index]] = value
        return composition
      }, {})
    }
  )
}
