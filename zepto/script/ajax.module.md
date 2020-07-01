### jsonp实现（使用script标签实现）

1、解析全局函数名称
2、创建script标签
3、备份当前全局函数（该函数名和解析出来的全局函数名称一致），避免覆盖了用户定义的全局函数
4、给script标签绑定load,error事件。在事件回调函数中需要处理以下事情：
（a) 清除aborttimeout定时器，这是因为如果能进入回调函数中，那么意味着请求在超时时间之前完成了，这时候需要清除定时器，否则到了指定的时间左右仍会触发abort对应的定时器执行
（b）删除script标签，并取消其内绑定的事件，这样可以避免事件重复绑定的风险

（c）根据成功与否执行相应的回调函数（用户设置的success,error选项）
5、取出用户设定的全局函数（3中备份的函数），如果是个函数，这将获取到的数据作为入参传入执行
6、复写全局函数（函数名称为1中解析得到的函数名称），功能只为了获取到执行时的入参，jsonp方式返回的结果实则为函数执行代码

7、设置script的src属性，并添加至dom,head中

##### ***需要关注的点

**script标签绑定事件的处理方式（兼容性），参见on方法


### ajaxSetting
该对象主要涵盖了ajax基本配置项的默认值


### ajax函数

1、从ajaxSetting中拷贝配置项（仅拷贝没有的配置项）
2、添加ajaxStart事件
3、检测是否跨域(使用的方法是创建a标签,href属性分别赋值为设置的url和当前页面的href,比较protocol,host)
4、格式化url，如果url未指定，则使用location；同时去除hash（#）以后的部分
5、序列化settings(settings是个对象，需要将其转换成字符串形式)
6、检测配置项中dataType是否为jsonp（两种情况：显式指定为jsonp，另一种是通过检测settings.url是否含有?符号）

7、缓存设置（通过给settings.url追加时间参数来实现不缓存），不会缓存的情况有:手动设置settings.cache为false,另外一种为dataType为script或jsonp

8、如果dataType == ‘jsonp’,那么走jsonp流程，ajax函数后续流程不执行

9、如果8不执行，那么接下来走ajax流程

#### ajax流程

1、获取mime类型（告知浏览器如何处理响应）
这里的mime类型和dataType有关系，其映射关系为：
script ---> 'text/javascript, application/javascript'
json ---> 'application/json'
xml ---> 'application/xml, text/xml'
html ---> 'text/html'
text ---> 'text/plain'

2、设置请求头，获取协议，xhr对象
3、如果非跨越，设置请求头: 'X-Requested-With = XMLHttpRequest'，用于区分传统的同步请求和ajax异步请求（在服务端通过request.getHeader('X-Request-With') 是否为XMLHttpRequest判断）
可以参加:http://blog.csdn.net/lixld/article/details/52353276
4、
