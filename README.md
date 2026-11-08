# 隐私政策站点（GitHub Pages）

这是 Chrome 商店要求的「隐私政策网址」的静态页面。两个文件，零依赖、零脚本。

- `index.html` —— 支持页（产品是什么、怎么用、适用范围、联系方式）
- `privacy.html` —— 隐私政策全文（含 Chrome 要求的 Limited Use 声明）

## 已经定好的东西

| 项 | 值 |
|---|---|
| GitHub 用户名 | `zzehui` |
| 建议仓库名 | `jobwatch` |
| 隐私政策网址 | `https://zzehui.github.io/jobwatch/privacy.html` |
| 商店后台填的联系邮箱 | `zzhlmgj@gmail.com` |

> 仓库名如果不想用 `jobwatch`，把下面的 `jobwatch` 全部替换掉，同时把最终 URL 告诉我，我改文档。

## 发布（在本目录下执行，3 条命令）

```bash
cd knowledge/operations/store/privacy-site
git init -b main && git add . && git commit -m "privacy policy for Chrome extension"
# 先在 GitHub 网页上建一个 public 仓库 jobwatch（不要勾 README），然后：
git remote add origin https://github.com/zzehui/jobwatch.git
git push -u origin main
```

推送后到仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，Branch 选 `main` / `root`，保存。
等 1-2 分钟，访问 `https://zzehui.github.io/jobwatch/privacy.html` 确认能打开。

## 验证清单（我做，或你做完我复核）

- [ ] `privacy.html` 能打开，邮箱可点
- [ ] 页面上有 Limited Use 英文段落
- [ ] 没有外部脚本、没有统计代码（右键查看源码即可确认）
- [ ] 手机宽度下排版不溢出
- [ ] 把最终 URL 填进 Chrome Developer Dashboard → Privacy practices → Privacy policy URL

## 为什么不用第三方博客/文档站

商店审核会看「隐私政策是否真的描述了数据实践」。静态页在自己仓库里，改起来可追溯（有 commit 记录），
也不会因为第三方站点改规则而失效。
