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
 * 整体执行过程
 * 
 * 1. 通过uv_queue_work提交任务并绑定任务完成回调
 * 2. 如果是第一次提交任务，那么还会初始化线程池（默认大小为4），可以通过环境变量UV_THREADPOOL_SIZE调整（最大可为1024）
 * 3. 线程池初始完毕后，将待执行任务推入任务队列中（推入时判断区分任务类型（慢IO、快IO、CPU计算型任务）
 * 4. 如果是慢IO任务，将任务加入slow_io_pending_wq队列，并将run_slow_work_message加入wq（线程池从wq一次取出待执行任务，碰到run_slow_work_message，则表示为慢IO，从而转向slow_io_pending_wq取出IO执行）
 * 5. 执行完毕后，将执行完毕的任务放入loop->wq中，然后使用uv_async_send通知事件循环主线程
 * 6. 事件循环主线程收到通知后执行uv__work_done，意味着回调在主线程中执行，
 * 7. uv__work_done取出loop->wq中的任务，依次执行
 * 
 * 优化的点
 * 1. 线程空闲时睡眠，不占用CPU时间片
 * 2. 任务队列分为：慢任务队列、快任务队列；彼此分隔，避免慢任务占用过多线程
 * 
 */

#include "uv-common.h"

#if !defined(_WIN32)
#include "unix/internal.h"
#endif

#include <stdlib.h>

/**
 * 静态全局变量只能被本文件获取，存储在【全局数据区】
 * 内存分布情况：【代码区】、【全局数据区】、【堆区】、【栈区】
 * 
 * 【堆区】一般有 new 产生
 * 【栈区】函数内部自动变量，自动变量随着函数退出而释放
 * 【全局数据区】静态数据（函数内部的静态全局数据也算），不会因为函数退出而释放
 */

// 线程池容量
#define MAX_THREADPOOL_SIZE 1024

// 仅初始化一次
static uv_once_t once = UV_ONCE_INIT;
// 条件锁（唤醒线程）
static uv_cond_t cond;
// 互斥锁
static uv_mutex_t mutex;
// idle线程数
static unsigned int idle_threads;
// 正在运行的慢IO数量
static unsigned int slow_io_work_running;
// 总线程数
static unsigned int nthreads;
// 线程实例
static uv_thread_t *threads;
// 默认线程池，大小4
static uv_thread_t default_threads[4];
// 退出消息
static QUEUE exit_message;
// 任务队列
static QUEUE wq;
// 慢任务标识，慢任务队列“代表”
static QUEUE run_slow_work_message;
// 慢任务队列
static QUEUE slow_io_pending_wq;

// 允许的最大慢线程数
// 线程数一半，向上取整
static unsigned int slow_work_thread_threshold(void)
{
  return (nthreads + 1) / 2;
}

// 取消操作
static void uv__cancelled(struct uv__work *w)
{
  abort();
}

/* To avoid deadlock with uv_cancel() it's crucial that the worker
 * never holds the global mutex and the loop-local mutex at the same time.
 */
// worker线程执行处理的函数
// 启动后线程一直运行，通过信号量方式通知空闲进程处理
static void worker(void *arg)
{
  struct uv__work *w;
  QUEUE *q;
  int is_slow_work;

  uv_sem_post((uv_sem_t *)arg);
  arg = NULL;

  // 这里加锁保证 uv_cond_wait 操作的原子性，避免丢失信号，导致 uv_cond_wait 不背唤醒
  // 可以参考 https://zhuanlan.zhihu.com/p/55123862
  uv_mutex_lock(&mutex);
  // 一直运行
  for (;;)
  {
    /* `mutex` should always be locked at this point. */

    // 一直等
    /* Keep waiting while either no work is present or only slow I/O
       and we're at the threshold for that. */
    // 避免惊群效应
    // 1. 空队列
    // 2. 仅有慢IO并且慢IO数量超过总线程数量一半
    // 将IO操作分为快IO操作、慢IO操作，当慢IO操作数量超过总线程数量一半时，当前线程继续休眠(等待执行快IO或CPU任务)
    // 这样一来就能避免慢IO操作占用过多线程
    while (QUEUE_EMPTY(&wq) ||
           (QUEUE_HEAD(&wq) == &run_slow_work_message &&
            QUEUE_NEXT(&run_slow_work_message) == &wq &&
            slow_io_work_running >= slow_work_thread_threshold()))
    {
      // 空闲线程+1
      idle_threads += 1;
      // 线程运行至此，休眠（挂起）不消耗CPU周期
      // 被唤醒时从该行开始执行，然后再次判断 while 条件，如果满足条件就继续等
      uv_cond_wait(&cond, &mutex);
      idle_threads -= 1;
    }

    // 线程被唤醒
    // 取出任务
    q = QUEUE_HEAD(&wq);

    // 异常，直接退出
    if (q == &exit_message)
    {
      uv_cond_signal(&cond);
      uv_mutex_unlock(&mutex);
      break;
    }

    // 移除头结点
    QUEUE_REMOVE(q);
    QUEUE_INIT(q); /* Signal uv_cancel() that the work req is executing. */

    // 是否为慢IO任务
    is_slow_work = 0;

    // 标识有慢IO操作，run_slow_work_message用于标识有慢IO操作
    // 真正的慢IO队列在slow_io_pending_wq中
    if (q == &run_slow_work_message)
    {
      // 慢IO，重新编排
      // 如果运行慢IO的数量超过总线程数量的一半，那么加入待处理队列尾部，延迟执行(continue)
      // 避免慢 IO 拖垮整体能力
      /* If we're at the slow I/O threshold, re-schedule until after all
         other work in the queue is done. */
      if (slow_io_work_running >= slow_work_thread_threshold())
      {
        QUEUE_INSERT_TAIL(&wq, q);
        continue;
      }

      /* If we encountered a request to run slow I/O work but there is none
         to run, that means it's cancelled => Start over. */
      // 有run_slow_work_message(post方法提交慢IO任务时，会设置该慢IO任务标识) 但慢IO队列为空，则表示慢IO操作在提交后被取消了
      if (QUEUE_EMPTY(&slow_io_pending_wq))
        continue;

      // 开始执行慢IO
      // 标识为慢IO
      is_slow_work = 1;
      // 慢IO运行数量
      slow_io_work_running++;

      // 从慢IO队列取出一个任务
      q = QUEUE_HEAD(&slow_io_pending_wq);
      QUEUE_REMOVE(q);
      QUEUE_INIT(q);

      /* If there is more slow I/O work, schedule it to be run as well. */
      // 上面取出一个慢 IO 任务，倘若仍存在慢IO，那么将run_slow_work_message加入wq尾部，用于标识还有慢IO任务
      if (!QUEUE_EMPTY(&slow_io_pending_wq))
      {
        // 慢IO操作标识加入队列尾部
        QUEUE_INSERT_TAIL(&wq, &run_slow_work_message);
        if (idle_threads > 0)
          // 唤醒空闲线程
          uv_cond_signal(&cond);
      }
    }

    uv_mutex_unlock(&mutex);

    // 取出work执行
    w = QUEUE_DATA(q, struct uv__work, wq);
    // uv__queue_work
    // 这里是同步执行
    w->work(w);

    // 互斥锁，锁为 loop->wq_mutex，不是 mutex
    // 因为这里操作的是 loop->wq 队列，为线程共用资源
    uv_mutex_lock(&w->loop->wq_mutex);
    // 告知 uv_cancel 该任务已处理完毕
    w->work = NULL; /* Signal uv_cancel() that the work req is done
                        executing. */

    // worker线程执行好后，将worker加入主线程事件循环队列中等待执行
    // 这里加入loop-wq队列为完成的w->wq
    QUEUE_INSERT_TAIL(&w->loop->wq, &w->wq);
    // 通知主线程，async_handle通信
    uv_async_send(&w->loop->wq_async);
    // 互斥锁解锁
    uv_mutex_unlock(&w->loop->wq_mutex);

    /* Lock `mutex` since that is expected at the start of the next
     * iteration. */
    // 下一循环中先上锁
    uv_mutex_lock(&mutex);
    if (is_slow_work)
    {
      /* `slow_io_work_running` is protected by `mutex`. */
      // 慢 IO 数量减 1
      slow_io_work_running--;
    }
  }
}

// 将 worker 加入执行队列
static void post(QUEUE *q, enum uv__work_kind kind)
{
  // wq队列为线程池共享，因此需要加锁
  // 操作队列，加互斥锁
  // 没有获取到锁的线程，进入队列等待依次获取锁权限
  uv_mutex_lock(&mutex);
  // 缓慢IO
  if (kind == UV__WORK_SLOW_IO)
  {
    /* Insert into a separate queue. */
    // 插入缓慢IO队列尾部
    QUEUE_INSERT_TAIL(&slow_io_pending_wq, q);

    // 队列中已有run_slow_work_message，标识已有慢IO任务标识
    // 直接跳过即可
    if (!QUEUE_EMPTY(&run_slow_work_message))
    {
      /* Running slow I/O tasks is already scheduled => Nothing to do here.
         The worker that runs said other task will schedule this one as well. */
      uv_mutex_unlock(&mutex);
      return;
    }
    q = &run_slow_work_message;
  }

  // 任务入队列
  // 1. 如果非慢IO任务，则q为传入的任务
  // 2. 如果为慢IO任务，则q被重写为run_slow_work_message，并加入队列中
  QUEUE_INSERT_TAIL(&wq, q);
  // 关键点：有空闲线程，则唤醒
  if (idle_threads > 0)
    // 条件锁,唤醒线程工作
    uv_cond_signal(&cond);
  uv_mutex_unlock(&mutex);
}

#ifndef _WIN32
UV_DESTRUCTOR(static void cleanup(void))
{
  unsigned int i;

  if (nthreads == 0)
    return;

  // 线程退出信号
  post(&exit_message, UV__WORK_CPU);

  for (i = 0; i < nthreads; i++)
    if (uv_thread_join(threads + i))
      abort();

  if (threads != default_threads)
    uv__free(threads);

  uv_mutex_destroy(&mutex);
  uv_cond_destroy(&cond);

  threads = NULL;
  nthreads = 0;
}
#endif

// 初始化线程池，线程池默认大小为4
static void init_threads(void)
{
  unsigned int i;
  const char *val;
  uv_sem_t sem;

  nthreads = ARRAY_SIZE(default_threads);
  // 获取外部配置的线程池大小，最大可为1024个
  val = getenv("UV_THREADPOOL_SIZE");
  if (val != NULL)
    // 将字符串值转换为整数值，如果转换失败，则返回0
    nthreads = atoi(val);
  if (nthreads == 0)
    // 如果线程池大小为0(上一步转换失败)，则赋值为1
    nthreads = 1;
  if (nthreads > MAX_THREADPOOL_SIZE)
    // 上限限定
    nthreads = MAX_THREADPOOL_SIZE;

  threads = default_threads;
  if (nthreads > ARRAY_SIZE(default_threads))
  {
    // 分配内存空间
    threads = uv__malloc(nthreads * sizeof(threads[0]));
    if (threads == NULL)
    {
      nthreads = ARRAY_SIZE(default_threads);
      threads = default_threads;
    }
  }

  // 初始化条件锁，阻塞状态
  if (uv_cond_init(&cond))
    abort();

  // 初始化互斥锁
  if (uv_mutex_init(&mutex))
    abort();

  // 初始化工作队列
  QUEUE_INIT(&wq);
  // 初始化慢IO队列
  QUEUE_INIT(&slow_io_pending_wq);
  // 初始化慢IO标志队列，用于标识是否存在慢IO操作
  // 相当于指定代表排队
  QUEUE_INIT(&run_slow_work_message);

  // 初始化信号量锁
  if (uv_sem_init(&sem, 0))
    abort();

  for (i = 0; i < nthreads; i++)
    // 创建线程
    if (uv_thread_create(threads + i, worker, &sem))
      abort();

  for (i = 0; i < nthreads; i++)
    uv_sem_wait(&sem);

  uv_sem_destroy(&sem);
}

#ifndef _WIN32
static void reset_once(void)
{
  uv_once_t child_once = UV_ONCE_INIT;
  memcpy(&once, &child_once, sizeof(child_once));
}
#endif

static void init_once(void)
{
#ifndef _WIN32
  /* Re-initialize the threadpool after fork.
   * Note that this discards the global mutex and condition as well
   * as the work queue.
   */
  if (pthread_atfork(NULL, NULL, &reset_once))
    abort();
#endif
  // 初始化线程池
  init_threads();
}

// 提交作业到线程池执行队列
// uv__work 包含三个属性
// work: 作业函数
// done: 为完成回调
// loop: 为绑定到的主循环
// wq: 为双向队列节点(用于插入 uv__work 到队列中)
void uv__work_submit(uv_loop_t *loop,
                     struct uv__work *w,
                     enum uv__work_kind kind,
                     void (*work)(struct uv__work *w),
                     void (*done)(struct uv__work *w, int status))
{
  // 保证多次提交只会初始化一次
  // 线程池是在第一次有作业的时候初始化的，属于延迟初始化
  uv_once(&once, init_once);
  // 绑定loop, work, done函数
  w->loop = loop;
  w->work = work;
  w->done = done;
  // w-wq是双向队列，因此数组长度为2
  // UV__WORK_CPU, 计算性
  // UV__WORK_FAST_IO, 快IO
  // UV__WORK_SLOW_IO 慢IO

  // 将 uv__work 加入执行队列
  post(&w->wq, kind);
}

// 取消作业
/**
 * 1. 主循环
 * 2. 请求对象
 * 3. 作业
 */
static int uv__work_cancel(uv_loop_t *loop, uv_req_t *req, struct uv__work *w)
{
  int cancelled;

  uv_mutex_lock(&mutex);
  uv_mutex_lock(&w->loop->wq_mutex);

  // 能取消
  cancelled = !QUEUE_EMPTY(&w->wq) && w->work != NULL;
  if (cancelled)
    QUEUE_REMOVE(&w->wq);

  uv_mutex_unlock(&w->loop->wq_mutex);
  uv_mutex_unlock(&mutex);

  if (!cancelled)
    return UV_EBUSY;

  // 将作业重新赋值为 uv__cancelled，其内部为 abort 操作
  w->work = uv__cancelled;
  uv_mutex_lock(&loop->wq_mutex);
  // 将任务追加至 loop->wq 尾部，并直接通知 loop
  // 意味着 被取消的任务仍然会放入 loop->wq 中等待执行
  QUEUE_INSERT_TAIL(&loop->wq, &w->wq);
  uv_async_send(&loop->wq_async);
  uv_mutex_unlock(&loop->wq_mutex);

  return 0;
}

// 处理完成(主线程内执行)
// 执行所有work
void uv__work_done(uv_async_t *handle)
{
  struct uv__work *w;
  uv_loop_t *loop;
  QUEUE *q;
  QUEUE wq;
  int err;

  // 找到loop
  loop = container_of(handle, uv_loop_t, wq_async);
  // 这里将 loop->wq 拷贝到 wq，最小化 loop->wq 被锁定的时间
  uv_mutex_lock(&loop->wq_mutex);
  // 获取loop中的wq队里
  QUEUE_MOVE(&loop->wq, &wq);
  uv_mutex_unlock(&loop->wq_mutex);

  // 执行所有已完成IO的回调
  while (!QUEUE_EMPTY(&wq))
  {
    q = QUEUE_HEAD(&wq);
    // 移除 q, 保证 while 循环条件能正常终止
    QUEUE_REMOVE(q);

    // 找到uv__work
    w = container_of(q, struct uv__work, wq);
    // 判定该为取消过的任务，回传特定错误信息
    err = (w->work == uv__cancelled) ? UV_ECANCELED : 0;
    // 执行结束回调（用户传入的回调）
    // 这里的done为uv__queue_done
    w->done(w, err);
  }
}

// 处理中
static void uv__queue_work(struct uv__work *w)
{
  // 根据work_req属性在uv_work_t类型中的位置，获取req的地址
  uv_work_t *req = container_of(w, uv_work_t, work_req);

  req->work_cb(req);
}

// 处理完成
static void uv__queue_done(struct uv__work *w, int err)
{
  uv_work_t *req;

  // 根据uv__work在uv_work_t中的位置反推req地址
  // 地址即为内存空间位置，直接操作内存
  req = container_of(w, uv_work_t, work_req);
  // 注销，使loop中的active_reqs（活动的请求数）减一
  // active_reqs会影响到事件循环的允许
  uv__req_unregister(req->loop, req);

  // 没有设定回调函数，直接返回
  if (req->after_work_cb == NULL)
    return;

  // 执行回调
  // 将req回传给完成回调函数，在执行worker期间对req做的任何修改均会反应到req中
  // 完成回调函数能获取到req中的值，req->data（用于用户自定义数据）
  req->after_work_cb(req, err);
}

// 提交用户worker入口
int uv_queue_work(uv_loop_t *loop,
                  uv_work_t *req,
                  uv_work_cb work_cb,
                  uv_after_work_cb after_work_cb)
{
  if (work_cb == NULL)
    return UV_EINVAL;

  // 初始化req，绑定主循环，回调函数
  // 1. 设定作业请求类型，用于uv_cancel函数
  // 2. 主循环active_reqs数 + 1
  // 3. 绑定主循环
  // 4. 将自身添加至loop->handle_queue
  uv__req_init(loop, req, UV_WORK);
  req->loop = loop;
  req->work_cb = work_cb;
  req->after_work_cb = after_work_cb;
  // 开始处理
  uv__work_submit(loop,
                  // work_req为uv/threadpool.h中的uv__work
                  &req->work_req,
                  // 任务类型
                  UV__WORK_CPU,
                  // 线程池中执行的任务
                  uv__queue_work,
                  // 任务执行完毕回调函数
                  uv__queue_done);
  return 0;
}

// 取消
int uv_cancel(uv_req_t *req)
{
  struct uv__work *wreq;
  uv_loop_t *loop;

  switch (req->type)
  {
  // 文件操作
  case UV_FS:
    loop = ((uv_fs_t *)req)->loop;
    wreq = &((uv_fs_t *)req)->work_req;
    break;
  // 地址
  case UV_GETADDRINFO:
    loop = ((uv_getaddrinfo_t *)req)->loop;
    wreq = &((uv_getaddrinfo_t *)req)->work_req;
    break;
  case UV_GETNAMEINFO:
    loop = ((uv_getnameinfo_t *)req)->loop;
    wreq = &((uv_getnameinfo_t *)req)->work_req;
    break;
  // 用户作业
  case UV_WORK:
    loop = ((uv_work_t *)req)->loop;
    wreq = &((uv_work_t *)req)->work_req;
    break;
  default:
    return UV_EINVAL;
  }

  return uv__work_cancel(loop, req, wreq);
}
