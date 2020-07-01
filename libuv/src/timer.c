/* Copyright Joyent, Inc. and other Node contributors. All rights reserved.
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

#include "uv.h"
#include "uv-common.h"
#include "heap-inl.h"

#include <assert.h>
#include <limits.h>

// 时间堆

static struct heap *timer_heap(const uv_loop_t *loop)
{
#ifdef _WIN32
  return (struct heap *)loop->timer_heap;
#else
  return (struct heap *)&loop->timer_heap;
#endif
}

// 时间比较函数
static int timer_less_than(const struct heap_node *ha,
                           const struct heap_node *hb)
{
  const uv_timer_t *a;
  const uv_timer_t *b;

  a = container_of(ha, uv_timer_t, heap_node);
  b = container_of(hb, uv_timer_t, heap_node);

  if (a->timeout < b->timeout)
    return 1;
  if (b->timeout < a->timeout)
    return 0;

  // timeout相同，则比较start_id
  // start_id 在uv_timer_start()函数内部分配

  /* Compare start_id when both have the same timeout. start_id is
   * allocated with loop->timer_counter in uv_timer_start().
   */
  if (a->start_id < b->start_id)
    return 1;
  if (b->start_id < a->start_id)
    return 0;

  return 0;
}

// 初始化
int uv_timer_init(uv_loop_t *loop, uv_timer_t *handle)
{
  // 将定时器handle加入loop->handle_queue中
  uv__handle_init(loop, (uv_handle_t *)handle, UV_TIMER);
  // 定时器置空
  handle->timer_cb = NULL;
  // 定时器不重复
  handle->repeat = 0;
  return 0;
}

// 启动定时器
// timeout为超时时间
// repeat为是否重复
int uv_timer_start(uv_timer_t *handle,
                   uv_timer_cb cb,
                   uint64_t timeout,
                   uint64_t repeat)
{
  uint64_t clamped_timeout;

  if (uv__is_closing(handle) || cb == NULL)
    return UV_EINVAL;

  // 如果当前timer handle为活动状态
  // 那么新的timer handle 会替换之前的timer handle
  if (uv__is_active(handle))
    uv_timer_stop(handle);

  // 时间为当前主循环时间 + 设定的超时时间
  clamped_timeout = handle->loop->time + timeout;
  if (clamped_timeout < timeout)
    // clamped_timeout < timeout 表明handle->loop->time为负值
    // 溢出，因此需要uint64_t最大值 - 1
    clamped_timeout = (uint64_t)-1;

  // 设定callback
  handle->timer_cb = cb;
  // 定时时间
  handle->timeout = clamped_timeout;
  // 是否重复执行，setInterval
  handle->repeat = repeat;
  /* start_id is the second index to be compared in uv__timer_cmp() */
  // 用于timeout相同，先后顺序判断
  handle->start_id = handle->loop->timer_counter++;

  // 将定时器插入最小堆
  heap_insert(timer_heap(handle->loop),
              (struct heap_node *)&handle->heap_node,
              timer_less_than);
  // 启动，本质上是标识该handle为活动状态，告知loop已准备好
  uv__handle_start(handle);

  return 0;
}

// 停止定时器
int uv_timer_stop(uv_timer_t *handle)
{
  // 如果当前handle非活动状态，不需要处理
  if (!uv__is_active(handle))
    return 0;

  // 堆中移除
  heap_remove(timer_heap(handle->loop),
              (struct heap_node *)&handle->heap_node,
              timer_less_than);
  // actives 计数器减一
  uv__handle_stop(handle);

  return 0;
}

int uv_timer_again(uv_timer_t *handle)
{
  if (handle->timer_cb == NULL)
    return UV_EINVAL;

  // 定时器循环
  if (handle->repeat)
  {
    uv_timer_stop(handle);
    // 超时时间为repeat时间间隔
    uv_timer_start(handle, handle->timer_cb, handle->repeat, handle->repeat);
  }

  return 0;
}

void uv_timer_set_repeat(uv_timer_t *handle, uint64_t repeat)
{
  handle->repeat = repeat;
}

uint64_t uv_timer_get_repeat(const uv_timer_t *handle)
{
  return handle->repeat;
}

// 计算io_poll阻塞时间
int uv__next_timeout(const uv_loop_t *loop)
{
  const struct heap_node *heap_node;
  const uv_timer_t *handle;
  uint64_t diff;

  // 取出最小堆中的最小值
  heap_node = heap_min(timer_heap(loop));
  if (heap_node == NULL)
    return -1; /* block indefinitely */

  handle = container_of(heap_node, uv_timer_t, heap_node);
  // 定时器超时时间小于主事件循环时间
  // 这种情况下，需要尽快退出io_epoll，不阻塞定时器执行
  if (handle->timeout <= loop->time)
    return 0;

  // 否则取当前时间与下一个定时器触发时间差值
  diff = handle->timeout - loop->time;
  // 上限控制
  if (diff > INT_MAX)
    diff = INT_MAX;

  return (int)diff;
}

// 运行定时器
void uv__run_timers(uv_loop_t *loop)
{
  struct heap_node *heap_node;
  uv_timer_t *handle;

  // 一直运行，直到当前最小元素，即最小超时时间都大于当前循环时间（表示当前循环时间没有定时器需要执行）
  // 尽可能多的执行定时器，直到最小定时时间 大于 当前循环时间
  for (;;)
  {
    // 最小时间
    heap_node = heap_min(timer_heap(loop));
    if (heap_node == NULL)
      break;

    handle = container_of(heap_node, uv_timer_t, heap_node);
    // 最小超时时间 大于 循环时间
    // 尽可能多执行
    if (handle->timeout > loop->time)
      break;

    uv_timer_stop(handle);
    uv_timer_again(handle);
    // 执行回调函数
    handle->timer_cb(handle);
  }
}

// 计时器停止
void uv__timer_close(uv_timer_t *handle)
{
  uv_timer_stop(handle);
}
