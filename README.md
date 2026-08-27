# 节律

独立的 GitHub Pages 版本。登录、数据库和跨设备同步由 Supabase 提供，不依赖 ChatGPT 账号。

## 使用方式

1. 用户输入邮箱，点击邮件中的登录链接；第一次登录会自动注册。
2. 手机和电脑使用同一邮箱登录，数据自动同步。
3. 任一设备修改后，另一个已打开的设备会通过 Realtime 收到更新。

## 首次配置

1. 在 Supabase 创建一个项目。
2. 打开 SQL Editor，执行 `supabase/schema.sql` 的全部内容。
3. 在 Authentication → URL Configuration 中，把 GitHub Pages 地址设为 Site URL，并加入 Redirect URLs。
4. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
5. 在 Settings → Pages 中选择 GitHub Actions 作为发布来源。

不要把 Supabase 的 `service_role` key 放进 GitHub 或网页代码。前端只使用 publishable key，用户数据隔离由数据库 RLS 强制执行。
