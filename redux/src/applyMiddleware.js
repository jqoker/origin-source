import compose from './compose'

/**
 * Creates a store enhancer that applies middleware to the dispatch method
 * of the Redux store. This is handy for a variety of tasks, such as expressing
 * asynchronous actions in a concise manner, or logging every action payload.
 *
 * See `redux-thunk` package as an example of the Redux middleware.
 *
 * Because middleware is potentially asynchronous, this should be the first
 * store enhancer in the composition chain.
 *
 * Note that each middleware will be given the `dispatch` and `getState` functions
 * as named arguments.
 *
 * @param {...Function} middlewares The middleware chain to be applied.
 * @returns {Function} A store enhancer applying the middleware.
 */
export default function applyMiddleware(...middlewares) {
  // 传入 createStore 方法
  return (createStore) => (...args) => {
    // 这里的store为原始的store
    const store = createStore(...args)
    let dispatch = () => {
      throw new Error(
        'Dispatching while constructing your middleware is not allowed. ' +
          'Other middleware would not be applied to this dispatch.'
      )
    }

    const middlewareAPI = {
      getState: store.getState,
      // 闭包原因是每个 dispatch 具有干净的作用域？
      dispatch: (...args) => dispatch(...args),
    }

    // 每个middleware接受getState, dispatch入参
    const chain = middlewares.map((middleware) => middleware(middlewareAPI))

    // middleware signature
    // const logMiddleware = ({ getState, dispatch }) => next => action => ()

    // 传入原始store.dispatch作为起点
    dispatch = compose(...chain)(store.dispatch)

    // 返回一个增强型的store
    // 主要是增强dispatch
    return {
      ...store,
      dispatch,
    }
  }
}
