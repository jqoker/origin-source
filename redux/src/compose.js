/**
 * Composes single-argument functions from right to left. The rightmost
 * function can take multiple arguments as it provides the signature for
 * the resulting composite function.
 *
 * @param {...Function} funcs The functions to compose.
 * @returns {Function} A function obtained by composing the argument functions
 * from right to left. For example, compose(f, g, h) is identical to doing
 * (...args) => f(g(h(...args))).
 */

export default function compose(...funcs) {
  // 透传
  if (funcs.length === 0) {
    return arg => arg
  }

  if (funcs.length === 1) {
    return funcs[0]
  }

  // 将后面的函数执行结果作为外层函数的入参
  // 内聚，解耦
  //
  // a中的dispatch是b增强过后的dispatch
  // 以此类推
  return funcs.reduce((a, b) => (...args) => a(b(...args)))
}


const middlewares = [m1, m2, m3]

a = m1(m2(...args))

a = m1(m2(m3(...args)))


const loggerMiddleware = store => next => action => {
  console.log('loggerMiddleware', action);
  next(action);
  // 这个是利用函数调用出栈实现的
  console.log('loggerMiddleware::after', action);
};

const lxMiddleware = store => next => action => {
  console.log('lxMiddleware', action);
  return next(action);
};
