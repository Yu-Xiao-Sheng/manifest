-- Manifest 数据库迁移：添加 Response API 支持到 custom_providers 表
-- 执行日期: 2026-03-24
-- 说明: 添加 enable_response_api 和 response_api_config 字段

-- 添加 enable_response_api 字段
ALTER TABLE custom_providers 
ADD COLUMN enable_response_api BOOLEAN DEFAULT 0;

-- 添加 response_api_config 字段 (JSON 类型存储配置)
ALTER TABLE custom_providers 
ADD COLUMN response_api_config TEXT;

-- 验证字段已添加
SELECT '=== Fields added successfully ===' as status;
PRAGMA table_info(custom_providers);

-- 显示更新后的表结构
SELECT '=== Updated custom_providers table ===' as info;
SELECT 
  name, 
  base_url, 
  enable_response_api,
  response_api_config
FROM custom_providers;
