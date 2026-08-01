# G-LLM 匿名统计服务开发需求

## 目标

为G-LLM Client 客户端提供一个轻量、隐私友好的匿名统计服务，用于了解发布版本后的装机、活跃、功能使用、模型调用成功率和词元消耗趋势。

服务端只接收客户端主动上报的匿名元数据，不接收、不存储聊天内容、API Key、上传文件内容、知识库内容、截图内容或用户自定义提示词。

## 推荐部署

- 域名：`https://telemetry.gprophet.com`
- 接口前缀：`/v1`
- 可与现有 G-LLM 管理后台共用服务器和数据库。
- 不建议放在 `https://llm.gprophet.com/v1` 下，避免和模型网关职责混在一起。

## 客户端当前默认上报地址

```text
POST https://llm.gprophet.com/v1/events
```

后续如果独立统计服务部署到推荐域名，可以通过构建或运行环境变量切换：

```text
GLLM_TELEMETRY_ENDPOINT=https://telemetry.gprophet.com/v1/events
```

## 上报开关

客户端默认开启匿名统计。用户可以在设置页关闭，关闭后客户端不再发送后续匿名统计事件。

服务端无需保存用户个人身份，只保存 `installation_id` 作为匿名安装 ID，用于统计装机和活跃。

## 事件请求格式

```json
{
  "version": 1,
  "event_id": "uuid",
  "installation_id": "uuid",
  "event_name": "chat_completed",
  "occurred_at": "2026-06-25T08:00:00.000Z",
  "app": {
    "name": "G-LLM",
    "version": "1.0.6",
    "packaged": false
  },
  "os": {
    "platform": "win32",
    "arch": "x64",
    "release": "10.0.26100"
  },
  "properties": {
    "provider_kind": "gllm",
    "provider_template": "gllm",
    "purpose": "chat",
    "web_search_enabled": false,
    "input_tokens": 1200,
    "output_tokens": 600,
    "total_tokens": 1800
  }
}
```

## 当前客户端会上报的事件

| event_name | 触发时机 | 主要字段 |
| --- | --- | --- |
| `app_started` | 应用启动 | app/os |
| `telemetry_enabled` | 用户开启匿名统计 | app/os |
| `telemetry_disabled` | 用户关闭匿名统计 | app/os |
| `provider_added` | 新增供应商 | provider_kind, provider_template, model_count |
| `provider_updated` | 保存供应商 | provider_kind, provider_template, model_count |
| `provider_models_refreshed` | 拉取模型成功 | provider_kind, provider_template, model_count |
| `provider_models_refresh_failed` | 拉取模型失败 | provider_kind, error_category |
| `chat_started` | 开始一次模型请求 | provider_kind, purpose, attachment counts |
| `chat_completed` | 模型请求成功结束 | input_tokens, output_tokens, total_tokens |
| `chat_failed` | 模型请求失败 | error_category |

## 字段隐私要求

服务端必须拒绝或丢弃以下字段：

- prompt
- content
- message
- api_key
- apiKey
- file_name
- filename
- file_content
- screenshot
- knowledge
- memory_content
- base_url
- api_base_url

建议在服务端做字段白名单，只允许保存本文档列出的字段。

## 建议数据库表

### telemetry_events

```sql
CREATE TABLE telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  installation_id UUID NOT NULL,
  event_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app_name TEXT NOT NULL,
  app_version TEXT NOT NULL,
  app_packaged BOOLEAN NOT NULL,
  os_platform TEXT NOT NULL,
  os_arch TEXT NOT NULL,
  os_release TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_telemetry_events_occurred_at ON telemetry_events (occurred_at);
CREATE INDEX idx_telemetry_events_name_time ON telemetry_events (event_name, occurred_at);
CREATE INDEX idx_telemetry_events_installation_time ON telemetry_events (installation_id, occurred_at);
CREATE INDEX idx_telemetry_events_properties ON telemetry_events USING GIN (properties);
```

### telemetry_daily_stats

用于后台快速展示。可以每日定时聚合，也可以查询时实时计算。

```sql
CREATE TABLE telemetry_daily_stats (
  day DATE NOT NULL,
  app_version TEXT NOT NULL,
  os_platform TEXT NOT NULL,
  new_installations INTEGER NOT NULL DEFAULT 0,
  active_installations INTEGER NOT NULL DEFAULT 0,
  app_starts INTEGER NOT NULL DEFAULT 0,
  chat_started INTEGER NOT NULL DEFAULT 0,
  chat_completed INTEGER NOT NULL DEFAULT 0,
  chat_failed INTEGER NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, app_version, os_platform)
);
```

## 接口要求

### POST /v1/events

请求体：单个事件 JSON。

响应：

```json
{
  "ok": true
}
```

要求：

- 必须支持 CORS，允许 G-LLM Electron 客户端请求。
- 必须校验 `version = 1`。
- 必须校验 `event_id` 和 `installation_id` 为 UUID。
- 必须校验 `event_name` 在白名单内。
- 必须校验 `occurred_at` 不超过当前时间太远，例如未来 10 分钟。
- `properties` 只能保存白名单字段。
- 单个请求体限制建议 16KB。
- 重复 `event_id` 返回成功，不重复写入。
- 不要因为单条非法字段导致服务崩溃。

## 建议 properties 白名单

```text
provider_kind
provider_template
model_capabilities
requires_api_key
model_count
purpose
web_search_enabled
has_knowledge_refs
has_assistant_memory
image_attachment_count
file_attachment_count
message_count
input_tokens
output_tokens
total_tokens
error_category
```

## 错误类别

客户端当前会上报：

- `auth`
- `rate_limit`
- `network`
- `model`
- `provider`
- `unknown`

## 管理后台建议看板

第一版后台只需要 6 个区域：

1. 总览
   - 今日启动设备数
   - 今日新增安装
   - 今日有效对话数
   - 今日请求失败率
   - 今日输入/输出/总词元

2. 留存漏斗
   - app_started
   - provider_added/provider_updated
   - provider_models_refreshed
   - chat_started
   - chat_completed

3. 版本分布
   - app_version 占比
   - 各版本失败率

4. 系统分布
   - win32/darwin/linux
   - arch 分布

5. 供应商与模型能力
   - provider_kind 使用量
   - model_capabilities 使用量
   - provider_models_refresh_failed 错误分类

6. 聊天质量
   - chat_completed / chat_started
   - chat_failed 按 error_category 分布
   - token 消耗趋势

## 数据保留策略

建议：

- 原始事件保留 90 天。
- 日聚合数据长期保留。
- 支持按 `installation_id` 删除数据，方便未来做隐私合规功能。

## 安全要求

- 全站 HTTPS。
- 限制请求体大小。
- 对 `installation_id` 做简单限流，例如每分钟 120 个事件。
- 对 IP 做全局限流，避免被刷。
- 不记录请求体到普通日志，避免误存敏感字段。
- 后台访问需要管理员登录。

## 验收标准

1. 客户端开启匿名统计后，`app_started` 可以写入数据库。
2. 客户端关闭匿名统计后，不再接收后续事件。
3. 重复 `event_id` 不产生重复记录。
4. 包含敏感字段的 properties 会被丢弃。
5. 聊天成功后能看到 `chat_completed` 和 token 数量。
6. 聊天失败后能看到 `chat_failed` 和错误类别。
7. 管理后台能按日期查看 DAU、对话数、失败率、token 趋势。
8. 接口异常不会影响客户端正常聊天。
