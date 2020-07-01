//     (c) 2010-2016 Thomas Fuchs
//     Zepto.js may be freely distributed under the MIT license.

;
(function($) {
  var jsonpID = +new Date(),
    document = window.document,
    key,
    name,
    rscript = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    scriptTypeRE = /^(?:text|application)\/javascript/i,
    xmlTypeRE = /^(?:text|application)\/xml/i,
    jsonType = 'application/json',
    htmlType = 'text/html',
    blankRE = /^\s*$/,
    originAnchor = document.createElement('a')

  originAnchor.href = window.location.href

  // trigger a custom event and return false if it was cancelled
  function triggerAndReturn(context, eventName, data) {
    var event = $.Event(eventName)
    $(context).trigger(event, data)
    return !event.isDefaultPrevented()
  }

  // trigger an Ajax "global" event
  function triggerGlobal(settings, context, eventName, data) {
    if (settings.global) return triggerAndReturn(context || document, eventName, data)
  }

  // Number of active Ajax requests
  $.active = 0

  function ajaxStart(settings) {
    if (settings.global && $.active++ === 0) triggerGlobal(settings, null, 'ajaxStart')
  }

  function ajaxStop(settings) {
    if (settings.global && !(--$.active)) triggerGlobal(settings, null, 'ajaxStop')
  }

  // triggers an extra global event "ajaxBeforeSend" that's like "ajaxSend" but cancelable
  function ajaxBeforeSend(xhr, settings) {
    var context = settings.context
    if (settings.beforeSend.call(context, xhr, settings) === false ||
      triggerGlobal(settings, context, 'ajaxBeforeSend', [xhr, settings]) === false)
      return false

    triggerGlobal(settings, context, 'ajaxSend', [xhr, settings])
  }

  //请求成功
  function ajaxSuccess(data, xhr, settings, deferred) {
    var context = settings.context,
      status = 'success'
    settings.success.call(context, data, status, xhr)
    if (deferred) deferred.resolveWith(context, [data, status, xhr])
    triggerGlobal(settings, context, 'ajaxSuccess', [xhr, settings, data])
    ajaxComplete(status, xhr, settings)
  }
  //请求失败
  // type: "timeout", "error", "abort", "parsererror"
  function ajaxError(error, type, xhr, settings, deferred) {
    var context = settings.context
    settings.error.call(context, xhr, type, error)
    if (deferred) deferred.rejectWith(context, [xhr, type, error])
    triggerGlobal(settings, context, 'ajaxError', [xhr, settings, error || type])
    ajaxComplete(type, xhr, settings)
  }
  //不论成功与否，均会执行
  // status: "success", "notmodified", "error", "timeout", "abort", "parsererror"
  function ajaxComplete(status, xhr, settings) {
    var context = settings.context
    settings.complete.call(context, xhr, status)
    triggerGlobal(settings, context, 'ajaxComplete', [xhr, settings])
    ajaxStop(settings)
  }

  //数据过滤
  function ajaxDataFilter(data, type, settings) {
    if (settings.dataFilter == empty) return data
    var context = settings.context
    return settings.dataFilter.call(context, data, type)
  }

  // Empty function, used as default callback
  function empty() {}

  //jsonp方案，使用script标签
  $.ajaxJSONP = function(options, deferred) {
    if (!('type' in options)) return $.ajax(options)

    //全局回调名称
    var _callbackName = options.jsonpCallback,
      callbackName = ($.isFunction(_callbackName) ?
        _callbackName() : _callbackName) || ('Zepto' + (jsonpID++)),
      //创建script标签
      script = document.createElement('script'),
      //回调
      originalCallback = window[callbackName],
      //响应数据
      responseData,

      //中断函数
      abort = function(errorType) {
        $(script).triggerHandler('error', errorType || 'abort')
      },
      xhr = {
        abort: abort
      },
      //中断
      abortTimeout

    if (deferred) deferred.promise(xhr)

    //script绑定load,error事件
    $(script).on('load error', function(e, errorType) {
      //如果在超时之前完成请求，则清除超时定时器
      //否则仍会触发
      clearTimeout(abortTimeout)

      //删除标签，并删除事件，避免重复绑定（一个页面多次请求）
      $(script).off().remove()

      //成功与否判断
      if (e.type == 'error' || !responseData) {
        ajaxError(null, errorType || 'error', xhr, options, deferred)
      } else {
        ajaxSuccess(responseData[0], xhr, options, deferred)
      }
      //设置回调
      window[callbackName] = originalCallback
      if (responseData && $.isFunction(originalCallback))
        originalCallback(responseData[0])

      //释放内存
      originalCallback = responseData = undefined
    })

    if (ajaxBeforeSend(xhr, options) === false) {
      abort('abort')
      return xhr
    }

    //资源加载后，执行设定的全局函数
    window[callbackName] = function() {
      responseData = arguments
    }

    //指定script目标源
    script.src = options.url.replace(/\?(.+)=\?/, '?$1=' + callbackName)
    document.head.appendChild(script)

    if (options.timeout > 0) abortTimeout = setTimeout(function() {
      abort('timeout')
    }, options.timeout)

    return xhr
  }

  $.ajaxSettings = {
    // Default type of request
    type: 'GET',
    // Callback that is executed before request
    beforeSend: empty,
    // Callback that is executed if the request succeeds
    success: empty,
    // Callback that is executed the the server drops error
    error: empty,
    // Callback that is executed on request complete (both: error and success)
    complete: empty,
    // The context for the callbacks
    context: null,
    // Whether to trigger "global" Ajax events
    global: true,
    // Transport
    xhr: function() {
      return new window.XMLHttpRequest()
    },
    // MIME types mapping
    // IIS returns Javascript as "application/x-javascript"
    accepts: {
      script: 'text/javascript, application/javascript, application/x-javascript',
      json: jsonType,
      xml: 'application/xml, text/xml',
      html: htmlType,
      text: 'text/plain'
    },
    // Whether the request is to another domain
    crossDomain: false,
    // Default timeout
    timeout: 0,
    // Whether data should be serialized to string
    processData: true,
    // Whether the browser should be allowed to cache GET responses
    cache: true,
    //Used to handle the raw response data of XMLHttpRequest.
    //This is a pre-filtering function to sanitize the response.
    //The sanitized response should be returned
    dataFilter: empty
  }

  function mimeToDataType(mime) {
    if (mime) mime = mime.split(';', 2)[0]
    return mime && (mime == htmlType ? 'html' :
      mime == jsonType ? 'json' :
      scriptTypeRE.test(mime) ? 'script' :
      xmlTypeRE.test(mime) && 'xml') || 'text'
  }

  function appendQuery(url, query) {
    if (query == '') return url
    return (url + '&' + query).replace(/[&?]{1,2}/, '?')
  }

  // serialize payload and append it to the URL for GET requests
  function serializeData(options) {
    if (options.processData && options.data && $.type(options.data) != "string")
      options.data = $.param(options.data, options.traditional)
    //如果为get请求（默认为get请求），那么需要将序列化后的数据添加到URL后面
    if (options.data && (!options.type || options.type.toUpperCase() == 'GET' || 'jsonp' == options.dataType))
      options.url = appendQuery(options.url, options.data), options.data = undefined
  }

  //ajax方法
  $.ajax = function(options) {
    var settings = $.extend({}, options || {}),
      deferred = $.Deferred && $.Deferred(),
      urlAnchor, hashIndex

    //拷贝配置项，只从默认配置项中拷贝当前没有的配置项（undefined）
    for (key in $.ajaxSettings)
      if (settings[key] === undefined) settings[key] = $.ajaxSettings[key]

    //添加start事件
    ajaxStart(settings)

    //ajax方法
    //是否跨越，非跨域情况下，需要区分传统请求和异步请求
    if (!settings.crossDomain) {
      urlAnchor = document.createElement('a')
      urlAnchor.href = settings.url
      // cleans up URL for .href (IE only), see https://github.com/madrobby/zepto/pull/1049
      urlAnchor.href = urlAnchor.href
      //那么需要将序列化后的数据添加到URL后面
      settings.crossDomain = (originAnchor.protocol + '//' + originAnchor.host) !== (urlAnchor.protocol + '//' + urlAnchor.host)
    }

    //设置url并格式化url，去除hash部分
    if (!settings.url) settings.url = window.location.toString()
    if ((hashIndex = settings.url.indexOf('#')) > -1) settings.url = settings.url.slice(0, hashIndex)
    //序列化传给服务端的数据
    //settings.data部分数据
    serializeData(settings)

    //返回数据类
    headers = {},
      setHeader = function(name, value) {
        headers[name.toLowerCase()] = [name, value]
      },
      protocol = /^([\w-]+:)\/\//.test(settings.url) ? RegExp.$1 : window.location.protocol,
      xhr = settings.xhr(),

      //设置请求头函数
      nativeSetHeader = xhr.setRequestHeader,
      abortTimeout

    if (deferred) deferred.promise(xhr)

    //如果不跨越，设置头部，以区分传统同步请求和ajax异步请求
    if (!settings.crossDomain) setHeader('X-Requested-With', 'XMLHttpRequest')

    //设置浏览器能accept的mime类型
    setHeader('Accept', mime || '*/*')

    //如果配置选项中指定了mimeType,则覆写响应的mime类型
    if (mime = settings.mimeType || mime) {
      if (mime.indexOf(',') > -1) mime = mime.split(',', 2)[0]
      //level1 兼容性更好，level2中采用xhr.responseType
      xhr.overrideMimeType && xhr.overrideMimeType(mime)
    }
    //POST请求设置contentType
    //GET请求与contentType无关,其参数添加到URL上
    if (settings.contentType || (settings.contentType !== false && settings.data && settings.type.toUpperCase() != 'GET'))
      setHeader('Content-Type', settings.contentType || 'application/x-www-form-urlencoded')

    //设置请求头
    if (settings.headers)
      for (name in settings.headers) setHeader(name, settings.headers[name])


    //这里为什么要重新赋值?
    xhr.setRequestHeader = setHeader

    //监听state变化
    xhr.onreadystatechange = function() {
      //state = 4 时，表示结束
      if (xhr.readyState == 4) {
        xhr.onreadystatechange = empty
        clearTimeout(abortTimeout)
        var result, error = false
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status == 304 || (xhr.status == 0 && protocol == 'file:')) {
          dataType = dataType || mimeToDataType(settings.mimeType || xhr.getResponseHeader('content-type'))

          //根据不同的dataType读取数据
          if (xhr.responseType == 'arraybuffer' || xhr.responseType == 'blob')
            result = xhr.response
          else {
            result = xhr.responseText

            //解析数据
            try {
              // http://perfectionkills.com/global-eval-what-are-the-options/
              // sanitize response accordingly if data filter callback provided
              result = ajaxDataFilter(result, dataType, settings)
              if (dataType == 'script')(1, eval)(result)
              else if (dataType == 'xml') result = xhr.responseXML
              else if (dataType == 'json') result = blankRE.test(result) ? null : $.parseJSON(result)
            } catch (e) {
              error = e
            }

            //检测是否有错误
            if (error) return ajaxError(error, 'parsererror', xhr, settings, deferred)
          }
          //请求成功
          ajaxSuccess(result, xhr, settings, deferred)
        } else {
          //请求出错
          ajaxError(xhr.statusText || null, xhr.status ? 'error' : 'abort', xhr, settings, deferred)
        }
      }
    }

    //请求前的处理
    if (ajaxBeforeSend(xhr, settings) === false) {
      xhr.abort()
      ajaxError(null, 'abort', xhr, settings, deferred)
      return xhr
    }

    //异步标识设置
    var async = 'async' in settings ? settings.async : true
    //打开，此时仅建立了tcp链接
    xhr.open(settings.type, settings.url, async, settings.username, settings.password)

    //添加相关字段，比如withCredentials
    if (settings.xhrFields)
      for (name in settings.xhrFields) xhr[name] = settings.xhrFields[name]

    //设置头部,该方法必须在open,send方法之间调用才能生效
    for (name in headers) nativeSetHeader.apply(xhr, headers[name])

    //超时定时器
    if (settings.timeout > 0) abortTimeout = setTimeout(function() {
      xhr.onreadystatechange = empty
      xhr.abort()
      ajaxError(null, 'timeout', xhr, settings, deferred)
    }, settings.timeout)

    // avoid sending empty string (#319)
    // 发送，settings.data已经被序列化（serialize方法）
    xhr.send(settings.data ? settings.data : null)
    return xhr
  }

  // handle optional data/success arguments
  function parseArguments(url, data, success, dataType) {
    if ($.isFunction(data)) dataType = success, success = data, data = undefined
    if (!$.isFunction(success)) dataType = success, success = undefined
    return {
      url: url,
      data: data,
      success: success,
      dataType: dataType
    }
  }

  $.get = function( /* url, data, success, dataType */ ) {
    return $.ajax(parseArguments.apply(null, arguments))
  }

  $.post = function( /* url, data, success, dataType */ ) {
    var options = parseArguments.apply(null, arguments)
    options.type = 'POST'
    return $.ajax(options)
  }

  $.getJSON = function( /* url, data, success */ ) {
    var options = parseArguments.apply(null, arguments)
    options.dataType = 'json'
    return $.ajax(options)
  }

  $.fn.load = function(url, data, success) {
    if (!this.length) return this
    var self = this,
      parts = url.split(/\s/),
      selector,
      options = parseArguments(url, data, success),
      callback = options.success
    if (parts.length > 1) options.url = parts[0], selector = parts[1]
    options.success = function(response) {
      self.html(selector ?
        $('<div>').html(response.replace(rscript, "")).find(selector) :
        response)
      callback && callback.apply(self, arguments)
    }
    $.ajax(options)
    return this
  }

  var escape = encodeURIComponent

  //序列化数据
  function serialize(params, obj, traditional, scope) {
    var type, array = $.isArray(obj),
      hash = $.isPlainObject(obj)
    $.each(obj, function(key, value) {
      type = $.type(value)
      if (scope) key = traditional ? scope :
        scope + '[' + (hash || type == 'object' || type == 'array' ? key : '') + ']'
      // handle data in serializeArray() format
      if (!scope && array) params.add(value.name, value.value)
      // recurse into nested objects
      else if (type == "array" || (!traditional && type == "object"))
        serialize(params, value, traditional, key)
      else params.add(key, value)
    })
  }
  // var o = {
  // p1: 'test1',
  // p2: {
  // nested: 'test2'
  // }
  // };
  //p1=test1&p2['nested']=test2

  //参数序列化
  $.param = function(obj, traditional) {
    var params = []
    params.add = function(key, value) {
      if ($.isFunction(value)) value = value()
      if (value == null) value = ""
      this.push(escape(key) + '=' + escape(value))
    }
    serialize(params, obj, traditional)
    return params.join('&').replace(/%20/g, '+')
  }
})(Zepto)
