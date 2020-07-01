## 线程池

#### 数据类型

uv__work: 作业
uv_work_t[alais: uv_work_s]: 作业请求类型，用于递交作业给线程池处理

```
struct uv__work {
  // 作业处理函数
  void (*work)(struct uv__work *w);
  // 作业处理完毕，通知函数
  void (*done)(struct uv__work *w, int status);
  // 主循环
  struct uv_loop_s* loop;
  // 作业队列
  void* wq[2];
};

struct uv_work_s {
  // 用户自定义数据
  void* data;
  // 请求类型
  uv_req_type type;
  void* reserved[6]; 
  // 主循环
  uv_loop_t* loop;
  // 作业处理函数
  uv_work_cb work_cb;
  // 作业处理完毕，通知函数
  uv_after_work_cb after_work_cb;
  // 请求的作业
  struct uv__work work_req;
};

```