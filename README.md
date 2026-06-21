# Cloudflare R2 图片管理器

这是一个 Cloudflare Pages + Pages Functions 项目，用来浏览 R2 存储桶里的图片、查看缩略图、下载原图、复制 Markdown 图片链接。项目不包含上传功能，上传建议继续交给 PicGo。

## 项目结构

```text
.
├── functions/
│   ├── api/
│   │   └── list.ts
│   ├── download/
│   │   └── [[key]].ts
│   ├── delete/
│   │   └── [[key]].ts
│   ├── image/
│   │   └── [[key]].ts
│   └── types.ts
├── src/
│   ├── main.ts
│   └── style.css
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── wrangler.toml
└── README.md
```

## 功能

- 首页网格展示 R2 图片列表
- 支持 `jpg`、`jpeg`、`png`、`webp`、`gif`、`avif`、`svg`
- 支持按 prefix 浏览：根目录、`images/`、`posts/`、`wallpapers/`
- 支持 R2 list cursor 分页，并提供“加载更多”按钮
- 支持搜索当前已加载列表里的文件名或 key
- 页面显示当前已加载数量、可见文件大小合计和当前位置
- 支持加载骨架屏、空状态和清晰错误提示
- 点击图片打开大图预览弹窗
- 下载按钮使用 `/download/<key>` 下载 R2 原始文件
- 删除按钮使用 `DELETE /delete/<key>` 删除 R2 原始文件
- 复制 Markdown 格式：`![](https://你的域名/image/文件路径)`
- 图片预览地址：`/image/<key>`
- 列表接口：`/api/list?prefix=xxx&cursor=xxx`

## 安装与本地运行

```bash
npm install
npm run preview
```

`npm run preview` 会先构建前端，再使用 Wrangler 启动 Pages Functions 本地环境。首次本地调试前，请先在 `wrangler.toml` 中把 `bucket_name` 改成你的 R2 bucket 名称：

```toml
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "your-r2-bucket-name"
```

如果只想看前端静态页面，可以运行：

```bash
npm run dev
```

但 `npm run dev` 只启动 Vite，不会提供 Pages Functions，也不会访问 R2。

## Cloudflare Pages 部署

1. 把项目推送到 GitHub 或 GitLab。
2. 在 Cloudflare Dashboard 创建 Pages 项目，并连接仓库。
3. 构建命令填写：

```bash
npm run build
```

4. 构建输出目录填写：

```text
dist
```

5. 在 Pages 项目的 Settings -> Functions -> R2 bucket bindings 中添加绑定：

```text
Variable name: BUCKET
R2 bucket: 你的 bucket
```

6. 在 Pages 项目的 Settings -> Environment variables 中按需添加：

```text
PUBLIC_BASE_URL=https://img.example.com
```

`PUBLIC_BASE_URL` 用于生成复制出来的 Markdown 图片链接。如果不配置，接口会自动使用当前访问域名。

## API 说明

### `GET /api/list?prefix=xxx&cursor=xxx`

返回当前 prefix 下的图片对象列表。响应示例：

```json
{
  "items": [
    {
      "key": "images/demo.png",
      "name": "demo.png",
      "size": 123456,
      "uploaded": "2026-06-21T08:00:00.000Z",
      "imageUrl": "/image/images/demo.png",
      "downloadUrl": "/download/images/demo.png",
      "deleteUrl": "/delete/images/demo.png",
      "markdown": "![](https://img.example.com/image/images/demo.png)"
    }
  ],
  "cursor": null,
  "truncated": false
}
```

### `GET /image/<key>`

读取 R2 原图内容并返回，设置 `Content-Type` 和长期缓存头。前端缩略图预览和大图预览都使用这个地址。

### `GET /download/<key>`

读取 R2 原图内容并返回，设置：

```http
Content-Disposition: attachment
```

浏览器会下载 R2 中的原始文件，而不是下载网页缩略图。

### `DELETE /delete/<key>`

删除 R2 中对应 key 的原始文件。前端会先弹出浏览器确认框，确认后才会发送删除请求。

## 中文、空格和特殊字符 key

前端和接口会按路径片段编码 key，例如：

```text
/image/images/%E6%B5%8B%E8%AF%95%20photo.png
```

Pages Functions 收到请求后会 decode，再用原始 key 调用 `BUCKET.get(key)`。

## 安全说明

- 项目不需要、也不会内置 R2 Access Key 或 Secret Key。
- 前端和 Pages Functions 只通过 Cloudflare R2 binding `BUCKET` 读取 R2。
- 项目不提供上传接口。图片上传由 PicGo 完成。
- 项目提供删除接口，请确认这个 Pages 项目已经用 Cloudflare Access 或其他方式限制访问。
- 默认建议把这个 Pages 项目当作私人图片管理器使用。
- 建议使用 Cloudflare Access 保护整个 Pages 项目。
- 如果公开访问，`/api/list` 会暴露 R2 图片列表，`/image/<key>` 和 `/download/<key>` 也会公开可访问。

## 常见错误

### 页面提示 `R2 bucket binding BUCKET is not configured.`

说明 Pages 项目没有配置 R2 bucket binding，或变量名不是 `BUCKET`。请检查 Cloudflare Pages 的 Functions 绑定设置。

### 图片不存在

如果访问 `/image/<key>` 或 `/download/<key>` 返回 404，说明 R2 bucket 中没有这个 key，或 URL 编码后的路径不对应真实对象 key。

### Markdown 域名不是预期域名

配置环境变量：

```text
PUBLIC_BASE_URL=https://img.example.com
```

然后重新部署 Pages。
