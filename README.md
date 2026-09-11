# xin 影视TV配置维护

这套工程每天获取上游配置，再覆盖自己的展示信息。它维护的是“订阅配置层”，
不会修改加密 spider 的播放实现。


- `logo`：主页头像，要求是可直接访问的 PNG、JPG、WebP 或 GIF 图片网址。
- `wallpaper`：主页背景图；不传参数就保留原背景。
- `parses[0..2].name`：当前分别是“王”“二”“小”，只是解析线路显示名。
- `sites[key=Douban].name`：首页品牌卡片。
- `sites[key=Doubanaaaa].name`：首页更新日期卡片。

## 先生成配置

编辑 `settings.json`：

- `brand_name` 保持 `xin` 或换成你的名字。
- `logo_url` 填自己的头像图片直链；暂时没有就留空，App 使用默认头像。
- `wallpaper_url` 填自己的背景图片直链；留空使用 App 默认背景。

然后执行：

```powershell
cd 'D:\Documents\ChatGPT\分析\aiwex-custom'
node .\build_interface.mjs
```

## 发布成自己的接口

### 自己的 Linux 服务器（推荐）

服务器已安装 Docker 时，把整个目录上传到服务器，进入目录后执行：

```bash
docker compose up -d --build
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/index.json
```

对外接口暂时是：

```text
http://你的服务器IP:8080/index.json
```

正式使用建议通过 Nginx、Caddy 或宝塔反向代理到 `127.0.0.1:8080`，并启用 HTTPS，
最终地址类似 `https://tv.example.com/index.json`。

头像和背景可以放在同一服务的 `docs` 目录。把文件命名为 `avatar.png`、
`background.jpg`，然后在 `settings.json` 填：

```json
{
  "logo_url": "https://tv.example.com/avatar.png",
  "wallpaper_url": "https://tv.example.com/background.jpg"
}
```

修改设置或图片后重新执行 `docker compose up -d --build`。

### GitHub Pages（没有服务器时使用）

1. 在 GitHub 新建一个空仓库。
2. 把本目录中的文件上传到仓库根目录。
3. 在仓库 Settings -> Pages 中选择 `Deploy from a branch`。
4. 分支选择 `main`，目录选择 `/docs`。
5. 等待部署后，影视TV填写：`https://你的用户名.github.io/仓库名/index.json`。

仓库里的 GitHub Actions 每天自动同步一次上游并重新生成配置，也可以在 Actions
页面手动执行 `Update TV config`。

## 依赖边界

以下名字是内部类名或加密包标识，不能直接替换：`Wex*Guard`、`wexguard_v7.so`、
`wexguard_v8.so`、`wexshinidie.guard`。JSON 里的 `api` 必须继续匹配这些类名。

因此这仍然依赖上游 spider 和第三方内容接口。要做到连播放核心也由自己维护，必须取得
对应源代码和明确许可证后自行编译；当前下载包没有 `LICENSE`，核心 guard 还是加密的，
不能从这份 JSON 直接变成完整自有源码。

## 单次命令版

下面的旧脚本适合只生成一次，不需要每日维护：

生成自定义配置：

```powershell
cd 'D:\Documents\ChatGPT\分析\aiwex-custom'
node .\make_custom_config.mjs `
  --logo 'https://你的图床.example/avatar.png' `
  --brand 'xin' `
  --output '.\aiwex-xin.json'
```

同时更换背景：

```powershell
node .\make_custom_config.mjs `
  --logo 'https://你的图床.example/avatar.png' `
  --wallpaper 'https://你的图床.example/background.jpg' `
  --brand 'xin' `
  --output '.\aiwex-xin.json'
```

脚本不会修改 `spider`、`sites`、解析接口 URL、规则或直播地址。生成后，把
`aiwex-xin.json` 和图片上传到稳定的 HTTPS 静态托管空间，再将影视TV的配置地址
改成你自己的 JSON 直链。

如果导入自定义 JSON 后页面仍显示“王小二”，该文字就不是来自这个 JSON，而是来自
加密的 spider 插件、配置中心接口或 App 缓存。需要提供显示位置截图再继续定位。
