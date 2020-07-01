// 创建虚拟文本节点
const createTextElement = (value) => {
  return createElement('TEXT ELEMENT', { nodeValue: value });
};

// 创建虚拟节点element
// 虚拟对象为object
// 数据结构
// {
//   type
//   props: {
//     ...,
//     children: [
//       {
//         type,
//         ...
//         children: [...]
//       },
//       ...
//     ]
//   }
// }
const createElement = (type, config, ...args) => {
  const props = Object.assign({}, config);
  // 创建子节点children
  const hasChildren = args.length > 0;
  const rawChildren = hasChildren ? [].concat(...args) : [];
  props.children = rawChildren
    .filter(c => c != null && c !== false)
    .map(c => c instanceof Object ? c : createTextElement(c));
  return {
    type,
    props,
  };
};

export default createElement;
