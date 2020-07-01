/* Copyright Joyent, Inc. and other Node contributors. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/**
 * 初始化事件循环，可以把loop当初一个全局变量，有很多属性
 * 比如任务队列，各种handles
 */

#include "uv.h"
#include "uv/tree.h"
#include "internal.h"
#include "heap-inl.h"
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// 主循环初始化
int uv_loop_init(uv_loop_t *loop)
{
  void *saved_data;
  int err;

  saved_data = loop->data;
  // 分配内存
  memset(loop, 0, sizeof(*loop));
  loop->data = saved_data;

  // 堆实现优先队列，定时器试使用堆方式实现(最小堆)
  heap_init((struct heap *)&loop->timer_heap);
  // 初始化队列
  // work queue，文件操作、getAddrInfo、getNameInfo、用户任务通过线程池运行完毕后均添加到loop->wq队列中
  QUEUE_INIT(&loop->wq);
  QUEUE_INIT(&loop->idle_handles);
  // 异步IO
  QUEUE_INIT(&loop->async_handles);
  QUEUE_INIT(&loop->check_handles);
  QUEUE_INIT(&loop->prepare_handles);
  // 上面的所有初始化的 handle 均会放到该队列中
  QUEUE_INIT(&loop->handle_queue);

  // 活动的 handle 数量
  loop->active_handles = 0;
  // 活动的请求数量
  loop->active_reqs.count = 0;
  // 总的 fd 数量
  loop->nfds = 0;
  // 观察者
  loop->watchers = NULL;
  // 观察者数量
  loop->nwatchers = 0;
  // pending 事件队列
  QUEUE_INIT(&loop->pending_queue);
  // 观察者队列
  QUEUE_INIT(&loop->watcher_queue);

  // 关闭的 handle 队列，单向链表
  loop->closing_handles = NULL;
  // 更新时间
  uv__update_time(loop);

  // io 观察者，用于唤醒 loop，初始值为 -1
  loop->async_io_watcher.fd = -1;
  // 用于写数据给 async_wfd，用于线程池与 loop 通信
  loop->async_wfd = -1;
  // signal 相关
  loop->signal_pipefd[0] = -1;
  loop->signal_pipefd[1] = -1;
  // epoll_create()
  loop->backend_fd = -1;
  // emfile 错误，系统 fd 数量被耗光 (过分压榨系统资源导致，需要加过载保护)
  loop->emfile_fd = -1;

  // 定时器计数器
  loop->timer_counter = 0;
  // loop 停止标志
  loop->stop_flag = 0;

  // 平台特定初始化：UV_LOOP_PRIVATE_FIELDS
  err = uv__platform_loop_init(loop);
  if (err)
    return err;

  // 初始化进程信号 uv_signal_t
  uv__signal_global_once_init();
  // 初始化子进程信号观察者
  err = uv_signal_init(loop, &loop->child_watcher);
  if (err)
    goto fail_signal_init;

  // 解引用 loop->child_watcher
  // 排除 child_watcher 影响 loop 存活状态
  uv__handle_unref(&loop->child_watcher);
  loop->child_watcher.flags |= UV_HANDLE_INTERNAL;

  // 初始化子进程 handle 队列
  QUEUE_INIT(&loop->process_handles);

  // 读写锁
  err = uv_rwlock_init(&loop->cloexec_lock);
  if (err)
    goto fail_rwlock_init;

  // 互斥锁
  err = uv_mutex_init(&loop->wq_mutex);
  if (err)
    goto fail_mutex_init;

  // 线程池任务完成后 通知主线程处理
  // 这里注册了一个 IO 观察者，epoll_wait 通过观察用于线程间通信的fd状态
  // 当 fd 状态发生有效变化时，epoll_wait 不在阻塞，从而 IO 观察者内部的回调得到执行
  // loop->wq_async 为 handle，用于接收处理线程池任务完成信号并执行设定回调
  err = uv_async_init(loop, &loop->wq_async, uv__work_done);
  if (err)
    goto fail_async_init;

  // 排除uv_async_t影响loop存活状态
  uv__handle_unref(&loop->wq_async);
  loop->wq_async.flags |= UV_HANDLE_INTERNAL;

  return 0;

fail_async_init:
  uv_mutex_destroy(&loop->wq_mutex);

fail_mutex_init:
  uv_rwlock_destroy(&loop->cloexec_lock);

fail_rwlock_init:
  uv__signal_loop_cleanup(loop);

fail_signal_init:
  uv__platform_loop_delete(loop);

  return err;
}

int uv_loop_fork(uv_loop_t *loop)
{
  int err;
  unsigned int i;
  uv__io_t *w;

  err = uv__io_fork(loop);
  if (err)
    return err;

  err = uv__async_fork(loop);
  if (err)
    return err;

  err = uv__signal_loop_fork(loop);
  if (err)
    return err;

  /* Rearm all the watchers that aren't re-queued by the above. */
  for (i = 0; i < loop->nwatchers; i++)
  {
    w = loop->watchers[i];
    if (w == NULL)
      continue;

    if (w->pevents != 0 && QUEUE_EMPTY(&w->watcher_queue))
    {
      w->events = 0; /* Force re-registration in uv__io_poll. */
      QUEUE_INSERT_TAIL(&loop->watcher_queue, &w->watcher_queue);
    }
  }

  return 0;
}

void uv__loop_close(uv_loop_t *loop)
{
  uv__signal_loop_cleanup(loop);
  uv__platform_loop_delete(loop);
  uv__async_stop(loop);

  if (loop->emfile_fd != -1)
  {
    uv__close(loop->emfile_fd);
    loop->emfile_fd = -1;
  }

  if (loop->backend_fd != -1)
  {
    uv__close(loop->backend_fd);
    loop->backend_fd = -1;
  }

  uv_mutex_lock(&loop->wq_mutex);
  assert(QUEUE_EMPTY(&loop->wq) && "thread pool work queue not empty!");
  assert(!uv__has_active_reqs(loop));
  uv_mutex_unlock(&loop->wq_mutex);
  uv_mutex_destroy(&loop->wq_mutex);

  /*
   * Note that all thread pool stuff is finished at this point and
   * it is safe to just destroy rw lock
   */
  uv_rwlock_destroy(&loop->cloexec_lock);

#if 0
  assert(QUEUE_EMPTY(&loop->pending_queue));
  assert(QUEUE_EMPTY(&loop->watcher_queue));
  assert(loop->nfds == 0);
#endif

  uv__free(loop->watchers);
  loop->watchers = NULL;
  loop->nwatchers = 0;
}

int uv__loop_configure(uv_loop_t *loop, uv_loop_option option, va_list ap)
{
  if (option != UV_LOOP_BLOCK_SIGNAL)
    return UV_ENOSYS;

  if (va_arg(ap, int) != SIGPROF)
    return UV_EINVAL;

  loop->flags |= UV_LOOP_BLOCK_SIGPROF;
  return 0;
}
