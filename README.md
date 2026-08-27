# 节律

独立的 GitHub Pages 版本。登录、数据库和跨设备同步由 Supabase 提供，不依赖 ChatGPT 账号。

## 使用方式

1. 用户输入邮箱，点击邮件中的登录链接；第一次登录会自动注册。
2. 手机和电脑使用同一邮箱登录，数据自动同步。
3. 任一设备修改后，另一个已打开的设备会通过 Realtime 收到更新。

## 自行部署

1. 在 Supabase 创建一个项目。
2. 打开 SQL Editor，执行 `supabase/schema.sql` 的全部内容。
3. 在 Authentication → URL Configuration 中，把 GitHub Pages 地址设为 Site URL，并加入 Redirect URLs。
4. 复制 `.env.example` 为 `.env.production`，填写项目 URL 和 publishable key。
5. 运行 `npm run build`，将 `dist` 目录发布到 GitHub Pages 或其他静态托管平台。

不要把 Supabase 的 `service_role` key 放进 GitHub 或网页代码。前端只使用 publishable key，用户数据隔离由数据库 RLS 强制执行。

## 许可

本仓库目前未附加开源许可证。公开可见不代表授权复制、修改、分发或商用；GitHub 用户仍可依照平台功能查看和 Fork 仓库。
