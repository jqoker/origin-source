// 创建component实例
// 使用构造函数创建
const createPublicInstances = (element, internalInstance) => {
  // 类型type
  const { type, props } = element;
  // 构造函数
  const publicInstance = new type(props); // 创建实例

  // internalInstance内容包括
  // { dom, element, childInstance, publicInstance }
  publicInstance.__internalInstance = internalInstance; // 绑定内部实例对象(用于追踪)
  return publicInstance;
};

// 属性更新
const updateDomProperties = (dom, prevProps, nextProps) => {
  const isEvent = name => name.startsWith('on');
  const isAttribute = name => !isEvent(name) && name !== 'children';

  // 事件
  Object.keys(prevProps).filter(isEvent).forEach(name => {
    const eventType = name.toLowerCase().substring(2);
    dom.removeEventListener(eventType, prevProps[name]);
  });
  Object.keys(prevProps).filter(isAttribute).forEach(name => {
    dom[name] = null;
  });

  // 其他属性
  Object.keys(nextProps).filter(isEvent).forEach(name => {
    const eventType = name.toLowerCase().substring(2);
    dom.addEventListener(eventType, nextProps[name]);
  });
  Object.keys(nextProps).filter(isAttribute).forEach(name => {
    dom[name] = nextProps[name];
  });
};

// 实例化(根据element创建dom)
const instantiate = (element) => {
  const { type, props } = element;
  const isDomElement = typeof type === 'string';
  if (isDomElement) {
    // 普通标签组件
    const isTextElement = type === 'TEXT ELEMENT';
    // 根节点
    const dom = isTextElement ? document.createTextNode(props.nodeValue)
      :document.createElement(type);
    updateDomProperties(dom, [], props);
    const childElements = props.children || [];
    // 子节点实例
    const childInstances = childElements.map(instantiate);  // 子节点变量
    const childDoms = childInstances.map(instance => instance.dom);
    // 依次将child dom追加至dom跟节点
    childDoms.forEach(childDom => dom.appendChild(childDom));
    // element, dom, childInstances
    return { element, dom, childInstances }; // 对于普通标签组件可以有多个子节点
  } else {
    // Component组件
    // instance为引用数据，其最终的值为
    // Object.assign(instance, { dom, element, childInstance, publicInstance });
    const instance = {};
    // 组件实例，对外暴露
    const publicInstance = createPublicInstances(element, instance);
    // 组件render是element生成器
    const childElement = publicInstance.render();
    // 组件render只能有一个子节点element
    const childInstance = instantiate(childElement);
    // dom节点
    const dom = childInstance.dom;
    // 对于component组件只能有一个子节点
    // 当前实例包含dom, element, childInstance, publicInstance实例
    Object.assign(instance, { dom, element, childInstance, publicInstance });
    // 实例
    return instance;
  }
};

// diff
// parentDom 父节点
// instance 当前节点实例(包含dom, childInstances, element)
// 新的element(虚拟节点)
// 
// instance为当前实例，element为有setState触发生成的新element
const reconcile = (parentDom, instance, element) => {
  /**
   * 初始化操作
   */
  // 当前节点为空，新增，初始化渲染时instance=null
  if (instance == null) {
    // 初始化阶段，实例化element，构建dom树
    const newInstance = instantiate(element);
    // 父节点挂载当前dom根节点
    parentDom.appendChild(newInstance.dom);
    return newInstance;

    /**
     * 更新操作
     */
  } else if(element == null) {
    // 虚拟节点不存在，删除相应dom节点
    parentDom.removeChild(instance.dom);
    return null;
  } else if (typeof element.type === 'string') {
    // 更新常规dom节点
    updateDomProperties(instance.dom, instance.element.props, element.props);
    // 更新子dom节点
    instance.childInstances = reconcileChildren(instance, element);
    // 更新instance绑定的element
    instance.element = element;
    return instance;
  } else if(instance.element.type !== element.type) {
    // 节点替换，当前节点类型和新节点类型不一致，更新
    // 既然节点类型不一致，干脆直接重建
    const newInstance = instantiate(element);
    parentDom.replaceChild(newInstance.dom, instance.dom);
    return newInstance;
  } else {
    // 组件
    // render方法需要使用props信息，因此事先重新设置新的props
    instance.publicInstance.props = element.props;
    // 执行render生成新的element
    const childElement = instance.publicInstance.render();
    const oldChildInstance = instance.childInstance;
    // oldChildInstance之前的instance
    // childElement 新的element
    const childInstance = reconcile(parentDom, oldChildInstance, childElement);
    // 更新
    instance.dom = childInstance.dom;
    instance.childInstance = childInstance;
    instance.element = element;
    return instance;
  }
};

/// 子节点diff
/// 对应普通html dom而已，会存在多个child dom节点
/// 需要遍历diff处理
const reconcileChildren = (instance, element) => {
  const dom = instance.dom;
  const childInstances = instance.childInstances;
  const nextChildElements = element.props.children;
  const newChildInstances = [];
  // 此处必须为max，涵盖全部元素
  const count = Math.max(childInstances.length, nextChildElements.length);
  for (let i = 0; i < count; i++) {
    const childInstance = childInstances[i];
    const childElement = nextChildElements[i];
    const newChildInstance = reconcile(dom, childInstance, childElement);
    // 生成新的instance
    newChildInstances.push(newChildInstance);
  }

  // 移除空instance
  return newChildInstances.filter(instance => instance != null);
};

export default reconcile;
