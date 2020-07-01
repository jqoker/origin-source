import reconcile from './diff.js';

// 更新组件
// dom更新操作
// appendChild, removeChild, replaceChild均需要parentNode
const updateInstance = (internalInstance) => {
  // 找到父节点
  const parentDom = internalInstance.dom.parentNode;
  const element = internalInstance.element;
  // diff操作
  // parentDom为当前实例的父节点，限制修改范围
  // 当前组件实例，调用当前组件实例的render方法生成element
  // 生成的element与之前的element对比，找出差异，并更新
  reconcile(parentDom, internalInstance, element);
}

// internalInstance为Component实例
// 包含属性 dom，element
export default class Component {
  constructor(props) {
    this.props = props;
    this.state = this.state || {};
  }
  // 触发更新
  // 在updateInstance中并不关心state，只关心新state下的element
  // diff算法对比的也仅是不同状态下的element
  setState(partialState) {
    this.state = Object.assign({}, this.state, partialState);
    updateInstance(this.__internalInstance);
  }
}
